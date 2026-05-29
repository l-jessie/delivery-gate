import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { resolveLivePluginConfigObject } from 'openclaw/plugin-sdk/plugin-config-runtime';
import path from 'node:path';
import { VERSION } from './version.js';
import { readConfig } from './config.js';
import { RUNS, SESSION_TO_RUN, CONFIRMED_SESSIONS, getState, runKey, sessionKeyOf, textOf, isConfirmationPrompt } from './utils.js';
import { classifyPrompt, classifyTool } from './classify.js';
import { claimsDone, hasBlockedText, buildEvidenceSummary, sanitizePrompt, serializeState } from './evidence.js';
import { summarizeApproval, setupPersistence, writeImplicitPlan, pruneOldFiles, ledger, cleanupImplicitPlan } from './persistence.js';
import { guidanceFor } from './guidance.js';
import { shouldRevise } from './gate.js';

const plugin = definePluginEntry({
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
      for (const field of ['read','write','verify','status','search','browser','message','errors','mutating','external','code','config','data','artifactWrite','artifactRead','semanticEvidence','diffEvidence','changedLinesEvidence','testEvidence','buildEvidence','oracleEvidence','docLocaleIssue','dangerous']) {
        const source = field === 'errors' ? c.error : c[field];
        if (source) s[field] += 1;
      }
      if (c.error) s.toolFailures.push({ tool: event.toolName || 'unknown', sample: textOf(event.result || event.error, 500) });
      if (c.artifactWrite) s.lastWrites.push(textOf(event.params, 500));
      if (c.artifactRead) s.lastReads.push(textOf(event.result, 500));
      setupPersistence(api, cfg, k, s, ctx);
      ledger(api, cfg, k, s, 'tool_result', { tool: event.toolName || 'unknown', class: { read: c.read, write: c.write, verify: c.verify, error: c.error, dangerous: c.dangerous, docLocaleIssue: c.docLocaleIssue } });
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

export default plugin;
