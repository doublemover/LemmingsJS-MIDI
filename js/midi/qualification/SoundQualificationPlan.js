import { createQuarryEcho } from '../content/DubQuarryRack.js';
import { validateInstrumentPatchV2 } from '../content/InstrumentPatchV2.js';
import { validateInstrumentControls } from '../content/InstrumentPerformance.js';
import { canonicalDataText, hashData, freezeData } from '../../core/CanonicalData.js';
const fail = message => { throw new TypeError('Sound qualification: ' + message); };
export const SOUND_QUALIFICATION_PROFILE = freezeData({ schema: 'lemmings-sound-qualification-profile/v1', revision: 2,
  sampleRates: [44100, 48000, 96000], notes: [36, 60, 84], velocities: [24, 64, 110], gatesSeconds: [0.04, 1.2], macroPoints: [0, 0.5, 1], pairedGrid: [0, 0.25, 0.5, 0.75, 1],
  maximumCases: 1536, maximumRenderSeconds: 7200, maximumOutputBytes: 4096 * 1048576, maximumRetainedReportBytes: 16 * 1048576,
  tolerance: { 'native-oscillator': { repeatMaximumAbsoluteError: 2e-6, maximumDC: 0.02 }, 'native-fm': { repeatMaximumAbsoluteError: 2e-6, maximumDC: 0.02 },
    'native-modal': { repeatMaximumAbsoluteError: 2e-6, maximumDC: 0.02 }, 'native-sample': { repeatMaximumAbsoluteError: 2e-6, maximumDC: 0.02 },
    'worklet-pluck': { repeatMaximumAbsoluteError: 0, maximumDC: 0.02 }, 'worklet-choir': { repeatMaximumAbsoluteError: 0, maximumDC: 0.02 },
    'worklet-spectrum': { repeatMaximumAbsoluteError: 0, maximumDC: 0.02 }, 'worklet-sine': { repeatMaximumAbsoluteError: 0, maximumDC: 0.02 },
    'worklet-granular': { repeatMaximumAbsoluteError: 0, maximumDC: 0.02 } },
  interpretation: 'explicit-engine-rate-test-policy-not-a-universal-perceptual-threshold' });
