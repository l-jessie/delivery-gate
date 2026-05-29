export const RUNS = new Map();
export const SESSION_TO_RUN = new Map();
export const CONFIRMED_SESSIONS = new Map();
export const MAX_RUNS = 500;
export const STATE_TTL_MS = 30 * 60 * 1000;

export function norm(v) { return String(v || '').toLowerCase(); }
export function textOf(v, max = 8000) {
  if (typeof v === 'string') return v.slice(0, max);
  if (!v || typeof v !== 'object') return '';
  try { return JSON.stringify(v).slice(0, max); } catch { return ''; }
}
export function sessionKeyOf(ctx = {}, event = {}) {
  return ctx.sessionKey || event.sessionKey || ctx.sessionId || event.sessionId || 'unknown-session';
}
export function runKey(ctx = {}, event = {}) {
  if (event.runId || ctx.runId) return event.runId || ctx.runId;
  const sk = sessionKeyOf(ctx, event);
  return SESSION_TO_RUN.get(sk) || `${sk}:turn`;
}
export function pruneRuns() {
  const now = Date.now();
  for (const [k, s] of RUNS) if (now - s.updatedAt > STATE_TTL_MS) RUNS.delete(k);
  for (const [k, v] of CONFIRMED_SESSIONS) if (now - v.at > 10 * 60 * 1000) CONFIRMED_SESSIONS.delete(k);
  if (RUNS.size > MAX_RUNS) {
    const oldest = [...RUNS.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0]?.[0];
    if (oldest) RUNS.delete(oldest);
  }
}
export function getState(k, seed = {}) {
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
      diffEvidence: 0, testEvidence: 0, buildEvidence: 0, oracleEvidence: 0, changedLinesEvidence: 0, docLocaleIssue: 0, evidenceScore: 0, planPath: '', ledgerPath: '',
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
export function isConfirmationPrompt(prompt = '') {
  return /^(确认|是的|可以|继续|同意|yes|y|ok|confirm)\b|确认删除|确认发送|确认执行|确认覆盖|用户已确认/i.test(prompt.trim());
}
