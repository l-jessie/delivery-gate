import fs from 'node:fs';
import path from 'node:path';
import { VERSION } from './version.js';
import { textOf } from './utils.js';
import { buildEvidenceSummary, evidenceScore, sanitizePrompt, serializeState } from './evidence.js';

export function safeName(v) {
  return String(v || 'run').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'run';
}
export function summarizeApproval(toolName, params) {
  const raw = textOf(params, 800).replace(/\s+/g, ' ').trim();
  const redacted = sanitizePrompt(raw, 'redacted');
  const tool = String(toolName || 'tool');
  const body = redacted || 'High-risk tool call requested.';
  return `${tool}: ${body}`.slice(0, 240);
}
export function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}
export function appendJsonl(file, obj, cfg = {}) {
  try {
    ensureDir(path.dirname(file));
    if (cfg.maxLedgerBytes && fs.existsSync(file) && fs.statSync(file).size > cfg.maxLedgerBytes) {
      fs.renameSync(file, `${file}.${Date.now()}.old`);
    }
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch {}
}
export function pruneOldFiles(dir, retentionDays = 30) {
  try {
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) pruneOldFiles(p, retentionDays);
      else if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch {}
}
export function workspaceDirOf(ctx = {}) {
  return ctx.workspaceDir || ctx.cwd || ctx.agentWorkspaceDir || '';
}
export function shouldUseProjectPlan(s) {
  return s?.longTask && (s.taskType === 'coding' || s.taskType === 'config-runtime' || /项目|代码库|仓库|工程|project|repo/i.test(s.prompt || ''));
}
export function setupPersistence(api, cfg, k, s, ctx = {}) {
  if (!cfg.persistLedger && !cfg.implicitPlanFiles) return;
  const base = path.join(api.runtime.state.resolveStateDir(), 'plugins', 'delivery-gate');
  const day = new Date().toISOString().slice(0, 10);
  const runFile = `${safeName(k)}.jsonl`;
  if (cfg.persistLedger && !s.ledgerPath) s.ledgerPath = path.join(base, 'runs', day, runFile);
  if (cfg.implicitPlanFiles && s.longTask && !s.planPath) {
    const workspace = workspaceDirOf(ctx);
    if (cfg.projectPlanFiles && workspace && shouldUseProjectPlan(s)) {
      s.planPath = path.join(workspace, '.openclaw', 'plans', `${new Date().toISOString().replace(/[:.]/g, '-')}-${safeName(k)}.json`);
    } else {
      s.planPath = path.join(base, 'plans', `${safeName(k)}.json`);
    }
  }
}
export function ledger(api, cfg, k, s, event, extra = {}) {
  if (!cfg.persistLedger || !s?.ledgerPath) return;
  appendJsonl(s.ledgerPath, { ts: new Date().toISOString(), version: VERSION, event, run: k, summary: buildEvidenceSummary(s), ...extra }, cfg);
}
export function writeImplicitPlan(api, cfg, k, s) {
  if (!cfg.implicitPlanFiles || !s?.planPath || fs.existsSync(s.planPath)) return;
  const plan = {
    version: VERSION,
    run: k,
    createdAt: new Date().toISOString(),
    taskType: s.taskType,
    risk: s.risk,
    goal: sanitizePrompt(s.prompt, cfg.ledgerPromptMode),
    successCriteria: ['All user-requested items handled', 'Mutable/file/config/code claims backed by evidence', 'No unconfirmed high-risk action', 'Blocked state reported instead of false completion'],
    phases: ['understand', 'inspect', 'act', 'verify', 'reflect', 'deliver'],
    currentPhase: 'understand',
    note: 'Implicit long-task plan; retained for review, replay, and follow-up continuity. Users may delete it when no longer needed.'
  };
  try { ensureDir(path.dirname(s.planPath)); fs.writeFileSync(s.planPath, JSON.stringify(plan, null, 2)); } catch {}
}
export function cleanupImplicitPlan(s) {
  if (!s?.planPath) return;
  try { if (fs.existsSync(s.planPath)) fs.unlinkSync(s.planPath); } catch {}
}

