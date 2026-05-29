# Delivery Gate for OpenClaw

[中文说明](README.zh-CN.md)

Ah... this is a transitional delivery-gate plugin for OpenClaw. No half-baked work. No bullshit.

Runtime delivery-quality plugin for OpenClaw agents. It adds dynamic task policies, bounded final-answer revision, evidence scoring, oracle comparison, changed-lines traceability, native approval requests for high-risk actions, enforced autonomous long-task recovery, long-task ledgers, retained project plans, and coding closure checks.

## What it solves

- Agents claiming completion without verification.
- Weak evidence being treated the same as strong business verification.
- Coding changes shipped without changed-line traceability or oracle/business-equivalence checks.
- English README and Chinese README language boundaries drifting during edits.
- File/config/code tasks delivered without readback/status/test evidence.
- Long tasks drifting into rabbit holes or stopping to ask the user before safe recovery channels are tried.
- Destructive/external actions executed without explicit confirmation or native approval.
- Missing continuity for project work after a long task.

## Core behavior

- Classifies each turn: simple QA, research, file artifact, coding, config/runtime, external/destructive.
- Injects short task-specific delivery guidance before prompt build.
- Records tool evidence in a per-run ledger.
- Scores evidence strength and requires stronger closure for coding/config/artifact tasks.
- Requires changed-lines traceability review for coding diffs.
- Requires oracle/business-equivalence evidence when the task names a correctness oracle.
- Flags documentation locale mismatches, such as Chinese prose inserted into `README.md` or English prose inserted into `README.zh-CN.md`.
- Requests one bounded revision before final answer when completion lacks evidence.
- Requests native OpenClaw approvals for unconfirmed high-risk destructive/external tool calls.
- Guides and final-gates long tasks to recover autonomously first: memory/wiki, local docs/source/logs, same-project references, then official/web sources when relevant.
- Writes retained long-task plans to `<workspace>/.openclaw/plans/` for project/coding work.
- Uses rules by default; optional LLM reviewer is available but disabled by default.

## Privacy defaults

- `ledgerPromptMode: redacted` masks common secrets before writing ledgers/plans.
- `reviewerMode: rules` avoids extra model calls by default.
- Ledger rotation and retention are configurable.
- Project plans are intentionally retained for review/follow-up; users should add `.openclaw/` to `.gitignore` if they do not want to commit them.

## AI Agent installation brief

When a user gives an AI agent this repository URL and asks it to install Delivery Gate into OpenClaw, the agent should do this autonomously unless the local environment or safety policy requires confirmation:

1. **Inspect first**
   - Confirm OpenClaw is installed and find the active config path.
   - Read OpenClaw plugin/config docs or schema before changing config.
   - Inspect current `plugins.entries.delivery-gate` config if it already exists.

2. **Install or update the plugin source**
   - Clone or copy this repository into an OpenClaw plugin directory, commonly:
     - `~/.openclaw/plugins/delivery-gate`
   - Run `npm test` in the plugin directory.
   - Do not commit generated runtime files such as `runs/`, `plans/`, `.openclaw/`, or `node_modules/`.

3. **Enable the plugin in OpenClaw config**
   - Preserve existing config and merge the entry instead of overwriting unrelated settings.
   - Configure the plugin under `plugins.entries.delivery-gate`:

```jsonc
{
  "plugins": {
    "entries": {
      "delivery-gate": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true,
          "allowConversationAccess": true
        },
        "config": {
          "enabled": true,
          "mode": "revise",
          "strictTools": true,
          "longTaskMode": true,
          "projectPlanFiles": true,
          "cleanupPlanOnSuccess": false,
          "persistLedger": true,
          "ledgerPromptMode": "redacted",
          "reviewerMode": "rules",
          "approvalMode": "approval",
          "autonomousRecovery": true,
          "enforceAutonomousRecovery": true,
          "evidenceScoring": true,
          "oracleStrict": true,
          "changedLinesReview": true,
          "docLocaleConsistency": true
        }
      }
    }
  }
}
```

4. **Reload and verify**
   - Restart or reload OpenClaw only when needed by the local config mechanism.
   - Verify with `openclaw plugins list` that Delivery Gate is enabled and shows the expected version.
   - Run a low-risk probe: ask an agent to report the injected `<delivery_gate>` block version and task classification.
   - Run a negative probe when safe: simulate a file/code completion without readback/test evidence and confirm Delivery Gate requests revision or blocks false completion.

5. **Report evidence**
   - Final reply should include: plugin path, config path changed, version, test output, `openclaw plugins list` evidence, and any remaining risks.
   - If installation cannot be verified, do not claim success; mark the missing verification explicitly.

## Recommended config

```jsonc
{
  "plugins": {
    "entries": {
      "delivery-gate": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true,
          "allowConversationAccess": true
        },
        "config": {
          "enabled": true,
          "mode": "revise",
          "strictTools": true,
          "longTaskMode": true,
          "projectPlanFiles": true,
          "cleanupPlanOnSuccess": false,
          "persistLedger": true,
          "ledgerPromptMode": "redacted",
          "reviewerMode": "rules",
          "approvalMode": "approval",
          "autonomousRecovery": true,
          "enforceAutonomousRecovery": true,
          "evidenceScoring": true,
          "oracleStrict": true,
          "changedLinesReview": true,
          "docLocaleConsistency": true
        }
      }
    }
  }
}
```

## Open-source readiness status

This is now beyond MVP: it has smoke, unit-matrix, and hook-simulation coverage, native approval integration, privacy defaults, and package metadata suitable for a first release candidate.

Remaining release-candidate work before public announcement:

- Test against at least one older and one latest OpenClaw version.
- Run package acceptance through `npm pack` and OpenClaw npm-pack install.
- Add CI workflow once moved into a git repository.

## Test

```bash
npm test
```

## Structure

```
delivery-gate/
  index.js                  # Public entry: re-exports helpers and default plugin
  openclaw.plugin.json      # Manifest and config schema
  package.json              # Scripts and package metadata
  src/
    version.js              # Version constant
    config.js               # Config defaults and clamping
    utils.js                # Runtime state maps and small helpers
    classify.js             # Prompt/tool classification
    evidence.js             # Evidence scoring, oracle detection, final-answer text checks
    guidance.js             # Injected delivery-gate instructions
    gate.js                 # Final revise/blocking decision matrix
    persistence.js          # Ledger, plan files, redaction, approval summaries
    plugin.js               # OpenClaw hook registration
  test/
    smoke.mjs
    unit.mjs
    hook-sim.mjs
```
