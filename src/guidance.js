import { VERSION } from './version.js';

export const POLICY = {
  general: 'General: answer all requested items; for tool/state tasks cite evidence; do not claim verified without verification.',
  'simple-qa': 'Simple QA: answer directly and briefly. Do not force a plan unless the user asks.',
  research: 'Research: use current/authoritative sources for mutable facts; distinguish confirmed facts from uncertainty; cite source/tool evidence.',
  'file-artifact': 'File/artifact: if creating or editing a file, avoid unintended overwrite; verify by reading/stat-ing the final file; final answer must include path and readback/stat evidence. If the file content is algorithm/data/config, also do a semantic sanity check when cheap.',
  coding: 'Coding: inspect before edit; keep minimal diff; review changed lines for traceability to the user request; run relevant test/build/lint or explain why impossible; when an oracle exists, prove same-source or business-equivalent behavior; do not claim completion without verification evidence.',
  'config-runtime': 'Config/runtime: inspect docs/schema/current state before changing config; preserve existing config; after changes run status/log/readback verification; restart only when needed and verify service health.',
  'external-action': 'External/destructive: before sending, deleting, publishing, paying, exposing secrets, or irreversible actions, require explicit user confirmation; if unconfirmed, stop and ask one concise question.'
};
export const DELIVERY_STYLE = {
  general: 'Use concise adaptive sections only when useful: 结果 / 已做 / 验证 / 风险 or 下一步.',
  'simple-qa': 'No section headers unless the user asks. Keep it short.',
  research: 'Prefer: 结论 / 依据 / 不确定点 or 建议.',
  'file-artifact': 'Prefer: 结果 / 已做 / 验证. Include file path and readback/stat evidence.',
  coding: 'Prefer: 结果 / 改了什么 / 验证 / 风险. If you corrected a mistake, add 纠错. If reusable, add 以后/记住.',
  'config-runtime': 'Prefer: 结果 / 已做 / 验证 / 风险. Include config path/status/log evidence.',
  'external-action': 'If blocked, use: [blocked] 原因 / 需要确认. If completed after confirmation, use: 结果 / 已做 / 验证.'
};
export function skillHintFor(taskType, longTask) {
  if (!longTask && taskType !== 'coding' && taskType !== 'config-runtime') return '';
  const hints = {
    coding: 'Skill hint: for complex coding/debug/refactor tasks, prefer loading the most specific coding/planned-execution skill before editing.',
    'config-runtime': 'Skill hint: for OpenClaw/config/runtime work, prefer local docs/schema first; load a relevant troubleshooting/config skill when available.',
    research: 'Skill hint: for accumulated project knowledge, prefer memory/wiki retrieval before web or model recall.',
    general: 'Skill hint: for long multi-step work, use the most specific skill when one clearly applies; otherwise keep a lightweight plan.'
  };
  return hints[taskType] || hints.general;
}
export function longTaskGuidance(longTask, cfg) {
  if (!longTask || !cfg.longTaskMode) return '';
  return [
    'Long-task mode: maintain a compact internal ledger: goal, scope, success criteria, current phase, completed items, open risks, next verification.',
    `Milestone reflection: about every ${cfg.milestoneReflectionEveryTools} meaningful tool calls, check drift, failures, and whether the next tool action still serves the goal.`,
    cfg.autonomousRecovery ? 'Autonomous recovery: when a blocker appears, do not ask the user immediately. First pause internally, restate the blocker, then try safe recovery channels: inspect project files and logs, search memory/wiki/session history for prior decisions, check local docs or official docs, web-search mutable external facts, and look for same-project reference implementations. Say “I found an issue; I am checking the next safe path” only when a progress update is useful. Continue once a safe path is found. Ask the user only for irreversible/external/privacy-sensitive approval, a missing business decision, or after recovery channels and the failure budget are exhausted.' : '',
    `Failure budget: after ${cfg.failureBudget} related failures on the same blocker, stop retrying that path; if no safe autonomous path remains, report [blocked] with attempted channels, evidence, and one decision needed from the user.`,
    'For long tasks, do not wait until the final answer to reflect; correct course as soon as tool output contradicts the plan.'
  ].filter(Boolean).join(' ');
}
export function guidanceFor(taskType, risk, cfg, longTask = false) {
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