export async function createAuthoredNoteQualificationFixture({ note, velocity, gateSeconds, voices = 1 } = {}) {
  if (!Number.isInteger(note) || note < 0 || note > 127 || !Number.isInteger(velocity) || velocity < 1 || velocity > 127 || !Number.isFinite(gateSeconds) || gateSeconds < 0.001 || gateSeconds > 10 || !Number.isInteger(voices) || voices < 1 || voices > 257) fail('invalid isolated-note fixture.');
  const duration = 0.05 + gateSeconds + 4.1, intents = [], event = (kind, index, time) => ({ version: 1, kind, intentId: kind + ':' + index, voiceId: 'voice:' + index,
    worldId: 'authored-control-fixture', generation: 1, laneId: 0, actorId: index, onsetId: 'onset:' + index, sourceEventIds: [],
    pitch: { cents: note * 100, referenceHz: 440 }, velocity01: velocity / 127, expression: {}, scoreTime: { sourceTimeMs: time * 1000, subTick: 0, simTick: 0 } });
  for (let index = 0; index < voices; index++) intents.push(event('begin', index, 0.05));
  for (let index = 0; index < voices; index++) intents.push(event('end', index, 0.05 + gateSeconds));
  const sourceCanonicalHash = await hashData({ schema: 'lemmings-authored-note-fixture/v1', note, velocity, gateSeconds, voices, intents });
  const revoice = { version: 1, operation: 'sound-only-revoice', takeId: 'authored:' + sourceCanonicalHash, takeRevision: 1, sourceCanonicalHash, sourceState: 'finalized', nextSequence: null,
    sourceVersions: { fixture: 'authored-note-v1' }, coverage: { status: 'known-covered' }, boundary: { status: 'captured-initial-state', state: { voices: [], sourceTimeMs: 0 } },
    finalBoundaryState: { sourceTimeMs: duration * 1000 }, intents };
  return freezeData({ id: `note-${note}-velocity-${velocity}-gate-${gateSeconds}-voices-${voices}`, evidence: 'authored-semantic-control-not-recorded-world', revoice,
    note, velocity, gateSeconds, voices, durationSeconds: duration, physicalTakeEvidence: false, fixtureHash: await hashData(revoice) });
}
export async function admitRecordedSoundFixture(value) {
  canonicalDataText(value, { maxBytes: 4 * 1048576, maxNodes: 262144 });
  if (!value || !['sparse', 'medium', 'dense'].includes(value.density) || typeof value.id !== 'string' || value.id.length > 128 || !value.id ||
      value.evidence !== 'recorded-committed-world' || value.physicalTakeEvidence !== true || !/^[a-f0-9]{64}$/.test(value.fixtureHash) ||
      !/^[a-f0-9]{64}$/.test(value.checkpointHash) || !/^[a-f0-9]{64}$/.test(value.factHash) ||
      !value.revoice?.sourceVersions || value.revoice.operation !== 'sound-only-revoice' || value.revoice.coverage?.status !== 'known-covered' ||
      value.revoice.boundary?.state?.voices?.length !== 0 || value.revoice.intents?.length > 8192 || !value.revoice.intents?.some(intent => intent.kind === 'begin') ||
      !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0 || value.durationSeconds > 60 || await hashData(value.revoice) !== value.fixtureHash)
    fail('recorded fixtures require covered immutable real-world facts, checkpoints and semantic hashes; no silent substitute.');
  return freezeData(structuredClone(value));
}
export async function createSoundQualificationPlan({ definition, descriptor, traces = [], applicationBuildId, source, sampleRates = SOUND_QUALIFICATION_PROFILE.sampleRates, includeMacroGrid = true, includeEngineStack = false } = {}) {
  const patch = validateInstrumentPatchV2(definition, descriptor), definitionHash = await hashData(definition);
  if (!/^[a-f0-9]{64}$/.test(applicationBuildId) || source?.definitionHash !== definitionHash || source.patchIdentity !== patch.id + '@' + patch.revision ||
      !/^[a-f0-9]{64}$/.test(source.contentHash) || !Array.isArray(sampleRates) || !sampleRates.length || sampleRates.length > 3 || new Set(sampleRates).size !== sampleRates.length ||
      sampleRates.some(rate => !SOUND_QUALIFICATION_PROFILE.sampleRates.includes(rate)) || !Array.isArray(traces) || traces.length > 3 || typeof includeMacroGrid !== 'boolean' || typeof includeEngineStack !== 'boolean') fail('unbound source, rates or trace inventory.');
  const tolerance = SOUND_QUALIFICATION_PROFILE.tolerance[descriptor.engineId]; if (!tolerance) fail('the engine has no declared qualification tolerance profile.');
  const recorded = []; for (const trace of traces) recorded.push(await admitRecordedSoundFixture(trace));
  if (new Set(recorded.map(value => value.density)).size !== recorded.length) fail('density fixtures must be distinct source-bound captures.');
  const fixtures = [], cases = [], add = (fixture, options = {}) => { cases.push({ id: 'case:' + cases.length, fixtureId: fixture.id, fixtureHash: fixture.fixtureHash, sampleRate: options.sampleRate,
    role: options.role || 'baseline', controls: validateInstrumentControls(options.controls || {}), macroIds: options.macroIds || [], expected: options.expected || 'finite-render', variant: options.variant || null,
    fundamentalHz: fixture.note == null ? null : 440 * 2 ** ((fixture.note - 69) / 12) }); };
  for (const note of SOUND_QUALIFICATION_PROFILE.notes) for (const velocity of SOUND_QUALIFICATION_PROFILE.velocities) for (const gateSeconds of SOUND_QUALIFICATION_PROFILE.gatesSeconds)
    fixtures.push(await createAuthoredNoteQualificationFixture({ note, velocity, gateSeconds }));
  fixtures.push(...recorded);
  if (includeEngineStack) fixtures.push(...await createEngineStackQualificationFixtures());
  const control = fixtures.find(value => value.note === 60 && value.velocity === 64 && value.gateSeconds === 1.2), calibration = [control, ...(recorded.find(value => value.density === 'medium') ? [recorded.find(value => value.density === 'medium')] : [])];
  const overBudget = await createAuthoredNoteQualificationFixture({ note: 60, velocity: 64, gateSeconds: 1.2, voices: Math.min(257, patch.voicePolicy.maxVoices + 1) }); fixtures.push(overBudget);
  for (const sampleRate of sampleRates) {
    for (const fixture of fixtures) if (fixture !== overBudget) add(fixture, { sampleRate, ...(fixture.voices > patch.voicePolicy.maxVoices ? { role: 'negative-voice-budget', expected: 'admission-rejection' } : {}) });
    if (patch.variation) for (const fixture of recorded) {
      add(fixture, { sampleRate, role: 'identity-zero', controls: { variationAmount01: 0 } });
      add(fixture, { sampleRate, role: 'identity-reroll', controls: { variationSeed: patch.variation.seed === 2147483647 ? -2147483648 : patch.variation.seed + 1 } });
    }
    add(control, { sampleRate, role: 'repeat' }); add(control, { sampleRate, role: 'panic' }); add(overBudget, { sampleRate, role: 'negative-voice-budget', expected: 'admission-rejection' });
    add(control, { sampleRate, role: 'negative-unsupported-control', expected: 'admission-rejection', controls: { macros: { 'qualification-unsupported-target': 0.5 } } });
    if (patch.sampleRefs.length) add(control, { sampleRate, role: 'negative-missing-asset', expected: 'admission-rejection', variant: 'omit-assets' });
    for (const fixture of calibration) for (const macro of patch.macros) for (const value of SOUND_QUALIFICATION_PROFILE.macroPoints)
      add(fixture, { sampleRate, role: 'macro-endpoint', macroIds: [macro.id], controls: { macros: { [macro.id]: value }, variationAmount01: 0 } });
    if (includeMacroGrid) for (const fixture of calibration) for (let a = 0; a < patch.macros.length; a++) for (let b = a + 1; b < patch.macros.length; b++)
      for (const x of SOUND_QUALIFICATION_PROFILE.pairedGrid) for (const y of SOUND_QUALIFICATION_PROFILE.pairedGrid)
        add(fixture, { sampleRate, role: 'paired-macro-grid', macroIds: [patch.macros[a].id, patch.macros[b].id], controls: { macros: { [patch.macros[a].id]: x, [patch.macros[b].id]: y }, variationAmount01: 0 } });
  }
  if (cases.length > SOUND_QUALIFICATION_PROFILE.maximumCases) fail('case budget exceeded.');
  const value = { schema: 'lemmings-sound-qualification-plan/v1', definitionHash, source, descriptor, definition, applicationBuildId,
    profile: SOUND_QUALIFICATION_PROFILE, tolerance, fixtures, cases, macroIntents: patch.macros.map(macro => ({ id: macro.id, mode: macro.mode, default01: macro.default01, intent: macro.perceptualDirection, targets: macro.targets })),
    coverage: { engineStack: includeEngineStack ? { revision: 'identical-owned-semantic-workloads-v1', voiceCounts: [16, 32, 64], kinds: ['pluck', 'sustained-bend', 'drum-burst', 'per-note-expression', 'effect-tail'], scope: 'identical-inputs;explicit-capacity-refusals;offline-PCM-not-live-device-cost' } : null, requiredPhysicalDensities: ['sparse', 'medium', 'dense'], providedPhysicalDensities: recorded.map(value => value.density), missingPhysicalDensities: ['sparse', 'medium', 'dense'].filter(id => !recorded.some(value => value.density === id)),
      pairedGrid: includeMacroGrid ? 'finite-5x5-points-only-no-continuum-proof' : 'not-requested', qualityTier: descriptor.engineId + '@' + descriptor.engineVersion,
      identityVariation: patch.variation ? recorded.length ? 'same-recorded-trace-zero-and-reroll' : 'requires-recorded-fixtures' : 'not-authored',
      panic: 'separate-backend-conformance-required', listening: 'not-run' } };
  canonicalDataText(value, { maxBytes: 16 * 1048576, maxNodes: 1048576 }); return freezeData({ ...value, planHash: await hashData(value) });
}

