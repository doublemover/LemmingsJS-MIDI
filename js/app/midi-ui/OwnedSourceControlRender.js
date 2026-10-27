import { RECEIPT_WIDTH, BEGIN, UPDATE, END, REJECTED, FAULTED } from './worklet/OwnedSineProcessor.js';
import { verifyOwnedPcmPayload } from '../resources/OwnedPcmVerification.js';
import { verifyOwnedPcmSetPayload } from '../resources/OwnedPcmSetVerification.js';
import { getOwnedSourceProfile } from './OwnedSourceProfiles.js';
import { ownedSourceSeed } from './OwnedSourceSeed.js';
import { compileInstrumentPerformance } from '../../midi/content/InstrumentPerformance.js';
import { createOwnedControlKernel } from '../resources/OwnedControlKernel.js';
import { validateInstrumentPatchV2 } from '../../midi/content/InstrumentPatchV2.js';
import { SOUND_CONTENT_CONTROL_FIXTURE, seedLayerControlFixture, TEXTURE_CONTROL_FIXTURE, FRICTION_CONTROL_FIXTURE, WIND_CONTROL_FIXTURE } from '../../midi/content/SoundContentControlFixture.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';

import { prepareSeedLayerPlan } from './SeedLayerPlan.js';
import { seedLayerContactBeginFields, seedLayerContactMotionFields } from '../../midi/content/SeedLayerMotion.js';
import { prepareOwnedSamplePlan } from './OwnedSamplePlan.js';
import { createOwnedSampleControlFixture } from './OwnedSampleControlFixture.js';
import { encodeOwnedAudioWav } from './OwnedAudioWav.js';
import { SAMPLE_CURSOR_DISCONTINUITIES } from '../../midi/content/SampleCursorProfile.js';

