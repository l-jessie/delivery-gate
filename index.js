export { VERSION } from './src/version.js';
export { readConfig } from './src/config.js';
export { classifyPrompt, classifyTool } from './src/classify.js';
export {
  claimsDone,
  hasEvidenceText,
  hasBlockedText,
  asksUserForNextStep,
  hasRecoveryEvidence,
  evidenceScore,
  buildEvidenceSummary,
  requiresOracle,
  minimumEvidenceScore,
  sanitizePrompt,
  serializeState,
  hasDocLocaleIssueFromText,
} from './src/evidence.js';
export { safeName, summarizeApproval, workspaceDirOf, shouldUseProjectPlan } from './src/persistence.js';
export { guidanceFor } from './src/guidance.js';
export { shouldRevise } from './src/gate.js';
export { default } from './src/plugin.js';