export async function createEngineStackQualificationFixtures() {
  const fixtures = [];
  for (const voices of [16, 32, 64]) for (const kind of ['pluck', 'sustained-bend', 'drum-burst', 'per-note-expression', 'effect-tail']) {
    const gateSeconds = kind === 'pluck' || kind === 'drum-burst' ? 0.04 : 1.2, base = await createAuthoredNoteQualificationFixture({ note: 60, velocity: 64, gateSeconds, voices }),
      source = JSON.parse(canonicalDataText(base.revoice).text), original = source.intents, intents = [];
    const event = (intent, seconds, suffix = '') => ({ ...intent, intentId: kind + ':' + intent.intentId + suffix, voiceId: intent.voiceId + suffix, onsetId: intent.onsetId + suffix,
      velocity01: 0.6 / voices, scoreTime: { ...intent.scoreTime, sourceTimeMs: seconds * 1000 } });
    for (const intent of original) intents.push(event(intent, intent.scoreTime.sourceTimeMs / 1000));
    if (kind === 'drum-burst') for (let burst = 1; burst <= 3; burst++) for (const intent of original) intents.push(event(intent, intent.scoreTime.sourceTimeMs / 1000 + burst * 0.08, ':burst' + burst));
    if (kind === 'sustained-bend' || kind === 'per-note-expression') for (let index = 0; index < voices; index++) {
      const begin = intents.find(intent => intent.kind === 'begin' && intent.actorId === index);
      for (const [step, seconds] of [0.2, 0.45, 0.7, 0.95].entries()) { if (kind === 'per-note-expression' && index < voices / 2 && seconds >= 0.55) continue; intents.push({ ...event(begin, seconds), kind: 'update', intentId: kind + ':update:' + index + ':' + step,
        expression: { pressure01: step % 2 ? 0.8 : 0.25, pan01: kind === 'per-note-expression' ? index % 2 ? 0.6 : -0.6 : 0, pitchOffsetCents: kind === 'sustained-bend' ? (index % 2 ? -1 : 1) * [35, -20, 0, 12][step] : 0 } }); }
      if (kind === 'per-note-expression' && index < voices / 2) intents.find(intent => intent.kind === 'end' && intent.actorId === index).scoreTime.sourceTimeMs = 550;
    }
    intents.sort((a, b) => a.scoreTime.sourceTimeMs - b.scoreTime.sourceTimeMs || Number(b.kind === 'end') - Number(a.kind === 'end') || (a.intentId < b.intentId ? -1 : a.intentId > b.intentId ? 1 : 0));
    const effectGraph = kind === 'effect-tail' ? createQuarryEcho({ send01: 0.25 }) : null,
      sourceCanonicalHash = await hashData({ schema: 'lemmings-engine-stack-fixture/v1', revision: 1, voices, kind, intents, effectGraph });
    source.intents = intents; source.sourceCanonicalHash = sourceCanonicalHash; source.takeId = 'engine-stack:' + sourceCanonicalHash; source.sourceVersions = { fixture: 'identical-owned-semantic-workloads-v1' };
    fixtures.push(freezeData({ ...base, id: 'engine-stack-' + kind + '-' + voices, revoice: source, fixtureHash: await hashData(source), effectGraph,
      engineStack: { kind, requestedVoices: voices, samePitchIdentity: true, commonAggregateVelocity: 0.6, source: 'authored-semantic-controls-not-recorded-physics' } }));
  }
  return freezeData(fixtures);
}
