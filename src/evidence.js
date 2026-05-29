import { norm } from './utils.js';

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
  for (const f of ['tools','read','write','verify','status','search','errors','mutating','external','artifactWrite','artifactRead','semanticEvidence','diffEvidence','changedLinesEvidence','testEvidence','buildEvidence','oracleEvidence','docLocaleIssue','dangerous']) if (s[f]) parts.push(`${f}=${s[f]}`);
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
      testEvidence: s.testEvidence, buildEvidence: s.buildEvidence, oracleEvidence: s.oracleEvidence, changedLinesEvidence: s.changedLinesEvidence, docLocaleIssue: s.docLocaleIssue, evidenceScore: evidenceScore(s), dangerous: s.dangerous
    },
    toolNames: [...s.toolNames].slice(0, 20),
    revisions: s.revisions,
    failures: s.toolFailures.slice(-5),
    milestones: s.milestones.slice(-10),
    startedAt: s.startedAt,
    updatedAt: s.updatedAt
  };
}

export function containsCjk(text = '') {
  return /[\u4e00-\u9fff]/.test(String(text || ''));
}
export function hasLatinWord(text = '') {
  return /\b[A-Za-z][A-Za-z'’-]{2,}\b/.test(String(text || ''));
}
export function hasDocLocaleIssueFromText(text = '') {
  const t = String(text || '');
  if (!/README|\.md|markdown|文档|doc/i.test(t)) return false;
  const mentionsEnglishDoc = /README\.md\b|English README|英文文档|英文 README/i.test(t);
  const mentionsChineseDoc = /README\.zh-CN\.md\b|中文文档|中文 README|Chinese README/i.test(t);
  if (mentionsEnglishDoc && containsCjk(t) && !/README\.zh-CN\.md\b/.test(t)) return true;
  if (mentionsChineseDoc && /No half-baked work|No bullshit|transitional delivery-gate plugin|AI Agent installation brief/i.test(t) && !/README\.md\b/.test(t)) return true;
  return false;
}
