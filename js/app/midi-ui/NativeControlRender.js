import { renderNativeOfflineGraph, NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineDriver.js';
import { validateInstrumentPatchV2 } from '../../midi/content/InstrumentPatchV2.js';
import { compileInstrumentPerformance } from '../../midi/content/InstrumentPerformance.js';
import { SOUND_CONTENT_CONTROL_FIXTURE } from '../../midi/content/SoundContentControlFixture.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';

export async function prepareNativeControlRenderInput({ definition, descriptor, sampleRate = 48000, source, applicationBuildId }, options = {}) {
  if (!NATIVE_OFFLINE_SOURCE_IDS.includes(descriptor?.engineId) || descriptor.engineVersion !== 1 || !/^[a-f0-9]{64}$/.test(applicationBuildId))
    throw new Error('Native controls require their exact immutable application source.');
  const patch = validateInstrumentPatchV2(definition, descriptor);
  if (patch.sampleRefs.length || patch.modulations.length || patch.voicePolicy.steal !== 'reject' ||
      !source || Object.keys(source).some(key => !['packId', 'packVersion', 'contentHash', 'patchIdentity', 'definitionHash', 'attribution'].includes(key)) ||
      typeof source.packId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(source.packId) ||
      typeof source.packVersion !== 'string' || !source.packVersion || source.packVersion.length > 64 ||
      typeof source.attribution !== 'string' || source.attribution.length > 32768 || !/^[a-f0-9]{64}$/.test(source.contentHash) ||
      source.patchIdentity !== patch.id + '@' + patch.revision || await hashData(definition) !== source.definitionHash)
    throw new Error('Native reference source differs from its saved definition or supported source graph.');
  canonicalDataText(source, { maxBytes: 65536, maxNodes: 4096 }); options.signal?.throwIfAborted();
  const identity = { version: 1, kind: 'begin', intentId: 'control-fixture-begin', onsetId: 'control-fixture', voiceId: 'control-fixture', actorId: null,
    generation: 1, sourceEventIds: [], pitch: { cents: SOUND_CONTENT_CONTROL_FIXTURE.events[0].pitchCents }, velocity01: SOUND_CONTENT_CONTROL_FIXTURE.events[0].velocity01,
    expression: SOUND_CONTENT_CONTROL_FIXTURE.events[0].expression };
  const performance = compileInstrumentPerformance(patch, descriptor.parameters).resolve({}, 0, identity), releaseSeconds = performance.values.releaseSeconds;
  const releaseFrames = Math.round(releaseSeconds * sampleRate), frames = sampleRate + releaseFrames + 128;
  const events = SOUND_CONTENT_CONTROL_FIXTURE.events.map((event, index) => ({ kind: event.kind, frame: Math.round(event.seconds * sampleRate),
    voiceId: identity.voiceId, laneId: 'control', expression: event.expression, intent: { ...identity, intentId: 'control-fixture-' + index }, releaseFrame: sampleRate, releaseSeconds }));
  const fixtureHash = await hashData(SOUND_CONTENT_CONTROL_FIXTURE); options.signal?.throwIfAborted();
  const native = await renderNativeOfflineGraph({ patch, events, frames, sampleRate }, options);
  try {
    const manifest = { schema: 'lemmings-rendered-audition/v1', source, engineRequirement: Object.fromEntries(['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].map(key => [key, descriptor[key]])), applicationBuildId,
      fixture: SOUND_CONTENT_CONTROL_FIXTURE, fixtureHash, physicalTakeEvidence: false, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames,
      renderTap: 'native-source-stereo-before-shared-owner-master-and-limiter', renderScope: 'fixed-controls-from-silence', sourceBank: null, fixedBank: null,
      sourcePerformance: { values: performance.values, controls: performance.controls, variation: performance.variation, bindingOutcomes: performance.bindingOutcomes, physicalSources: 'none-in-authored-control-fixture' },
      nativeScheduling: native.receipt, normalization: 'none', integerClipping: 'not-applicable', dither: 'none-float-output', quality: 'browser-native-source-rate',
      tail: { releaseFrames, extraFrames: 128, state: 'bounded-fixture-release-completed' }, qualification: 'rendered-controls-not-physical-take-or-listening-or-cross-browser-qualified',
      rights: 'reference-render-grants-no-new-redistribution-rights', acousticReceipt: false };
    const planes = [native.buffer.getChannelData(0), native.buffer.getChannelData(1)];
    return Object.freeze({ input: { mode: 'controls', manifest, planes, firstFrame: 0, endFrame: frames, stemLaneIds: [] },
      bytes: frames * 8, release: () => native.release() });
  } catch (error) { native.release(); throw error; }
}
