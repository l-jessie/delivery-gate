import { claimsDone, hasBlockedText, hasEvidenceText, asksUserForNextStep, hasRecoveryEvidence, evidenceScore, minimumEvidenceScore, requiresOracle, hasDocLocaleIssueFromText } from './evidence.js';

export function shouldRevise(answer, s, cfg) {
  if (!s || !cfg.strictTools) return null;
  if (s.errors >= cfg.failureBudget && !hasBlockedText(answer)) return `Failure budget exceeded (${s.errors}/${cfg.failureBudget}); final answer must stop retrying and mark blocked or summarize corrective action.`;
  if (cfg.enforceAutonomousRecovery && s.longTask && asksUserForNextStep(answer) && !hasRecoveryEvidence(answer) && s.dangerous === 0 && s.external === 0) return 'Long task is asking the user for next steps without evidence of autonomous recovery; first check memory/wiki, local docs/source/logs, same-project references, and official/web sources when relevant, unless a real approval/business decision is required.';
  if (s.dangerous > 0 && !hasBlockedText(answer) && !/(确认|用户已确认|confirmed|废纸篓|trash)/i.test(answer)) return 'Dangerous/destructive action detected; final answer must show confirmation/safe handling or mark blocked.';
  if (s.risk === 'high' && s.external > 0 && !hasBlockedText(answer) && !/(确认|用户已确认|confirmed)/i.test(answer)) return 'High-risk external/destructive action detected; final answer must show explicit confirmation or mark blocked.';
  if (!claimsDone(answer)) return null;
  if (s.errors > 0 && !hasBlockedText(answer)) return 'This run had tool errors, but the final answer claims completion without clearly marking failure/blockage.';
  if (s.taskType === 'file-artifact' && s.artifactWrite > 0 && s.artifactRead === 0 && !hasEvidenceText(answer)) return 'File/artifact task wrote a file but has no readback/stat evidence.';
  if (s.taskType === 'coding' && s.write > 0 && s.verify === 0 && !hasBlockedText(answer)) return 'Coding task changed files but has no test/build/lint/diff/readback evidence.';
  if (cfg.codingStrict && s.taskType === 'coding' && s.write > 0 && (s.diffEvidence === 0 && s.testEvidence === 0 && s.buildEvidence === 0) && !hasBlockedText(answer)) return 'Coding task lacks Codex-like closure: no diff/test/build evidence recorded.';
  if (cfg.docLocaleConsistency && (s.docLocaleIssue > 0 || hasDocLocaleIssueFromText(answer)) && !hasBlockedText(answer)) return 'Markdown documentation locale mismatch detected: English README should use English prose, Chinese README should use Chinese prose unless the user explicitly requests a quote.';
  if (cfg.changedLinesReview && s.taskType === 'coding' && s.write > 0 && s.diffEvidence > 0 && s.changedLinesEvidence === 0 && !hasBlockedText(answer)) return 'Coding task has a diff but no changed-lines traceability review recorded.';
  if (cfg.oracleStrict && requiresOracle(s.prompt) && s.write > 0 && s.oracleEvidence === 0 && !hasBlockedText(answer)) return 'Task mentions a correctness oracle/business-equivalence target, but no oracle comparison evidence was recorded.';
  if (cfg.evidenceScoring && claimsDone(answer) && evidenceScore(s) < minimumEvidenceScore(s) && !hasBlockedText(answer)) return `Evidence score too weak (${evidenceScore(s)}/${minimumEvidenceScore(s)}); final answer needs stronger verification or must mark unverified/blocked.`;
  if (s.taskType === 'config-runtime' && s.mutating > 0 && s.status === 0 && !hasEvidenceText(answer)) return 'Runtime/config task changed state but has no status/log/readback verification.';
  if ((s.write > 0 || s.mutating > 0) && s.verify === 0 && !hasEvidenceText(answer)) return 'This run changed state or files, but the final answer claims completion without verification evidence.';
  if (s.longTask && claimsDone(answer) && s.tools >= 3 && s.verify === 0 && !hasEvidenceText(answer)) return 'Long task claims completion without a verification checkpoint.';
  if (cfg.semanticReview && s.taskType === 'file-artifact' && s.code > 0 && s.artifactWrite > 0 && s.semanticEvidence === 0 && !hasEvidenceText(answer)) return 'Generated code/algorithm artifact lacks a cheap semantic sanity check.';
  if (s.taskType === 'research' && s.tools > 0 && s.search === 0 && !hasEvidenceText(answer)) return 'Research task used tools but final answer lacks source/evidence signal.';
  return null;
}

