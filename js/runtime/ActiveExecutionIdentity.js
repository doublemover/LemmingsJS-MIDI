import { SURVEY_STATE_SCHEMA } from '../app/procgen/survey/ProcgenSurveyCanonical.js';

// The release builder replaces only this data slot inside an immutable graph.
const APPLICATION_BUILD = null; // IMMUTABLE_APPLICATION_BUILD_SLOT
const profiles = new Set(['browser-survey-core', 'browser-native-audio', 'browser-worklet-sine', 'browser-background-jobs']);
const realmId = globalThis.crypto?.randomUUID?.() ?? null;
const executingRoot = new URL('../../', import.meta.url);
const fields = ['buildId', 'closureDigest', 'harnessVersion', 'stateSchema', 'assetDigest', 'capabilityProfile'];
const inBuildNamespace = () => APPLICATION_BUILD && executingRoot.pathname.endsWith('/' + APPLICATION_BUILD.buildId + '/');

export const getApplicationBuild = () => APPLICATION_BUILD;
export const getApplicationDeploymentRoot = () => inBuildNamespace() ? new URL('../../../', import.meta.url) : null;
export const getActiveExecutionIdentity = (capabilityProfile = 'browser-survey-core') => {
  if (!profiles.has(capabilityProfile)) throw new Error('Unsupported executing capability profile.');
  const immutableNamespace = inBuildNamespace();
  if (!APPLICATION_BUILD || !realmId || !immutableNamespace) return Object.freeze({ receiptVersion: 3, activeExecution: 'unbound',
    reason: !APPLICATION_BUILD ? 'unbuilt-source-entry' : !immutableNamespace ? 'execution-entry-outside-build-namespace' : 'realm-identity-unavailable', realmId, capabilityProfile });
  return Object.freeze({ receiptVersion: 3, activeExecution: 'bound', ...APPLICATION_BUILD, stateSchema: SURVEY_STATE_SCHEMA,
    realmId, capabilityProfile, binding: 'immutable-application-generation' });
};

export const compareActiveExecutionIdentity = (required, capabilityProfile = 'browser-survey-core') => {
  const active = getActiveExecutionIdentity(capabilityProfile);
  const mismatches = active.activeExecution !== 'bound' ? ['active-execution-unbound'] : !required ? ['legacy-receipt-execution-unbound'] :
    fields.filter(field => required[field] !== active[field]);
  return Object.freeze({ matched: mismatches.length === 0, active, mismatches: Object.freeze(mismatches),
    artifactIntegrity: 'separate', replayConsistency: 'separate' });
};
