import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { resolveLivePluginConfigObject } from 'openclaw/plugin-sdk/plugin-config-runtime';
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = '0.7.0';
const RUNS = new Map();
const SESSION_TO_RUN = new Map();
const CONFIRMED_SESSIONS = new Map();
const MAX_RUNS = 500;
const STATE_TTL_MS = 30 * 60 * 1000;

export function readConfig(raw = {}) {
  return {
    enabled: raw.enabled !== false,
    mode: raw.mode === 'observe' ? 'observe' : 'revise',
    injectPrompt: raw.injectPrompt !== false,
    strictTools: raw.strictTools !== false,
    midRunReflection: raw.midRunReflection !== false,
    semanticReview: raw.semanticReview !== false,
    longTaskMode: raw.longTaskMode !== false,
    autonomousRecovery: raw.autonomousRecovery !== false,
    enforceAutonomousRecovery: raw.enforceAutonomousRecovery !== false,
    skillHints: raw.skillHints !== false,
    implicitPlanFiles: raw.implicitPlanFiles !== false,
    projectPlanFiles: raw.projectPlanFiles !== false,
    cleanupPlanOnSuccess: raw.cleanupPlanOnSuccess === true,
    persistLedger: raw.persistLedger !== false,
    ledgerPromptMode: ['none', 'redacted', 'full'].includes(raw.ledgerPromptMode) ? raw.ledgerPromptMode : 'redacted',
    maxLedgerBytes: Number.isFinite(raw.maxLedgerBytes) ? Math.max(10000, Math.min(5_000_000, Math.trunc(raw.maxLedgerBytes))) : 1_000_000,
    retentionDays: Number.isFinite(raw.retentionDays) ? Math.max(1, Math.min(365, Math.trunc(raw.retentionDays))) : 30,
    reviewerMode: ['rules', 'llm', 'hybrid'].includes(raw.reviewerMode) ? raw.reviewerMode : 'rules',
    codingStrict: raw.codingStrict !== false,
    evidenceScoring: raw.evidenceScoring !== false,
    oracleStrict: raw.oracleStrict !== false,
    changedLinesReview: raw.changedLinesReview !== false,
    blockHighRiskTools: raw.blockHighRiskTools !== false,
    approvalMode: ['approval', 'block'].includes(raw.approvalMode) ? raw.approvalMode : 'approval',
    milestoneReflectionEveryTools: Number.isFinite(raw.milestoneReflectionEveryTools) ? Math.max(3, Math.min(20, Math.trunc(raw.milestoneReflectionEveryTools))) : 5,
    failureBudget: Number.isFinite(raw.failureBudget) ? Math.max(1, Math.min(5, Math.trunc(raw.failureBudget))) : 3,
    maxRevisionAttempts: Number.isFinite(raw.maxRevisionAttempts) ? Math.max(0, Math.min(3, Math.trunc(raw.maxRevisionAttempts))) : 1,
    debug: raw.debug === true,
  };
}

function norm(v) { return String(v || '').toLowerCase(); }
function textOf(v, max = 8000) {
  if (typeof v === 'string') return v.slice(0, max);
  if (!v || typeof v !== 'object') return '';
  try { return JSON.stringify(v).slice(0, max); } catch { return ''; }
}
function sessionKeyOf(ctx = {}, event = {}) {
  return ctx.sessionKey || event.sessionKey || ctx.sessionId || event.sessionId || 'unknown-session';
}
function runKey(ctx = {}, event = {}) {
  if (event.runId || ctx.runId) return event.runId || ctx.runId;
  const sk = sessionKeyOf(ctx, event);
  return SESSION_TO_RUN.get(sk) || `${sk}:turn`;
}
function pruneRuns() {
  const now = Date.now();
  for (const [k, s] of RUNS) if (now - s.updatedAt > STATE_TTL_MS) RUNS.delete(k);
  for (const [k, v] of CONFIRMED_SESSIONS) if (now - v.at > 10 * 60 * 1000) CONFIRMED_SESSIONS.delete(k);
  if (RUNS.size > MAX_RUNS) {
    const oldest = [...RUNS.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]?.[0];
    if (oldest) RUNS.delete(oldest);
  }
}
function getState(k, seed = {}) {
  pruneRuns();
  let s = RUNS.get(k);
  if (!s) {
    s = {
      taskType: seed.taskType || 'tool-task',
      risk: seed.risk || 'normal',
      longTask: seed.longTask === true,
      prompt: seed.prompt || '',
      tools: 0, read: 0, write: 0, verify: 0, status: 0, search: 0, browser: 0, message: 0,
      errors: 0, mutating: 0, external: 0, code: 0, config: 0, data: 0,
      artifactWrite: 0, artifactRead: 0, semanticEvidence: 0, dangerous: 0,
      diffEvidence: 0, testEvidence: 0, buildEvidence: 0, oracleEvidence: 0, changedLinesEvidence: 0, evidenceScore: 0, planPath: '', ledgerPath: '',
      toolNames: new Set(), revisions: 0, toolFailures: [], lastWrites: [], lastReads: [], milestones: [],
      startedAt: Date.now(), updatedAt: Date.now()
    };
    RUNS.set(k, s);
  } else {
    if (seed.taskType) s.taskType = seed.taskType;
    if (seed.risk) s.risk = seed.risk;
    if (typeof seed.longTask === 'boolean') s.longTask = seed.longTask;
    if (seed.prompt) s.prompt = seed.prompt;
    s.updatedAt = Date.now();
  }
  return s;
}

