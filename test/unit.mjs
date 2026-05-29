import assert from 'node:assert/strict';
import {
  VERSION,
  readConfig,
  classifyPrompt,
  classifyTool,
  sanitizePrompt,
  shouldRevise,
  buildEvidenceSummary,
  evidenceScore,
  minimumEvidenceScore,
  requiresOracle,
  hasDocLocaleIssueFromText,
  summarizeApproval,
} from '../index.js';

function baseState(overrides = {}) {
  return {
    taskType: 'general', risk: 'normal', longTask: false, prompt: '',
    tools: 0, read: 0, write: 0, verify: 0, status: 0, search: 0,
    errors: 0, mutating: 0, external: 0, code: 0, config: 0, data: 0,
    artifactWrite: 0, artifactRead: 0, semanticEvidence: 0, diffEvidence: 0, changedLinesEvidence: 0, testEvidence: 0, buildEvidence: 0, oracleEvidence: 0, evidenceScore: 0, dangerous: 0,
    toolNames: new Set(), revisions: 0, toolFailures: [], lastWrites: [], lastReads: [], milestones: [],
    ...overrides,
  };
}
const cfg = readConfig({});

assert.equal(VERSION, '0.7.0');
assert.equal(readConfig({ milestoneReflectionEveryTools: 1 }).milestoneReflectionEveryTools, 3);
assert.equal(readConfig({ failureBudget: 99 }).failureBudget, 5);
assert.equal(readConfig({ ledgerPromptMode: 'bad' }).ledgerPromptMode, 'redacted');
assert.equal(readConfig({ approvalMode: 'bad' }).approvalMode, 'approval');
assert.equal(readConfig({ approvalMode: 'block' }).approvalMode, 'block');
assert.equal(readConfig({ autonomousRecovery: false }).autonomousRecovery, false);
assert.equal(readConfig({}).autonomousRecovery, true);
assert.equal(readConfig({ enforceAutonomousRecovery: false }).enforceAutonomousRecovery, false);
assert.equal(readConfig({}).enforceAutonomousRecovery, true);
assert.equal(readConfig({ evidenceScoring: false }).evidenceScoring, false);
assert.equal(readConfig({}).evidenceScoring, true);
assert.equal(readConfig({ oracleStrict: false }).oracleStrict, false);
assert.equal(readConfig({}).oracleStrict, true);
assert.equal(readConfig({ changedLinesReview: false }).changedLinesReview, false);
assert.equal(readConfig({}).changedLinesReview, true);
assert.equal(readConfig({ docLocaleConsistency: false }).docLocaleConsistency, false);
assert.equal(readConfig({}).docLocaleConsistency, true);

// prompt classification
assert.deepEqual(classifyPrompt('修复 Java 接口 bug 并跑测试').taskType, 'coding');
assert.deepEqual(classifyPrompt('升级 openclaw 插件配置并重启验证').taskType, 'config-runtime');
assert.deepEqual(classifyPrompt('在下载目录创建 report.json 文件').taskType, 'file-artifact');
assert.deepEqual(classifyPrompt('搜索 OpenClaw 2026.5.27 release 文档').taskType, 'research');
assert.deepEqual(classifyPrompt('删除 downloads/a.txt').risk, 'high');
assert.equal(classifyPrompt('整体优化这个项目并完成端到端验证').longTask, true);
assert.equal(classifyPrompt('什么是冒泡排序').taskType, 'simple-qa');

// tool classification / false positives
let c = classifyTool('exec', { command: 'grep -R "delete" src | head' }, 'delete keyword only', null);
assert.equal(c.safeInspection, true, 'grep delete should be safe inspection');
assert.equal(c.dangerousIntent, false, 'grep delete should not be dangerous intent');
assert.equal(c.write, false, 'grep delete result should not be counted as write');
assert.equal(c.dangerous, false, 'grep delete result should not be counted as dangerous');
c = classifyTool('read', { path: '/tmp/delete-notes.md' }, 'delete keyword only', null);
assert.equal(c.write, false, 'read result containing delete should not be counted as write');
assert.equal(c.dangerous, false, 'read result containing delete should not be counted as dangerous');
c = classifyTool('exec', { command: 'rm -f ~/Downloads/a.txt' }, '', null);
assert.equal(c.dangerousIntent, true, 'rm should be dangerous intent');
c = classifyTool('exec', { command: 'cat > ~/Downloads/a.txt <<EOF\nhi\nEOF\nstat ~/Downloads/a.txt' }, 'ok', null);
assert.equal(c.write, true);
assert.equal(c.verify, true);
assert.equal(c.artifactWrite, true);
c = classifyTool('exec', { command: 'python3 - <<PY\nassert sorted(set([2,1,2])) == [1,2]\nPY' }, '{"ok":true}', null);
assert.equal(c.semanticEvidence, true);
c = classifyTool('exec', { command: 'git diff && echo changed lines traceable && echo expected actual oracle 对比同源' }, 'ok', null);
assert.equal(c.diffEvidence, true);
assert.equal(c.changedLinesEvidence, true);
assert.equal(c.oracleEvidence, true);
c = classifyTool('edit', { path: 'README.md', oldText: '# Title', newText: '# Title\n\n啊... 这是给openclaw的一个交付门禁过度插件。' }, 'Successfully replaced', null);
assert.equal(c.docLocaleIssue, true);

