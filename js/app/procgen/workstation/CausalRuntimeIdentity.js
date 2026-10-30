import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { canonicalJournalText } from './CausalJournalCanonical.js';

const executionFields = ['receiptVersion', 'activeExecution', 'reason', 'buildId', 'closureDigest', 'codeDigest', 'assetDigest', 'harnessVersion',
  'stateSchema', 'realmId', 'capabilityProfile', 'binding', 'identityRecipe'];
const compactExecution = value => Object.freeze(Object.fromEntries(executionFields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])));
const protocolVersions = value => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'applicationExecution'));

export const sameCausalRuntimeProtocols = (recorded, current) => canonicalJournalText(protocolVersions(recorded)).text === canonicalJournalText(protocolVersions(current)).text;

export const inspectCausalRuntimeExecution = sourceVersions => {
  const required = sourceVersions?.applicationExecution ?? null, comparison = compareActiveExecutionIdentity(required), active = compactExecution(comparison.active);
  const reasons = [], mismatches = [];
  let status = 'unbound';
  if (!required) reasons.push('legacy-recording-execution-unbound');
  else if (required.receiptVersion !== 3) { status = 'invalid'; reasons.push('recorded-execution-version-unsupported'); }
  else if (required.activeExecution !== 'bound') reasons.push('recorded-execution-unbound');
  else if (['buildId', 'closureDigest', 'codeDigest', 'assetDigest'].some(key => !/^[a-f0-9]{64}$/.test(required[key])) ||
      typeof required.harnessVersion !== 'string' || !required.harnessVersion || required.harnessVersion.length > 128 ||
      !Number.isSafeInteger(required.stateSchema) || required.stateSchema < 1 || required.capabilityProfile !== 'browser-survey-core' ||
      required.binding !== 'immutable-application-generation' || typeof required.identityRecipe !== 'string' || required.identityRecipe.length > 128 ||
      typeof required.realmId !== 'string' || !required.realmId || required.realmId.length > 128) {
    status = 'invalid'; reasons.push('recorded-execution-identity-invalid');
  } else if (active.activeExecution === 'bound') {
    mismatches.push(...comparison.mismatches, ...['codeDigest', 'identityRecipe'].filter(key => required[key] !== active[key]));
    status = mismatches.length ? 'mismatched' : 'matched';
    reasons.push(...mismatches.map(key => 'application-' + key + '-mismatch'));
  }
  if (active.activeExecution !== 'bound') reasons.push('active-execution-unbound');
  return Object.freeze({ schema: 'lemmings-causal-runtime-binding', version: 1, status, reasons: Object.freeze(reasons),
    mismatches: Object.freeze(mismatches), required: required && compactExecution(required), active,
    scope: 'immutable-application-generation', exactQualified: false, exactUnavailableReason: 'causal-exact-realm-unqualified' });
};

export const describeCausalReperformance = receipt => {
  if (receipt?.failure?.message) return 'Stored take comparison: ' + receipt.failure.message;
  if (receipt?.compatibilityMatch) {
    const binding = receipt.executionBinding;
    const source = binding?.status === 'matched' ? 'The recorded application build matches.' : binding?.status === 'mismatched' ?
      'The recorded application build differs (' + binding.mismatches.join(', ') + '); this result uses the current build.' :
      'The recorded application build is unqualified.';
    return 'Stored take matches this current runtime. ' + source + ' Exact archived replay and listening remain unqualified.';
  }
  const explanations = { 'source-version-mismatch': 'The recorded simulation or musical protocol differs from this runtime.',
    'asset-identity-mismatch': 'The recorded asset collection or content hash differs from the available assets.',
    'unsupported-component-codec': 'The recorded checkpoint component codec is unsupported.',
    'legacy-or-unqualified-component-identities': 'The recorded checkpoint lacks qualified component identities.',
    'unknown-physical-source-coverage': 'The recorded physical source coverage is unknown.',
    'incomplete-physical-source': 'The recorded physical source coverage is incomplete.',
    'causal-exact-realm-unqualified': 'Exact causal replay has no qualified isolated execution realm.' };
  return 'Stored take comparison: ' + (receipt?.reasons?.map(reason => explanations[reason] || reason).join(' ') || receipt?.status || 'unavailable');
};

export function causalRuntimeSourceVersions(world, mappingRevision, checkpointVersion = 2) {
  if (!world || !Number.isSafeInteger(mappingRevision) || mappingRevision < 0 || checkpointVersion !== 2) throw new Error('Unsupported current causal runtime source.');
  return Object.freeze({ generator: 'procgen-workstation-2', causalRandom: 'fnv1a32-avalanche-v1', causalProbabilityPolicy: 1, terrainChallenge: 3, populationRandom: 1, worldCheckpoint: checkpointVersion, stallCascade: world.stall?.settings?.cascadeDecisionVersion ?? 1,
    physicalBatch: 1, physicalMusic: 13, swarmReducer: 1, phraseCargo: 1, releaseGesture: 1, physicalFeedback: 1, physicalPlaybackAdmission: 1, instrumentPerformance: 4, project: 2,
    numericCanonicalization: 'finite-f64-minus-zero-v1', mappingRevision, applicationExecution: compactExecution(getActiveExecutionIdentity()) });
}