function isConfirmationPrompt(prompt = '') {
  return /^(确认|是的|可以|继续|同意|yes|y|ok|confirm)\b|确认删除|确认发送|确认执行|确认覆盖|用户已确认/i.test(prompt.trim());
}
export function classifyPrompt(prompt = '') {
  let taskType = 'general';
  let risk = 'normal';

  const looksResearch = /(搜索|查询|调研|看看|文档|资料|release|版本|是否|对比|总结|解释|帖子|github|http)/i.test(prompt);
  const looksRuntimeMutation = /(配置|config|重启|restart|启用|禁用|安装|升级|修改|修复|服务|daemon|cron|contextengine|auth|provider|model)/i.test(prompt);
  if (/(代码|bug|接口|controller|service|mapper|编译|构建|测试|lint|maven|npm|vue|java|sql|重构|修复.*报错|实现.*功能|写代码|coding|code|build|test|compile|refactor)/i.test(prompt)) taskType = 'coding';
  else if (looksResearch && !looksRuntimeMutation) taskType = 'research';
  else if (/(openclaw|gateway|插件|plugin|配置|config|重启|restart|服务|daemon|cron|定时|memory|contextengine|auth|provider|model)/i.test(prompt)) taskType = 'config-runtime';
  else if (/(创建|新建|写入|修改|编辑|保存|生成).*(文件|txt|md|json|csv|excel|xlsx|sql|脚本|报告|数据)|下载目录|downloads|[\w.-]+\.(txt|md|json|csv|xlsx|sql|py|js|ts|java|vue)/i.test(prompt)) taskType = 'file-artifact';
  else if (looksResearch) taskType = 'research';
  else if (/(发送|发给|群发|发布|邮件|message|telegram|删除|remove|rm |付费|购买|公开|上传)/i.test(prompt)) taskType = 'external-action';
  else if (prompt.length < 80 && !/(检查|创建|修改|运行|执行|安装|配置|搜索|生成)/i.test(prompt)) taskType = 'simple-qa';

  if (/(删除|remove|rm |覆盖|overwrite|公开|发布|发送|群发|付费|购买|密钥|token|password|cookie|私钥|重启|gateway|config|cron|系统|服务)/i.test(prompt)) risk = 'high';
  const longTask = prompt.length > 180 || /(整体|重构|迁移|排查|诊断|优化|强化|升级|实现|修复|对比|完整|批量|多步骤|长任务|项目|代码库|全量|端到端|闭环|验证.*修复|先.*再.*最后)/i.test(prompt);
  return { taskType, risk, longTask };
}