const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const digest = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function renderOwnedSourceControls({ definition, descriptor, sampleRate = 48000, source, applicationBuildId = null, pcm = null, sampleGesture = null } = {},
  { signal, yieldControl = yieldTask, onProgress = () => {} } = {}) {
  const owned = getOwnedSourceProfile(descriptor?.engineId), WIDTH = owned.width;
  if (![44100, 48000, 96000].includes(sampleRate) || !owned.controlReferenceRender || descriptor.engineVersion !== 1 || typeof yieldControl !== 'function')
    throw new TypeError('Offline controls require a pinned owned source and a supported sample rate.');
  const patch = validateInstrumentPatchV2(definition, descriptor);
  if ((owned.requiresPCMSet ? patch.sampleRefs.length < 1 || patch.sampleRefs.length > 32 : owned.requiresPCM ? patch.sampleRefs.length !== 1 : patch.sampleRefs.length !== 0) || patch.modulations.length || !owned.extended && (patch.macros.length || patch.causalBindings.length || patch.variation) || patch.voicePolicy.steal !== 'reject' || patch.voicePolicy.maxVoices > owned.voices) throw new Error('Offline controls need a realized owned patch with complete source material.');
  if (!source || Object.keys(source).some(key => !['packId', 'packVersion', 'contentHash', 'patchIdentity', 'definitionHash', 'attribution'].includes(key)) ||
      typeof source.packId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(source.packId) || typeof source.packVersion !== 'string' || !source.packVersion || source.packVersion.length > 64 ||
      typeof source.attribution !== 'string' || source.attribution.length > 32768 || applicationBuildId != null && !/^[a-f0-9]{64}$/.test(applicationBuildId) ||
      !/^[a-f0-9]{64}$/.test(source.contentHash) || !/^[a-f0-9]{64}$/.test(source.definitionHash) ||
      source.patchIdentity !== patch.id + '@' + patch.revision || await hashData(definition) !== source.definitionHash) throw new Error('Offline reference source differs from its exact saved definition.');
  canonicalDataText(source, { maxBytes: 65536, maxNodes: 4096 }); signal?.throwIfAborted();
  const sourcePCM = owned.requiresPCM ? await (owned.requiresPCMSet ? verifyOwnedPcmSetPayload : verifyOwnedPcmPayload)(pcm, owned.requiresPCMSet ? patch.sampleRefs : patch.sampleRefs[0], { signal, yieldControl }) : null, pcmDescriptor = sourcePCM?.descriptor || null;
  if (!owned.requiresPCM && pcm != null) throw new Error('This control source does not consume PCM.');
  if (sampleGesture !== null && owned.id !== 'worklet-sample') throw new TypeError('This source does not expose authored sample gestures.');
  const seedLayerPlan = owned.id === 'worklet-seed-layers' ? prepareSeedLayerPlan(patch, pcmDescriptor, sampleRate) : null;
  const samplePlan = owned.id === 'worklet-sample' ? prepareOwnedSamplePlan(patch, pcmDescriptor, sampleRate) : null;
  const sampleControls = samplePlan ? createOwnedSampleControlFixture(samplePlan, sampleGesture ?? samplePlan.map.neutralArticulationId) : null;
  const fixture = sampleControls?.fixture || (owned.id === 'worklet-seed-layers' ? seedLayerControlFixture(patch) : owned.id === 'worklet-wind' ? WIND_CONTROL_FIXTURE : owned.id === 'worklet-friction' ? FRICTION_CONTROL_FIXTURE : owned.id === 'worklet-texture' ? TEXTURE_CONTROL_FIXTURE : SOUND_CONTENT_CONTROL_FIXTURE), selected = sampleControls?.selected || null;
  const identity = { onsetId: 'control-fixture', voiceId: 'control-fixture', actorId: null, generation: 1 };
  const performance = owned.extended ? compileInstrumentPerformance(patch, owned.parameters).resolve({}, 0, identity) : null;
  const values = performance?.values || Object.fromEntries(Object.entries(owned.fields).map(([id, spec]) => [id, patch.parameters[id] ?? spec[2]]));
  if (!owned.acceptsParameters(values)) throw new Error('Offline source parameter layout is unavailable.');
  const seed = selected?.region.selectionSeed ?? ownedSourceSeed(owned, patch, identity, performance);
  const releaseFrame = Math.round(Math.max(...fixture.events.map(event => event.seconds)) * sampleRate), releaseFrames = Math.max(1, Math.round(values.releaseSeconds * sampleRate));
  const child = selected ? samplePlan.entries[selected.zoneIndex].release : null;
  const finalOffset = fixture.events.reduce((value, event) => event.expression?.pitchOffsetCents ?? value, 0);
  const childFrames = child ? Math.ceil(Math.min(4, (child.sourceEnd - child.sourceFirst) / child.sourceSampleRate / (selected.releaseRateRatio * (child.pitchTracking === 'fixed' ? 1 : 2 ** (finalOffset / 1200)))) * sampleRate) : 0;
  const tailFrames = Math.max(releaseFrames, childFrames, samplePlan?.body ? sampleRate * 4 : 0), frames = releaseFrame + tailFrames + 128;
  const packet = new Float64Array(fixture.events.length * WIDTH);
  const frequency = cents => 440 * 2 ** ((cents - 6900) / 1200);
  const basePitch = fixture.events[0].pitchCents;
  for (let index = 0; index < fixture.events.length; index++) {
    const event = fixture.events[index], offset = index * WIDTH, expression = event.expression || {};
    packet[offset] = 1; packet[offset + 1] = Math.round(event.seconds * sampleRate); packet[offset + 2] = index + 1;
    packet[offset + 3] = event.kind === 'begin' ? BEGIN : ['update', 'position', 'seed-layer-motion'].includes(event.kind) ? UPDATE : END; packet[offset + 4] = 0; packet[offset + 5] = 1; packet[offset + 17] = 1;
    if (event.kind === 'begin') {
      if (!owned.acceptsOnset(values, frequency(event.pitchCents), pcmDescriptor, sampleRate)) throw new Error('Offline source onset is out of range.');
      for (const [field, value] of Object.entries(owned.beginFields(values, seed, pcmDescriptor, selected, ['worklet-texture', 'worklet-friction'].includes(owned.id) ? owned.travelPlanner(values, { controlFixture: true }, packet[offset + 1], sampleRate) : null))) packet[offset + Number(field)] = value;
      if (event.seedLayerControlFixture) for (const [field, value] of Object.entries(seedLayerContactBeginFields({ lastSequence: 0 }))) packet[offset + Number(field)] = value;
      packet[offset + 6] = frequency(event.pitchCents); packet[offset + 7] = event.velocity01 * values.gain01 * patch.mix.gain01;
      packet[offset + 8] = expression.pressure01; packet[offset + 9] = Math.max(-1, Math.min(1, expression.pan01 + patch.mix.pan01));
      packet[offset + 10] = Math.round(values.attackSeconds * sampleRate); packet[offset + 11] = Math.round(values.decaySeconds * sampleRate);
      packet[offset + 12] = values.sustain01; packet[offset + 13] = releaseFrames; packet[offset + 16] = frames + 128;
    } else if (event.kind === 'seed-layer-motion') {
      for (const [field, value] of Object.entries(seedLayerContactMotionFields({ firstFrame: packet[offset + 1], endFrame: Math.round((event.seconds + event.spanSeconds) * sampleRate), from: event.from, to: event.to, sequence: event.sequence }))) packet[offset + Number(field)] = value;
    } else if (event.kind === 'position') {
      const segment = event.segment;
      packet[offset + 15] = 8; packet[offset + 18] = segment.firstOutputFrame; packet[offset + 19] = segment.endOutputFrame;
      packet[offset + 20] = segment.firstSourceFrame; packet[offset + 21] = segment.endSourceFrame; packet[offset + 22] = segment.sequence;
      packet[offset + 23] = SAMPLE_CURSOR_DISCONTINUITIES.indexOf(segment.discontinuity);
    } else if (event.kind === 'update') {
      let mask = 0;
      if (expression.pitchOffsetCents != null) {
        if (selected) { const entry = samplePlan.entries[selected.zoneIndex], pitch = { cents: basePitch, referenceHz: 440 };
          if (!samplePlan.rateFor(entry.attack, pitch, expression.pitchOffsetCents) || entry.release && !samplePlan.rateFor(entry.release, pitch, expression.pitchOffsetCents)) throw new TypeError('The fixed fixture pitch exceeds its selected source region.'); }
        packet[offset + 6] = frequency(basePitch + expression.pitchOffsetCents); mask |= 1; }
      if (expression.pressure01 != null) { packet[offset + 8] = expression.pressure01; mask |= 2; }
      if (expression.pan01 != null) { packet[offset + 9] = Math.max(-1, Math.min(1, expression.pan01 + patch.mix.pan01)); mask |= 4; }
      packet[offset + 14] = Math.ceil(0.008 * sampleRate); packet[offset + 15] = mask;
    } else { packet[offset + 13] = releaseFrames; if (selected) packet[offset + 16] = releaseFrame + tailFrames; }
  }
  const kernel = await createOwnedControlKernel(owned, sampleRate, owned.requiresPCMSet ? owned.voices : patch.voicePolicy.maxVoices, { signal, yieldControl, pcm: sourcePCM, patch }), outputPcm = new Uint8Array(frames * 8), pcmView = new DataView(outputPcm.buffer);
  const left = new Float32Array(128), right = new Float32Array(128); let squares = 0, peak = 0, overFullScale = 0, blocks = 0;
  const checkReceipts = () => {
    for (let index = 0; index < kernel.receiptCount; index++) {
      const code = kernel.receipts[index * RECEIPT_WIDTH]; if (code === REJECTED || code === FAULTED) throw new Error('Offline owned source kernel rejected or faulted a fixture command.');
    }
    kernel.receiptCount = 0;
  };
  kernel.accept(packet, fixture.events.length, 1); checkReceipts();
  for (let first = 0; first < frames; first += 128) {
    signal?.throwIfAborted(); const count = Math.min(128, frames - first);
    kernel.render(count === 128 ? left : left.subarray(0, count), count === 128 ? right : right.subarray(0, count), first); checkReceipts();
    for (let index = 0; index < count; index++) for (let channel = 0; channel < 2; channel++) {
      const value = channel ? right[index] : left[index]; if (!Number.isFinite(value)) throw new Error('Offline owned source produced a nonfinite sample.');
      squares += value * value; peak = Math.max(peak, Math.abs(value)); if (Math.abs(value) > 1) overFullScale++;
      pcmView.setFloat32(((first + index) * 2 + channel) * 4, value, true);
    }
    if (++blocks % 32 === 0) { onProgress({ phase: 'rendering-controls', completedUnits: first + count, totalUnits: frames }); await yieldControl(); }
  }
  if (kernel.active.some(Boolean) || kernel.nonfinite || kernel.queueLength) throw new Error('Offline owned source did not finish all voice tails.');
  signal?.throwIfAborted();
  const pcmHash = await digest(outputPcm), fixtureHash = await hashData(fixture); signal?.throwIfAborted();
  const manifest = { schema: 'lemmings-rendered-audition/v1', source, engineRequirement: { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion,
    artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash }, applicationBuildId,
  fixture, fixtureHash, physicalTakeEvidence: false, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames,
  pcmHash, renderTap: owned.id === 'worklet-sine' ? 'sine-kernel-stereo-before-shared-owner-master-and-limiter' : owned.id + '-kernel-stereo-before-shared-owner-master-and-limiter', renderScope: 'fixed-controls-from-silence', sourceBank: pcmDescriptor, fixedBank: kernel.source?.bank ? { id: kernel.source.bank.id, hash: kernel.source.bank.hash, bytes: kernel.source.bank.bytes } : null, sourceTypedBytes: owned.sourceBytes({ sampleRate, pcm: pcmDescriptor, voices: patch.voicePolicy.maxVoices }), sampleSelection: selected, sampleMap: samplePlan ? { revision: samplePlan.map.revision, planRevision: samplePlan.revision, physicalSourcePool: owned.voices, logicalVoiceLimit: patch.voicePolicy.maxVoices } : null, sourcePerformance: { seed, values, controls: performance?.controls || null, variation: performance?.variation || null, bindingOutcomes: performance?.bindingOutcomes || [], physicalSources: 'none-in-authored-control-fixture' }, normalization: 'none', seedLayers: seedLayerPlan ? { profile: seedLayerPlan.profile, footprint: seedLayerPlan.footprint, sourceBanks: seedLayerPlan.sourceBanks, timing: seedLayerPlan.timing } : null, quality: seedLayerPlan ? 'creative-three-child-revoice-not-neutral-or-qualified-warp' : owned.requiresPCMSet ? 'source-rate-pcm-prepared-windowed-sinc-128taps-fractional-region-periods' : owned.requiresPCM ? 'source-rate-pcm-linear-read-resampling' : 'native-kernel-rate-no-resampling',
  tail: { releaseFrames, childFrames, admittedFrames: tailFrames, extraFrames: 128, state: 'all-voices-ended' }, statistics: { peak, rms: Math.sqrt(squares / (frames * 2)), overFullScaleSamples: overFullScale },
  qualification: 'rendered-controls-not-physical-take-or-listening-qualified', rights: 'reference-render-grants-no-new-redistribution-rights', acousticReceipt: false };
  return { bytes: encodeOwnedAudioWav(outputPcm, frames, sampleRate, manifest), manifest };
}
