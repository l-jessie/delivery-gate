import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin from '../index.js';

function createApi(config = {}) {
  const handlers = new Map();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-hook-'));
  const logs = [];
  return {
    tmp,
    handlers,
    logs,
    api: {
      pluginConfig: config,
      config: {},
      logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) },
      runtime: {
        state: { resolveStateDir: () => tmp },
        config: { current: () => ({ plugins: { entries: { 'delivery-gate': { config } } } }) },
      },
      on(name, fn) { handlers.set(name, fn); },
    },
  };
}
async function setup(config = {}) {
  const h = createApi({ enabled: true, debug: true, ...config });
  plugin.register(h.api);
  return h;
}

// 1. before_prompt_build classifies long coding task and writes project-local plan.
{
  const h = await setup({ persistLedger: true, implicitPlanFiles: true, projectPlanFiles: true });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-workspace-'));
  const event = { runId: 'run-coding-1', prompt: '整体优化这个项目的 Java 接口 bug，修改代码后跑测试并验证完整链路', messages: [] };
  const ctx = { runId: 'run-coding-1', sessionKey: 's1', workspaceDir: workspace };
  const res = await h.handlers.get('before_prompt_build')(event, ctx);
  assert.match(res.appendSystemContext, /Task classification: coding/);
  assert.match(res.appendSystemContext, /Long-task mode/);
  const planDir = path.join(workspace, '.openclaw', 'plans');
  assert.ok(fs.existsSync(planDir), 'project plan dir should exist');
  assert.equal(fs.readdirSync(planDir).length, 1, 'one project plan should be written');
}

// 2. before_tool_call requests native approval by default for destructive action before confirmation.
{
  const h = await setup();
  await h.handlers.get('before_prompt_build')({ runId: 'run-del-1', prompt: '删除 downloads/a.txt', messages: [] }, { runId: 'run-del-1', sessionKey: 's2' });
  const approval = await h.handlers.get('before_tool_call')({ runId: 'run-del-1', toolName: 'exec', params: { command: 'rm -f ~/Downloads/a.txt' } }, { runId: 'run-del-1', sessionKey: 's2' });
  assert.ok(approval.requireApproval);
  assert.equal(approval.requireApproval.pluginId, 'delivery-gate');
  assert.deepEqual(approval.requireApproval.allowedDecisions, ['allow-once', 'deny']);
  assert.match(approval.requireApproval.description, /exec:/);
}

// 2b. legacy block mode still blocks destructive action before confirmation.
{
  const h = await setup({ approvalMode: 'block' });
  await h.handlers.get('before_prompt_build')({ runId: 'run-del-block-1', prompt: '删除 downloads/a.txt', messages: [] }, { runId: 'run-del-block-1', sessionKey: 's2b' });
  const block = await h.handlers.get('before_tool_call')({ runId: 'run-del-block-1', toolName: 'exec', params: { command: 'rm -f ~/Downloads/a.txt' } }, { runId: 'run-del-block-1', sessionKey: 's2b' });
  assert.equal(block.block, true);
  assert.match(block.blockReason, /requires explicit user confirmation/);
}

// 3. before_tool_call allows safe grep containing delete.
{
  const h = await setup();
  await h.handlers.get('before_prompt_build')({ runId: 'run-grep-1', prompt: '检查代码里 delete 的用法', messages: [] }, { runId: 'run-grep-1', sessionKey: 's3' });
  const res = await h.handlers.get('before_tool_call')({ runId: 'run-grep-1', toolName: 'exec', params: { command: 'grep -R "delete" src | head' } }, { runId: 'run-grep-1', sessionKey: 's3' });
  assert.equal(res, undefined);
}

// 4. file artifact without readback triggers final revise.
{
  const h = await setup();
  await h.handlers.get('before_prompt_build')({ runId: 'run-file-1', prompt: '在下载目录创建 a.txt 文件', messages: [] }, { runId: 'run-file-1', sessionKey: 's4' });
  await h.handlers.get('after_tool_call')({ runId: 'run-file-1', toolName: 'exec', params: { command: 'cat > ~/Downloads/a.txt <<EOF\nhi\nEOF' }, result: 'ok' }, { runId: 'run-file-1', sessionKey: 's4' });
  const fin = await h.handlers.get('before_agent_finalize')({ runId: 'run-file-1', sessionId: 'sid', lastAssistantMessage: '完成了' }, { runId: 'run-file-1', sessionKey: 's4' });
  assert.equal(fin.action, 'revise');
  assert.match(fin.reason, /readback|verification/);
}

