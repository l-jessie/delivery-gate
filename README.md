# Delivery Gate for OpenClaw

Runtime delivery-quality plugin for OpenClaw agents. It adds dynamic task policies, bounded final-answer revision, evidence scoring, oracle comparison, changed-lines traceability, native approval requests for high-risk actions, enforced autonomous long-task recovery, long-task ledgers, retained project plans, and coding closure checks.

## What it solves

- Agents claiming completion without verification.
- Weak evidence being treated the same as strong business verification.
- Coding changes shipped without changed-line traceability or oracle/business-equivalence checks.
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
          "changedLinesReview": true
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
