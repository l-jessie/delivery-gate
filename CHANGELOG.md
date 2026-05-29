# Changelog

## 0.7.0
- Add evidence scoring and per-task minimum evidence thresholds.
- Add changed-lines traceability gate for coding diffs.
- Add oracle/business-equivalence gate when prompts mention a correctness oracle such as export/old logic/correct API.
- Add tool classifiers for oracle evidence and changed-lines evidence.
- Expand tests for evidence scoring, oracle strictness, and changed-lines review.

## 0.6.2
- Add `enforceAutonomousRecovery`: long-task final answers that ask the user for next steps without recovery evidence now trigger a bounded revision, unless real approval/external/privacy/business input is required.
- Add tests for premature user-escalation detection and recovery-evidence pass-through.

## 0.6.1
- Add `autonomousRecovery` long-task guidance: recover via memory/wiki, local docs/source/logs, same-project references, and official/web sources before asking the user.
- Clarify failure-budget behavior: stop retrying the same blocker, not the whole task when another safe path exists.
- Fix risk classification false positives by avoiding tool result text when detecting writes/destructive intent; read-only content containing words like delete no longer counts as dangerous.
- Expand tests for autonomous recovery config and read-only dangerous-keyword false positives.

## 0.6.0
- Add native OpenClaw approval requests for unconfirmed high-risk destructive/external tool calls.
- Keep legacy hard-block behavior via `approvalMode: "block"`.
- Add release metadata: peer dependency, OpenClaw extension entry, MIT license, gitignore, README readiness update.
- Expand smoke/unit/hook simulation tests for approval mode and redacted approval descriptions.

## 0.5.1
- Add hook-level simulation tests for prompt injection, tool blocking, tool evidence, ledger redaction, and final revision behavior.
- Fix test-exposed coverage gaps in coding closure, readback requirements, and failure budget checks.

## 0.5.0
- Reduce high-risk false positives by distinguishing safe inspection commands from actual destructive/external intent.
- Add privacy-oriented ledger settings: `ledgerPromptMode`, `maxLedgerBytes`, `retentionDays`.
- Add README and smoke test.

## 0.4.1
- Retain long-task plan files instead of deleting them after success.
- Prefer project-local `<workspace>/.openclaw/plans/` for coding/project long tasks.

## 0.4.0
- Add persistent run ledger, implicit long-task plans, optional LLM reviewer, and Codex-like coding closure checks.

## 0.3.0
- Add long-task mode, milestone reflection, failure budget, and skill hints.