// 5. file artifact with readback passes final gate.
{
  const h = await setup();
  await h.handlers.get('before_prompt_build')({ runId: 'run-file-2', prompt: '在下载目录创建 a.txt 文件', messages: [] }, { runId: 'run-file-2', sessionKey: 's5' });
  await h.handlers.get('after_tool_call')({ runId: 'run-file-2', toolName: 'exec', params: { command: 'cat > ~/Downloads/a.txt <<EOF\nhi\nEOF\nstat ~/Downloads/a.txt\ncat ~/Downloads/a.txt' }, result: '12 bytes /Users/me/Downloads/a.txt\nhi' }, { runId: 'run-file-2', sessionKey: 's5' });
  const fin = await h.handlers.get('before_agent_finalize')({ runId: 'run-file-2', sessionId: 'sid', lastAssistantMessage: '结果：已创建。验证：stat 和 cat 已读回。' }, { runId: 'run-file-2', sessionKey: 's5' });
  assert.equal(fin, undefined);
}

// 6. coding write without diff/test/build triggers Codex-like revise.
{
  const h = await setup();
  await h.handlers.get('before_prompt_build')({ runId: 'run-code-1', prompt: '修改 Java 代码修复 bug', messages: [] }, { runId: 'run-code-1', sessionKey: 's6' });
  await h.handlers.get('after_tool_call')({ runId: 'run-code-1', toolName: 'edit', params: { path: 'A.java', oldText: 'a', newText: 'b' }, result: 'edited' }, { runId: 'run-code-1', sessionKey: 's6' });
  const fin = await h.handlers.get('before_agent_finalize')({ runId: 'run-code-1', sessionId: 'sid', lastAssistantMessage: '完成了' }, { runId: 'run-code-1', sessionKey: 's6' });
  assert.equal(fin.action, 'revise');
  assert.match(fin.reason, /Coding task/);
}

// 7. failure budget triggers revise/blocked requirement.
{
  const h = await setup({ failureBudget: 3 });
  await h.handlers.get('before_prompt_build')({ runId: 'run-fail-1', prompt: '排查并修复一个长任务问题', messages: [] }, { runId: 'run-fail-1', sessionKey: 's7' });
  for (let i = 0; i < 3; i++) await h.handlers.get('after_tool_call')({ runId: 'run-fail-1', toolName: 'exec', params: { command: 'bad' }, result: 'Error: failed', error: 'failed' }, { runId: 'run-fail-1', sessionKey: 's7' });
  const fin = await h.handlers.get('before_agent_finalize')({ runId: 'run-fail-1', sessionId: 'sid', lastAssistantMessage: '完成了' }, { runId: 'run-fail-1', sessionKey: 's7' });
  assert.equal(fin.action, 'revise');
  assert.match(fin.reason, /Failure budget/);
}

// 8. ledger persists and redacts prompt.
{
  const h = await setup({ persistLedger: true, ledgerPromptMode: 'redacted' });
  await h.handlers.get('before_prompt_build')({ runId: 'run-ledger-1', prompt: '保存 apiKey: sk-1234567890abcdefg 到配置？', messages: [] }, { runId: 'run-ledger-1', sessionKey: 's8' });
  const files = [];
  function walk(d){ if(!fs.existsSync(d)) return; for(const e of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,e.name); e.isDirectory()?walk(p):files.push(p); } }
  walk(path.join(h.tmp, 'plugins', 'delivery-gate', 'runs'));
  assert.ok(files.length >= 1, 'ledger file should exist');
  const body = fs.readFileSync(files[0], 'utf8');
  assert.ok(!body.includes('sk-1234567890abcdefg'));
  assert.ok(body.includes('[REDACTED'));
}

console.log('delivery-gate hook simulation ok');