export function classifyTool(toolName, params, result, error) {
  const t = norm(toolName);
  const p = textOf(params).toLowerCase();
  const r = textOf(result).toLowerCase();
  const c = `${t} ${p} ${r}`;
  const commandOnly = `${t} ${p}`;
  const commandWithoutHereDoc = commandOnly
    .replace(/cat\s+>[^&|;]+<<['\"]?(\w+)['\"]?[\s\S]*?\n\1/g, 'WRITE_HEREDOC')
    .replace(/<<['\"]?(\w+)['\"]?[\s\S]*?\n\1/g, '<<HEREDOC');
  const commandText = commandWithoutHereDoc;
  const inspectionIntent = /grep|rg |sed -n|cat\s+(?!>)|read|status|list|find |logs?|--help|view|inspect|查询|检查/.test(commandText) && !/\brm\s|send|发送|config\.apply/.test(commandText);
  const destructiveIntent = !inspectionIntent && /\brm\s+-|\brm\s|delete|remove|删除|覆盖|overwrite|publish|公开|发送|send|付费|购买|config\.apply|cron.*remove/.test(commandText);
  const write = /^(write|edit|message|cron|image_generate|video_generate|music_generate|tts)$/.test(t)
    || (/^gateway$/.test(t) && /config\.patch|config\.apply|restart|update\.run/.test(commandText))
    || destructiveIntent
    || /config\.patch|config\.apply|restart|action":"send|kind":"fill|kind":"click|kind":"type|cat >|tee |>|mv /.test(commandText);
  const read = /^(read|memory_get|wiki_get|sessions_history|session_status|pdf|image)$/.test(t)
    || t.includes('search') || t.includes('fetch') || t.includes('status') || t.includes('list') || t === 'browser' || t === 'gateway' || /cat\s+(?!>)|grep|ls |stat |wc |find /.test(commandText);
  const artifact = /\.json|\.csv|\.xlsx|\.sql|\.txt|\.md|excel|report|导出|报表|downloads|下载目录/.test(commandOnly);
  const dangerous = destructiveIntent || (!inspectionIntent && /trash|publish|公开|付费|购买/.test(commandText));
  return {
    read,
    write,
    verify: /test|lint|build|compile|doctor|status|logs?|grep|diff|git diff|mvn|npm test|pytest|node -|verify|检查|验证|读回|stat |wc |cat\s+(?!>)/.test(commandWithoutHereDoc) || /verified|passed|ok[:=]true|验证通过/.test(r),
    status: /status|doctor|logs?|health|list|runs|console/.test(commandWithoutHereDoc),
    search: t.includes('search') || t.includes('fetch') || t.includes('extract'),
    browser: t === 'browser',
    message: t === 'message' || /action":"send/.test(commandText),
    error: Boolean(error) || /error|failed|exception|traceback|command exited with code [1-9]|status":"error|no such file|permission denied|denied|cannot|unable/.test(r),
    mutating: write || destructiveIntent || /restart|send|apply|patch|mv /.test(commandText),
    external: /message|send|telegram|discord|slack|email|webhook|publish|upload/.test(commandText),
    code: /mvn|npm|pnpm|yarn|pytest|gradle|javac|tsc|eslint|git diff|node -|\.java|\.vue|\.ts|\.js|function |class /.test(c),
    config: /openclaw|gateway|config|plugin|cron|daemon|launchagent|contextengine/.test(c),
    data: artifact,
    artifactWrite: write && artifact,
    artifactRead: read && artifact && (/cat\s+(?!>)|stat |wc |read|读回/.test(commandWithoutHereDoc) || /bytes|\/users/.test(r)),
    semanticEvidence: /node -|pytest|npm test|mvn test|assert|ok":true|passed|expected|actual|排序|算法|json\.parse|jq |python3 -/.test(c),
    diffEvidence: /git diff|diff --git|changed lines|修改行|diff/.test(c),
    testEvidence: /npm test|pytest|mvn test|gradle test|vitest|jest|测试|test.*passed|ok":true/.test(c),
    buildEvidence: /npm run build|mvn .*compile|mvn .*install|gradle build|tsc|编译|构建|build.*passed/.test(c),
    oracleEvidence: /oracle|口径|同源|等价|对比|expected|actual|golden|baseline|旧逻辑|导出正确|正确接口|business equivalent|same source/.test(c),
    changedLinesEvidence: /git diff|diff --git|changed lines|修改行|逐行|traceable|追溯|每一处|review changed/.test(c),
    dangerous,
    dangerousIntent: destructiveIntent,
    safeInspection: inspectionIntent,
    raw: c
  };
}

export function claimsDone(answer) {
  const a = norm(answer);
  if (!a.trim()) return false;
  return /\b(done|fixed|completed|resolved|working|enabled|installed|configured|verified|passed|ok)\b/.test(a)
    || /(完成|已完成|修好|修复了|解决了|正常|可用|启用|安装好了|配置好了|验证通过|通过了|没问题|已创建|已写入|已生成|好了|ok)/i.test(answer);
}
export function hasEvidenceText(answer) {
  return /(验证|证据|测试|编译|构建|lint|status|logs?|doctor|diff|截图|检查|读回|路径|内容|openclaw status|plugins list|grep|mvn|npm|pytest|通过|输出|显示|stat|wc|cat|样例|结果)/i.test(answer);
}
export function hasBlockedText(answer) {
  return /(\[blocked\]|blocked|阻塞|失败|未完成|风险|需要|无法|报错|error|failed|未验证|不能确认)/i.test(answer);
}
export function asksUserForNextStep(answer) {
  return /(你.*(决定|确认|提供|告诉|选择|补充)|需要你|请你|请提供|请确认|是否要|要不要|下一步.*(怎么办|怎么做)|等你|waiting for|need you|please provide|please confirm)/i.test(answer || '');
}
export function hasRecoveryEvidence(answer) {
  return /(memory|记忆|wiki|rag|session history|会话历史|本地文档|源码|日志|logs?|同类|参考实现|reference|官方文档|docs?|web|网络|搜索|查到|检索|grep|rg |find |read|检查了|对比了|尝试了)/i.test(answer || '');
}
export function evidenceScore(s) {
  if (!s) return 0;
  let score = 0;
  if (s.verify) score += 20;
  if (s.diffEvidence) score += 15;
  if (s.changedLinesEvidence) score += 15;
  if (s.testEvidence) score += 25;
  if (s.buildEvidence) score += 20;
  if (s.artifactRead) score += 15;
  if (s.semanticEvidence) score += 15;
  if (s.status) score += 10;
  if (s.oracleEvidence) score += 25;
  if (s.errors) score -= Math.min(30, s.errors * 10);
  return Math.max(0, Math.min(100, score));
}
export function buildEvidenceSummary(s) {
  if (!s) return 'none';
  s.evidenceScore = evidenceScore(s);
  const parts = [`type=${s.taskType}`, `risk=${s.risk}`, `long=${s.longTask ? 'yes' : 'no'}`, `evidenceScore=${s.evidenceScore}`];
  for (const f of ['tools','read','write','verify','status','search','errors','mutating','external','artifactWrite','artifactRead','semanticEvidence','diffEvidence','changedLinesEvidence','testEvidence','buildEvidence','oracleEvidence','dangerous']) if (s[f]) parts.push(`${f}=${s[f]}`);
  const names = [...s.toolNames].slice(0, 10).join(',');
  return `${parts.join(' ')}${names ? ` names=[${names}]` : ''}`;
}
export function requiresOracle(prompt = '') {
  return /(oracle|口径|同源|等价|对比|导出正确|旧逻辑正确|正确接口|数据一致|业务正确|列表.*导出|统计.*导出|新链路.*旧链路|old logic|golden|baseline)/i.test(prompt || '');
}
export function minimumEvidenceScore(s) {
  if (!s) return 0;
  if (s.taskType === 'coding' && s.write > 0) return requiresOracle(s.prompt) ? 70 : 50;
  if (s.taskType === 'config-runtime' && s.mutating > 0) return 50;
  if (s.taskType === 'file-artifact' && s.artifactWrite > 0) return 35;
  if (s.longTask && s.tools >= 3) return 35;
  return 0;
}

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
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}
export function sanitizePrompt(prompt = '', mode = 'redacted') {
  if (mode === 'none') return '';
  let out = String(prompt || '');
  if (mode !== 'full') {
    out = out
      .replace(/(sk-[a-zA-Z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})/g, '[REDACTED_SECRET]')
      .replace(/([A-Za-z0-9_=-]{20,}\.[A-Za-z0-9_=-]{8,}\.[A-Za-z0-9_=-]{8,})/g, '[REDACTED_TOKEN]')
      .replace(/("?(apiKey|token|password|secret|cookie|authorization)"?\s*[:=]\s*)"?[^"\s,}]+"?/gi, '$1[REDACTED]')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]');
  }
  return out.slice(0, 1000);
}
export function serializeState(s, cfg = {}) {
  if (!s) return null;
  return {
    taskType: s.taskType,
    risk: s.risk,
    longTask: s.longTask,
    prompt: sanitizePrompt(s.prompt, cfg.ledgerPromptMode),
    counters: {
      tools: s.tools, read: s.read, write: s.write, verify: s.verify, status: s.status, search: s.search,
      errors: s.errors, mutating: s.mutating, external: s.external, artifactWrite: s.artifactWrite,
      artifactRead: s.artifactRead, semanticEvidence: s.semanticEvidence, diffEvidence: s.diffEvidence,
      testEvidence: s.testEvidence, buildEvidence: s.buildEvidence, oracleEvidence: s.oracleEvidence, changedLinesEvidence: s.changedLinesEvidence, evidenceScore: evidenceScore(s), dangerous: s.dangerous
    },
    toolNames: [...s.toolNames].slice(0, 20),
    revisions: s.revisions,
    failures: s.toolFailures.slice(-5),
    milestones: s.milestones.slice(-10),
    startedAt: s.startedAt,
    updatedAt: s.updatedAt
  };
}
function appendJsonl(file, obj, cfg = {}) {
  try {
    ensureDir(path.dirname(file));
    if (cfg.maxLedgerBytes && fs.existsSync(file) && fs.statSync(file).size > cfg.maxLedgerBytes) {
      fs.renameSync(file, `${file}.${Date.now()}.old`);
    }
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch {}
}
function pruneOldFiles(dir, retentionDays = 30) {
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
function setupPersistence(api, cfg, k, s, ctx = {}) {
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
function ledger(api, cfg, k, s, event, extra = {}) {
  if (!cfg.persistLedger || !s?.ledgerPath) return;
  appendJsonl(s.ledgerPath, { ts: new Date().toISOString(), version: VERSION, event, run: k, summary: buildEvidenceSummary(s), ...extra }, cfg);
}
function writeImplicitPlan(api, cfg, k, s) {
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
function cleanupImplicitPlan(s) {
  if (!s?.planPath) return;
  try { if (fs.existsSync(s.planPath)) fs.unlinkSync(s.planPath); } catch {}
}

const POLICY = {
  general: 'General: answer all requested items; for tool/state tasks cite evidence; do not claim verified without verification.',
  'simple-qa': 'Simple QA: answer directly and briefly. Do not force a plan unless the user asks.',
  research: 'Research: use current/authoritative sources for mutable facts; distinguish confirmed facts from uncertainty; cite source/tool evidence.',
  'file-artifact': 'File/artifact: if creating or editing a file, avoid unintended overwrite; verify by reading/stat-ing the final file; final answer must include path and readback/stat evidence. If the file content is algorithm/data/config, also do a semantic sanity check when cheap.',
  coding: 'Coding: inspect before edit; keep minimal diff; review changed lines for traceability to the user request; run relevant test/build/lint or explain why impossible; when an oracle exists, prove same-source or business-equivalent behavior; do not claim completion without verification evidence.',
  'config-runtime': 'Config/runtime: inspect docs/schema/current state before changing config; preserve existing config; after changes run status/log/readback verification; restart only when needed and verify service health.',
  'external-action': 'External/destructive: before sending, deleting, publishing, paying, exposing secrets, or irreversible actions, require explicit user confirmation; if unconfirmed, stop and ask one concise question.'
};
const DELIVERY_STYLE = {
  general: 'Use concise adaptive sections only when useful: 结果 / 已做 / 验证 / 风险 or 下一步.',
  'simple-qa': 'No section headers unless the user asks. Keep it short.',
  research: 'Prefer: 结论 / 依据 / 不确定点 or 建议.',
  'file-artifact': 'Prefer: 结果 / 已做 / 验证. Include file path and readback/stat evidence.',
  coding: 'Prefer: 结果 / 改了什么 / 验证 / 风险. If you corrected a mistake, add 纠错. If reusable, add 以后/记住.',
  'config-runtime': 'Prefer: 结果 / 已做 / 验证 / 风险. Include config path/status/log evidence.',
  'external-action': 'If blocked, use: [blocked] 原因 / 需要确认. If completed after confirmation, use: 结果 / 已做 / 验证.'
};
function skillHintFor(taskType, longTask) {
  if (!longTask && taskType !== 'coding' && taskType !== 'config-runtime') return '';
  const hints = {
    coding: 'Skill hint: for complex coding/debug/refactor tasks, prefer loading the most specific coding/planned-execution skill before editing.',
    'config-runtime': 'Skill hint: for OpenClaw/config/runtime work, prefer local docs/schema first; load a relevant troubleshooting/config skill when available.',
    research: 'Skill hint: for accumulated project knowledge, prefer memory/wiki retrieval before web or model recall.',
    general: 'Skill hint: for long multi-step work, use the most specific skill when one clearly applies; otherwise keep a lightweight plan.'
  };
  return hints[taskType] || hints.general;
}
function longTaskGuidance(longTask, cfg) {
  if (!longTask || !cfg.longTaskMode) return '';
  return [
    'Long-task mode: maintain a compact internal ledger: goal, scope, success criteria, current phase, completed items, open risks, next verification.',
    `Milestone reflection: about every ${cfg.milestoneReflectionEveryTools} meaningful tool calls, check drift, failures, and whether the next tool action still serves the goal.`,
    cfg.autonomousRecovery ? 'Autonomous recovery: when a blocker appears, do not ask the user immediately. First pause internally, restate the blocker, then try safe recovery channels: inspect project files and logs, search memory/wiki/session history for prior decisions, check local docs or official docs, web-search mutable external facts, and look for same-project reference implementations. Say “I found an issue; I am checking the next safe path” only when a progress update is useful. Continue once a safe path is found. Ask the user only for irreversible/external/privacy-sensitive approval, a missing business decision, or after recovery channels and the failure budget are exhausted.' : '',
    `Failure budget: after ${cfg.failureBudget} related failures on the same blocker, stop retrying that path; if no safe autonomous path remains, report [blocked] with attempted channels, evidence, and one decision needed from the user.`,
    'For long tasks, do not wait until the final answer to reflect; correct course as soon as tool output contradicts the plan.'
  ].filter(Boolean).join(' ');
}
function guidanceFor(taskType, risk, cfg, longTask = false) {
  const mid = cfg.midRunReflection
    ? 'During execution after each tool result: inspect result → if failed, retry with a different method or mark blocked; if wrote state/file, read back; if generated algorithm/data/config, do a cheap semantic sanity check. It is acceptable to internally correct course; user-visible final should summarize corrections under 纠错 only when relevant.'
    : '';
  return [
    '<delivery_gate>',
    `Plugin version: ${VERSION}. Task classification: ${taskType}; risk: ${risk}.`,
    POLICY[taskType] || POLICY.general,
    skillHintFor(taskType, longTask),
    'Universal loop for non-trivial/tool tasks: define target/scope/success evidence → act → verify/reflect → fix or deliver.',
    longTaskGuidance(longTask, cfg),
    mid,
    'Before final answer: all request items handled; evidence is strong enough, not just present; changed lines are traceable; oracle/business-equivalence is proven when relevant; no unconfirmed destructive/external/privacy/paid action; no “executed” misreported as “verified”.',
    'Delivery wording: do not always use fixed “完成/证据”. Choose compact scenario sections when helpful: 结果, 已做, 验证, 纠错, 记住, 下一次/以后, 风险, [blocked].',
    DELIVERY_STYLE[taskType] || DELIVERY_STYLE.general,
    cfg.autonomousRecovery ? 'When encountering a non-risk blocker mid-task, prefer autonomous investigation over asking the user: memory/wiki → local docs/source/logs → same-project examples → web/official docs when relevant. Only escalate after these fail or when approval/business input is truly required.' : '',
    'If verification is missing or failed, continue with tools if useful; otherwise mark [blocked] with the missing input/next step.',
    '</delivery_gate>'
  ].filter(Boolean).join('\n');
}

export function shouldRevise(answer, s, cfg) {
  if (!s || !cfg.strictTools) return null;
  if (s.errors >= cfg.failureBudget && !hasBlockedText(answer)) return `Failure budget exceeded (${s.errors}/${cfg.failureBudget}); final answer must stop retrying and mark blocked or summarize corrective action.`;
  if (cfg.enforceAutonomousRecovery && s.longTask && asksUserForNextStep(answer) && !hasRecoveryEvidence(answer) && s.dangerous === 0 && s.external === 0) return 'Long task is asking the user for next steps without evidence of autonomous recovery; first check memory/wiki, local docs/source/logs, same-project references, and official/web sources when relevant, unless a real approval/business decision is required.';
  if (s.dangerous > 0 && !hasBlockedText(answer) && !/(确认|用户已确认|confirmed|废纸篓|trash)/i.test(answer)) return 'Dangerous/destructive action detected; final answer must show confirmation/safe handling or mark blocked.';
  if (s.risk === 'high' && s.external > 0 && !hasBlockedText(answer) && !/(确认|用户已确认|confirmed)/i.test(answer)) return 'High-risk external/destructive action detected; final answer must show explicit confirmation or mark blocked.';
  if (!claimsDone(answer)) return null;
  if (s.errors > 0 && !hasBlockedText(answer)) return 'This run had tool errors, but the final answer claims completion without clearly marking failure/blockage.';
  if (s.taskType === 'file-artifact' && s.artifactWrite > 0 && s.artifactRead === 0 && !hasEvidenceText(answer)) return 'File/artifact task wrote a file but has no readback/stat evidence.';
  if (s.taskType === 'coding' && s.write > 0 && s.verify === 0 && !hasBlockedText(answer)) return 'Coding task changed files but has no test/build/lint/diff/readback evidence.';
  if (cfg.codingStrict && s.taskType === 'coding' && s.write > 0 && (s.diffEvidence === 0 && s.testEvidence === 0 && s.buildEvidence === 0) && !hasBlockedText(answer)) return 'Coding task lacks Codex-like closure: no diff/test/build evidence recorded.';
  if (cfg.changedLinesReview && s.taskType === 'coding' && s.write > 0 && s.diffEvidence > 0 && s.changedLinesEvidence === 0 && !hasBlockedText(answer)) return 'Coding task has a diff but no changed-lines traceability review recorded.';
  if (cfg.oracleStrict && requiresOracle(s.prompt) && s.write > 0 && s.oracleEvidence === 0 && !hasBlockedText(answer)) return 'Task mentions a correctness oracle/business-equivalence target, but no oracle comparison evidence was recorded.';
  if (cfg.evidenceScoring && claimsDone(answer) && evidenceScore(s) < minimumEvidenceScore(s) && !hasBlockedText(answer)) return `Evidence score too weak (${evidenceScore(s)}/${minimumEvidenceScore(s)}); final answer needs stronger verification or must mark unverified/blocked.`;
  if (s.taskType === 'config-runtime' && s.mutating > 0 && s.status === 0 && !hasEvidenceText(answer)) return 'Runtime/config task changed state but has no status/log/readback verification.';
  if ((s.write > 0 || s.mutating > 0) && s.verify === 0 && !hasEvidenceText(answer)) return 'This run changed state or files, but the final answer claims completion without verification evidence.';
  if (s.longTask && claimsDone(answer) && s.tools >= 3 && s.verify === 0 && !hasEvidenceText(answer)) return 'Long task claims completion without a verification checkpoint.';
  if (cfg.semanticReview && s.taskType === 'file-artifact' && s.code > 0 && s.artifactWrite > 0 && s.semanticEvidence === 0 && !hasEvidenceText(answer)) return 'Generated code/algorithm artifact lacks a cheap semantic sanity check.';
  if (s.taskType === 'research' && s.tools > 0 && s.search === 0 && !hasEvidenceText(answer)) return 'Research task used tools but final answer lacks source/evidence signal.';
  return null;
}

export default definePluginEntry({
  id: 'delivery-gate',
  name: 'Delivery Gate',
  description: 'Runtime delivery reflection gate with dynamic task policies, mid-run reflection guidance, and semantic artifact checks.',
  register(api) {
    const cfgNow = () => readConfig(resolveLivePluginConfigObject(api.runtime?.config?.current ? () => api.runtime.config.current() : undefined, 'delivery-gate', api.pluginConfig));

    async function llmReviewIfNeeded(event, s, answer, cfg) {
      if (!api.runtime?.llm?.complete || cfg.reviewerMode === 'rules') return null;
      if (!claimsDone(answer) && !hasBlockedText(answer)) return null;
      const payload = {
        taskType: s.taskType,
        risk: s.risk,
        longTask: s.longTask,
        evidence: buildEvidenceSummary(s),
        prompt: sanitizePrompt(s.prompt, cfg.ledgerPromptMode),
        finalAnswer: String(answer || '').slice(0, 3000)
      };
      try {
        const result = await api.runtime.llm.complete({
          purpose: 'delivery-gate.review',
          maxTokens: 220,
          temperature: 0,
          messages: [
            { role: 'system', content: 'You are a strict delivery gate reviewer. Return compact JSON only: {"decision":"pass|revise|blocked","reason":"..."}. Revise if completion lacks evidence, misses user request, ignores risk, or should run one more verification. Blocked if unsafe or impossible.' },
            { role: 'user', content: JSON.stringify(payload) }
          ]
        });
        const txt = result?.text || result?.content || result?.message || '';
        const m = String(txt).match(/\{[\s\S]*\}/);
        if (!m) return null;
        const parsed = JSON.parse(m[0]);
        if (parsed?.decision === 'revise' || parsed?.decision === 'blocked') return `LLM reviewer ${parsed.decision}: ${parsed.reason || 'delivery gate failed'}`;
      } catch (err) {
        api.logger.warn?.(`[delivery-gate] llm reviewer failed: ${err?.message || err}`);
      }
      return null;
    }

    api.on('before_prompt_build', async (event, ctx) => {
      const cfg = cfgNow();
      if (!cfg.enabled || !cfg.injectPrompt) return;
      const { taskType, risk, longTask } = classifyPrompt(event.prompt || '');
      const k = runKey(ctx, event);
      const sk = sessionKeyOf(ctx, event);
      SESSION_TO_RUN.set(sk, k);
      const state = getState(k, { taskType, risk, longTask, prompt: event.prompt || '' });
      setupPersistence(api, cfg, k, state, ctx);
      writeImplicitPlan(api, cfg, k, state);
      pruneOldFiles(path.join(api.runtime.state.resolveStateDir(), 'plugins', 'delivery-gate', 'runs'), cfg.retentionDays);
      ledger(api, cfg, k, state, 'turn_start', { prompt: sanitizePrompt(event.prompt || '', cfg.ledgerPromptMode) });
      if (isConfirmationPrompt(event.prompt || '')) CONFIRMED_SESSIONS.set(sk, { at: Date.now(), text: event.prompt || '' });
      if (cfg.debug) api.logger.info?.(`[delivery-gate] classify v=${VERSION} run=${k} type=${taskType} risk=${risk} long=${longTask}`);
      return { appendSystemContext: guidanceFor(taskType, risk, cfg, longTask) };
    });

    api.on('before_tool_call', async (event, ctx) => {
      const cfg = cfgNow();
      if (!cfg.enabled || !cfg.blockHighRiskTools) return;
      const k = runKey(ctx, event);
      const sk = sessionKeyOf(ctx, event);
      const s = getState(k);
      const c = classifyTool(event.toolName, event.params, undefined, undefined);
      if ((s.risk === 'high' || s.taskType === 'external-action') && (c.external || c.dangerous)) {
        const p = textOf(event.params).toLowerCase();
        const recentlyConfirmed = CONFIRMED_SESSIONS.has(sk);
        if (c.safeInspection || !c.dangerousIntent) return;
        if (!recentlyConfirmed && !/(confirmed|用户已确认|已确认|confirm\s*:\s*true)/i.test(p)) {
          ledger(api, cfg, k, s, 'tool_blocked', { tool: event.toolName || 'unknown', reason: 'explicit confirmation required', mode: cfg.approvalMode });
          if (cfg.approvalMode === 'block') {
            return { block: true, blockReason: 'delivery-gate: external/high-risk action requires explicit user confirmation' };
          }
          return {
            requireApproval: {
              title: 'Delivery Gate approval',
              description: summarizeApproval(event.toolName, event.params),
              severity: c.dangerousIntent ? 'critical' : 'warning',
              allowedDecisions: ['allow-once', 'deny'],
              timeoutMs: 120_000,
              timeoutBehavior: 'deny',
              pluginId: 'delivery-gate',
              onResolution(decision) {
                ledger(api, cfg, k, s, 'approval_resolved', { decision });
                if (decision === 'allow-once') CONFIRMED_SESSIONS.set(sk, { at: Date.now(), text: 'native approval allow-once' });
              }
            }
          };
        }
      }
    });

    api.on('after_tool_call', async (event, ctx) => {
      const cfg = cfgNow();
      if (!cfg.enabled) return;
      const k = runKey(ctx, event);
      const s = getState(k);
      const c = classifyTool(event.toolName, event.params, event.result, event.error);
      s.tools += 1;
      s.toolNames.add(event.toolName || 'unknown');
      for (const field of ['read','write','verify','status','search','browser','message','errors','mutating','external','code','config','data','artifactWrite','artifactRead','semanticEvidence','diffEvidence','changedLinesEvidence','testEvidence','buildEvidence','oracleEvidence','dangerous']) {
        const source = field === 'errors' ? c.error : c[field];
        if (source) s[field] += 1;
      }
      if (c.error) s.toolFailures.push({ tool: event.toolName || 'unknown', sample: textOf(event.result || event.error, 500) });
      if (c.artifactWrite) s.lastWrites.push(textOf(event.params, 500));
      if (c.artifactRead) s.lastReads.push(textOf(event.result, 500));
      setupPersistence(api, cfg, k, s, ctx);
      ledger(api, cfg, k, s, 'tool_result', { tool: event.toolName || 'unknown', class: { read: c.read, write: c.write, verify: c.verify, error: c.error, dangerous: c.dangerous } });
      s.updatedAt = Date.now();
      if (cfg.longTaskMode && s.longTask && s.tools > 0 && s.tools % cfg.milestoneReflectionEveryTools === 0) {
        s.milestones.push({ at: Date.now(), tools: s.tools, errors: s.errors, verify: s.verify, summary: buildEvidenceSummary(s) });
        api.logger.info?.(`[delivery-gate] milestone v=${VERSION} run=${k} ${buildEvidenceSummary(s)}`);
      }
      if (cfg.debug) api.logger.info?.(`[delivery-gate] after_tool_call v=${VERSION} run=${k} ${buildEvidenceSummary(s)}`);
    });

    api.on('before_agent_finalize', async (event, ctx) => {
      const cfg = cfgNow();
      if (!cfg.enabled || cfg.mode !== 'revise' || cfg.maxRevisionAttempts <= 0) return;
      const k = runKey(ctx, event);
      const s = RUNS.get(k) || getState(k);
      const answer = event.lastAssistantMessage || '';
      let reason = shouldRevise(answer, s, cfg);
      if (!reason && cfg.reviewerMode !== 'rules') reason = await llmReviewIfNeeded(event, s, answer, cfg);
      ledger(api, cfg, k, s, 'finalize_check', { reason: reason || null, answerSample: String(answer || '').slice(0, 1000) });
      if (!reason) return;
      s.revisions += 1;
      if (s.revisions > cfg.maxRevisionAttempts) return { action: 'continue', reason: 'delivery-gate max revision attempts reached' };
      const evidence = buildEvidenceSummary(s);
      api.logger.warn?.(`[delivery-gate] requesting revision v=${VERSION} run=${k}: ${reason} ${evidence}`);
      return {
        action: 'revise',
        reason: `Delivery gate failed: ${reason} Evidence ledger: ${evidence}`,
        retry: {
          idempotencyKey: `delivery-gate:${k}:${s.taskType}:v${VERSION}`,
          maxAttempts: cfg.maxRevisionAttempts,
          instruction: [
            'Before finalizing, perform a concise delivery-gate self-check.',
            `Task type: ${s.taskType}; risk: ${s.risk}; longTask: ${s.longTask ? 'yes' : 'no'}`,
            `Issue: ${reason}`,
            `Evidence ledger: ${evidence}`,
            'If one more tool action can verify/fix the result, do it before answering.',
            'For file/code/data artifacts, read back the file and run a cheap semantic sanity check when possible.',
            'If you are about to ask the user for next steps on a non-risk long-task blocker, first try autonomous recovery: memory/wiki, local docs/source/logs, same-project references, and official/web sources when relevant.',
            'If you cannot verify, do not claim completion; mark [blocked] or say what remains unverified.',
            'Final answer must include concrete evidence when claiming completion, including changed-lines review and oracle/business-equivalence comparison when relevant.'
          ].join('\n')
        }
      };
    });

    api.on('agent_end', async (event, ctx) => {
      const cfg = cfgNow();
      if (!cfg.enabled) return;
      const k = runKey(ctx, event);
      const s = RUNS.get(k);
      if (cfg.debug && s) api.logger.info?.(`[delivery-gate] agent_end v=${VERSION} run=${k} success=${event.success} ${buildEvidenceSummary(s)}`);
      if (s) {
        ledger(api, cfg, k, s, 'agent_end', { success: event.success === true, final: serializeState(s, cfg) });
        if (cfg.cleanupPlanOnSuccess && event.success !== false) cleanupImplicitPlan(s);
      }
      setTimeout(() => RUNS.delete(k), 60_000).unref?.();
    });
  }
});