// redaction
const secret = 'apiKey: sk-1234567890abcdefABCDEF token="abc.defghijk.lmnopqrst" Authorization: Bearer qwerty1234567890';
const redacted = sanitizePrompt(secret);
assert.ok(!redacted.includes('sk-1234567890abcdefABCDEF'));
assert.ok(!redacted.includes('Bearer qwerty1234567890'));
assert.ok(!summarizeApproval('exec', { command: 'echo sk-1234567890abcdefABCDEF' }).includes('sk-1234567890abcdefABCDEF'));
assert.equal(sanitizePrompt(secret, 'none'), '');
assert.ok(sanitizePrompt(secret, 'full').includes('sk-1234567890abcdefABCDEF'));

// revise matrix
assert.match(shouldRevise('完成了', baseState({ write:1, mutating:1 }), cfg), /verification evidence/);
assert.equal(shouldRevise('已完成。验证：stat 和 cat 已读回。', baseState({ write:1, mutating:1, verify:1 }), cfg), null);
assert.match(shouldRevise('完成', baseState({ taskType:'file-artifact', artifactWrite:1, write:1, mutating:1 }), cfg), /readback/);
assert.match(shouldRevise('完成', baseState({ taskType:'coding', write:1, mutating:1 }), cfg), /test\/build\/lint\/diff\/readback|closure/);
assert.match(shouldRevise('完成了。验证：git diff 已检查。', baseState({ taskType:'coding', write:1, mutating:1, verify:1, diffEvidence:1 }), cfg), /changed-lines traceability/);
assert.match(shouldRevise('完成了。验证：git diff 和 changed lines 已检查。', baseState({ taskType:'coding', prompt:'列表需要和导出正确口径同源', write:1, mutating:1, verify:1, diffEvidence:1, changedLinesEvidence:1, testEvidence:1 }), cfg), /oracle comparison/);
assert.match(shouldRevise('完成了。验证：读回。', baseState({ taskType:'file-artifact', write:1, mutating:1, verify:1, artifactWrite:1 }), cfg), /Evidence score too weak/);
assert.equal(shouldRevise('完成了。验证：git diff、changed lines、npm test、oracle 对比同源。', baseState({ taskType:'coding', prompt:'列表需要和导出正确口径同源', write:1, mutating:1, verify:1, diffEvidence:1, changedLinesEvidence:1, testEvidence:1, oracleEvidence:1 }), cfg), null);
assert.match(shouldRevise('已完成。验证：已读回 README.md 顶部：啊... 这是给openclaw的一个交付门禁过度插件。', baseState({ taskType:'file-artifact', write:1, mutating:1, verify:1, docLocaleIssue:1 }), cfg), /locale mismatch/);
assert.equal(shouldRevise('已完成。验证：README.md uses English slogan, README.zh-CN.md uses Chinese slogan.', baseState({ taskType:'file-artifact', write:1, mutating:1, verify:1, artifactWrite:1, artifactRead:1 }), cfg), null);
assert.equal(shouldRevise('[blocked] 测试失败，需要依赖服务。', baseState({ errors:3 }), cfg), null);
assert.match(shouldRevise('遇到问题了，需要你告诉我下一步怎么办。', baseState({ longTask:true }), cfg), /autonomous recovery/);
assert.equal(shouldRevise('遇到问题了，我已查 memory/wiki、本地源码和官方文档，仍需要你确认业务口径。', baseState({ longTask:true }), cfg), null);
assert.match(shouldRevise('完成了', baseState({ errors:3 }), cfg), /Failure budget/);
assert.match(shouldRevise('已删除', baseState({ dangerous:1 }), cfg), /Dangerous/);
assert.equal(shouldRevise('已确认后移到废纸篓。验证：路径不存在。', baseState({ dangerous:1, verify:1 }), cfg), null);

// evidence summary should not crash
const summary = buildEvidenceSummary(baseState({ taskType:'coding', toolNames:new Set(['exec']), testEvidence:1 }));
assert.ok(summary.includes('testEvidence=1'));
assert.ok(summary.includes('evidenceScore='));
assert.equal(requiresOracle('导出正确，列表要和导出口径同源'), true);
assert.equal(minimumEvidenceScore(baseState({ taskType:'coding', write:1, prompt:'导出正确，列表要和导出口径同源' })), 70);
assert.ok(evidenceScore(baseState({ verify:1, diffEvidence:1, changedLinesEvidence:1, testEvidence:1, oracleEvidence:1 })) >= 70);
assert.equal(hasDocLocaleIssueFromText('README.md 顶部：啊... 这是给openclaw的一个交付门禁过度插件。'), true);

console.log('delivery-gate unit matrix ok');
