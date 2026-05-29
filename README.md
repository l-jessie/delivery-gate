# Delivery Gate for OpenClaw

[中文说明](README.zh-CN.md)

Ah... this is a transitional delivery-gate plugin for OpenClaw. No half-baked work. No bullshit.

Runtime delivery-quality plugin for OpenClaw agents. It adds dynamic task policies, bounded final-answer revision, evidence scoring, oracle comparison, changed-lines traceability, documentation locale consistency, native approval requests for high-risk actions, enforced autonomous long-task recovery, long-task ledgers, retained project plans, and coding closure checks.

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

## Installation and configuration

This section is written for both humans and AI agents. If a user gives an AI agent this repository URL and asks it to install Delivery Gate into OpenClaw, the agent should follow these steps, perform the safe checks directly, and report verification evidence instead of only giving a plan.

### 1. Inspect the local OpenClaw environment

Before changing anything:

- Confirm OpenClaw is installed.
- Find the active OpenClaw config file, commonly `~/.openclaw/openclaw.json`.
- Read the current `plugins.entries.delivery-gate` config if it already exists.
- Read OpenClaw plugin/config docs or schema when available.
- Preserve existing config; merge only the Delivery Gate entry.

### 2. Install or update the plugin source

Clone or copy this repository into the user plugin directory:

```bash
git clone https://github.com/l-jessie/delivery-gate.git ~/.openclaw/plugins/delivery-gate
cd ~/.openclaw/plugins/delivery-gate
npm test
```

If the directory already exists, update it safely instead of overwriting local changes:

```bash
cd ~/.openclaw/plugins/delivery-gate
git status --short
git pull --ff-only
npm test
```

Do not commit runtime/generated files such as `runs/`, `plans/`, `.openclaw/`, `node_modules/`, or packed `.tgz` files.

### 3. Enable the OpenClaw plugin entry

The plugin must be configured under `plugins.entries.delivery-gate`. Do not put `delivery-gate` at the root of the config.

Minimum working config:

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
          "enabled": true
        }
      }
    }
  }
}
```

The three critical paths are:

- `plugins.entries.delivery-gate.enabled = true`
- `plugins.entries.delivery-gate.hooks.allowPromptInjection = true`
- `plugins.entries.delivery-gate.hooks.allowConversationAccess = true`

Recommended full config baseline:

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
          "injectPrompt": true,
          "strictTools": true,
          "midRunReflection": true,
          "semanticReview": true,
          "longTaskMode": true,
          "skillHints": true,
          "implicitPlanFiles": true,
          "projectPlanFiles": true,
          "cleanupPlanOnSuccess": false,
          "persistLedger": true,
          "ledgerPromptMode": "redacted",
          "maxLedgerBytes": 1000000,
          "retentionDays": 30,
          "reviewerMode": "rules",
          "codingStrict": true,
          "approvalMode": "approval",
          "blockHighRiskTools": true,
          "autonomousRecovery": true,
          "enforceAutonomousRecovery": true,
          "evidenceScoring": true,
          "oracleStrict": true,
          "changedLinesReview": true,
          "docLocaleConsistency": true,
          "milestoneReflectionEveryTools": 5,
          "failureBudget": 3,
          "maxRevisionAttempts": 1
        }
      }
    }
  }
}
```

### 4. Reload and verify

Reload or restart OpenClaw only if required by the local config mechanism. Then verify:

```bash
openclaw plugins list | grep -i delivery
```

Expected evidence:

- Delivery Gate is listed as `enabled`.
- The plugin path points to `~/.openclaw/plugins/delivery-gate/index.js` or the intended install path.
- The displayed version matches `package.json` / `openclaw.plugin.json`.

Run two probes:

1. **Positive probe**: ask an agent to report the injected `<delivery_gate>` block version and task classification.
2. **Negative probe**: safely simulate a file/code completion without readback/test evidence and confirm Delivery Gate requests revision or blocks false completion.

### 5. What the installer must report

A human or AI installer should report:

- Plugin path.
- Config path changed.
- Enabled flags and hook permissions.
- Version.
- `npm test` result.
- `openclaw plugins list` result.
- Probe result.
- Remaining risks, if any.

If any verification step is missing, do not claim the plugin is installed successfully.

## Key configuration options

| Option | Default | Meaning |
|---|---:|---|
| `mode` | `revise` | Request one bounded final-answer revision when a gate fails. `observe` only records. |
| `strictTools` | `true` | Enable tool-evidence gates. |
| `longTaskMode` | `true` | Enable long-task planning, milestone reflection, and failure-budget guidance. |
| `autonomousRecovery` | `true` | Try safe recovery channels before asking the user during long tasks. |
| `enforceAutonomousRecovery` | `true` | Revise premature user handoff when recovery evidence is missing. |
| `evidenceScoring` | `true` | Require minimum evidence strength, not just any evidence. |
| `oracleStrict` | `true` | Require equivalence/source-of-truth evidence when a correctness oracle is named. |
| `changedLinesReview` | `true` | Require changed-lines traceability for coding diffs. |
| `docLocaleConsistency` | `true` | Flag README language-boundary drift. |
| `approvalMode` | `approval` | Use native approval for high-risk actions; `block` hard-blocks. |
| `persistLedger` | `true` | Persist per-run ledgers. |
| `ledgerPromptMode` | `redacted` | Prompt persistence mode: `none`, `redacted`, or `full`. |

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

```text
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
