import assert from 'node:assert/strict';
import plugin from '../index.js';
import manifest from '../openclaw.plugin.json' with { type: 'json' };

assert.equal(plugin.id, 'delivery-gate');
assert.equal(manifest.version, '0.7.0');
assert.ok(manifest.configSchema.properties.ledgerPromptMode);
assert.ok(manifest.configSchema.properties.retentionDays);
assert.ok(manifest.configSchema.properties.projectPlanFiles);
assert.equal(manifest.configSchema.properties.approvalMode.default, 'approval');
assert.equal(manifest.configSchema.properties.autonomousRecovery.default, true);
assert.equal(manifest.configSchema.properties.enforceAutonomousRecovery.default, true);
assert.equal(manifest.configSchema.properties.evidenceScoring.default, true);
assert.equal(manifest.configSchema.properties.oracleStrict.default, true);
assert.equal(manifest.configSchema.properties.changedLinesReview.default, true);
assert.equal(manifest.configSchema.properties.docLocaleConsistency.default, true);
console.log('delivery-gate smoke ok');
