// @ts-check
import { INSTRUMENT_VARIATION_ALGORITHM, instrumentVariationValue } from '../../midi/content/InstrumentIdentityVariation.js';

/** @typedef {{id: string, extended: boolean, seedDomain?: string | null, runtime: {engineVersion: number, buildId: string, runtimeABI: string}, restoration: string}} SeedSource */
/** @typedef {{id: string, revision: number}} SeedPatch */
/** @typedef {{actorId?: string | number | null, worldId?: string | null, generation?: number | null, onsetId?: string, voiceId?: string}} SeedOnset */
/** @typedef {{variation?: {seed?: number}, values?: Record<string, number>}} SeedPerformance */
/** @typedef {string | number | null | undefined} SeedField */
/** @typedef {[SeedField, string, number, readonly SeedField[], SeedField, number]} SeedFields */

/** @param {SeedSource} source @param {SeedPatch} patch @param {SeedOnset} intent @param {SeedPerformance | null} performance @returns {SeedFields} */
const seedFields = (source, patch, intent, performance) => [source.seedDomain, patch.id, patch.revision,
  intent.actorId == null ? ['event-only', intent.onsetId ?? intent.voiceId] : [intent.worldId, intent.generation, intent.actorId],
  intent.onsetId ?? intent.voiceId, performance?.variation?.seed ?? 0];
/** @param {SeedFields} fields */
const seedValue = fields => Math.min(0xffffffff, Math.floor((instrumentVariationValue(fields) + 1) * 2147483648));
/** @type {WeakMap<SeedSource, Map<number, ReturnType<typeof createSeedContract>>>} */
const contracts = new WeakMap();
const algorithms = Object.freeze({
  'worklet-pluck': ['xorshift32-13-17-5-v1', 'finite-pluck-excitation', 'zero-to-6d2b79f5'],
  'worklet-choir': ['xorshift32-13-17-5-v1', 'per-output-frame-breath-and-initial-phase', 'zero-to-6d2b79f5'],
  'worklet-granular': ['xorshift32-13-17-5-v1', 'grain-position-and-stereo-choices', 'zero-to-6d2b79f5'],
  'worklet-seed-layers': ['xorshift32-13-17-5-v1', 'residual-grain-position-and-stereo-choices', 'zero-to-6d2b79f5'],
  'worklet-wind': ['xorshift32-13-17-5-v1', 'per-output-frame-port-noise', 'zero-to-6d2b79f5'],
  'worklet-friction': ['u32-cell-avalanche-linear-interpolation-v1', 'four-pixel-scraping-roughness-when-selected', 'preserved'],
  'worklet-texture': ['u32-cell-salt-avalanche-v1', 'spatial-material-pulses', 'preserved'],
  'worklet-spectrum': ['u32-normalized-partial-phase-v1', 'initial-partial-phase', 'preserved']
});
/** @param {SeedSource} source @param {boolean} circular */
function createSeedContract(source, circular) {
  const [algorithm, purpose, zeroSeed] = circular ? ['u32-indexed-circular-phase-v1', 'indexed-circular-partial-phase', 'preserved'] : algorithms[source.id];
  return Object.freeze({ schema: 'lemmings-owned-source-seed-contract/v1', recipe: 'owned-onset-seed-v1',
    encoding: 'JSON-array-UTF16LE-code-units', hashAlgorithm: INSTRUMENT_VARIATION_ALGORITHM, output: 'unsigned32', domain: source.seedDomain,
    fields: Object.freeze(['source-domain', 'patch-id', 'patch-revision', 'actor-birth-or-event-only', 'onset-or-voice-id', 'resolved-variation-seed']),
    algorithm, purpose, zeroSeed, source: Object.freeze({ engineId: source.id, engineVersion: source.runtime.engineVersion, buildId: source.runtime.buildId, runtimeABI: source.runtime.runtimeABI }),
    restoration: Object.freeze({ capability: source.restoration, qualification: 'declared-source-capability;not-a-PCM-equivalence-receipt', policy: 'restore-complete-kernel-state;do-not-reseed-continuations' }) });
}
/** @param {SeedSource} source @param {SeedPerformance | null} performance */
const seedContract = (source, performance) => {
  if (!source.extended || !source.seedDomain || !Object.hasOwn(algorithms, source.id)) return null;
  const circular = source.id === 'worklet-spectrum' && performance?.values?.sourceMode === 2, key = Number(circular);
  if (!Object.isFrozen(source) || !Object.isFrozen(source.runtime)) return createSeedContract(source, circular);
  let variants = contracts.get(source); if (!variants) { variants = new Map(); contracts.set(source, variants); }
  if (!variants.has(key)) variants.set(key, createSeedContract(source, circular));
  return variants.get(key);
};

/** @param {SeedSource} source @param {SeedPatch} patch @param {SeedOnset} intent @param {SeedPerformance | null} performance */
export function ownedSourceSeed(source, patch, intent, performance) {
  return source.extended ? seedValue(seedFields(source, patch, intent, performance)) : 0;
}

/** @param {SeedSource} source @param {SeedPatch} patch @param {SeedOnset} intent @param {SeedPerformance | null} performance */
export function resolveOwnedSourceSeed(source, patch, intent, performance) {
  const fields = source.extended ? seedFields(source, patch, intent, performance) : null, seed = fields ? seedValue(fields) : 0, contract = seedContract(source, performance);
  const identityScope = intent.actorId == null ? 'event-only' : typeof intent.worldId === 'string' && intent.worldId.length > 0 && typeof intent.generation === 'number' && Number.isSafeInteger(intent.generation) && intent.generation >= 0 ? 'execution-birth' : 'partial-birth-input';
  if (contract && fields) Object.freeze(fields[3]);
  const receipt = contract && fields ? Object.freeze({ schema: 'lemmings-owned-source-seed/v1', seed, contract, identityScope, inputs: Object.freeze(fields) }) : null;
  return Object.freeze({ seed, receipt });
}
