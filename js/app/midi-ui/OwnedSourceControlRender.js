import { RECEIPT_WIDTH, BEGIN, UPDATE, END, REJECTED, FAULTED } from './worklet/OwnedSineProcessor.js';
import { getOwnedSourceProfile } from './OwnedSourceProfiles.js';
import { ownedSourceSeed } from './OwnedSourceSeed.js';
import { compileInstrumentPerformance } from '../../midi/content/InstrumentPerformance.js';
import { createOwnedControlKernel } from '../resources/OwnedControlKernel.js';
import { validateInstrumentPatchV2 } from '../../midi/content/InstrumentPatchV2.js';
import { SOUND_CONTENT_CONTROL_FIXTURE } from '../../midi/content/SoundContentControlFixture.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';

const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const ascii = (view, offset, text) => { for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index)); };
const digest = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function renderOwnedSourceControls({ definition, descriptor, sampleRate = 48000, source, applicationBuildId = null } = {},
  { signal, yieldControl = yieldTask, onProgress = () => {} } = {}) {
  const owned = getOwnedSourceProfile(descriptor?.engineId), WIDTH = owned.width;
  if (![44100, 48000, 96000].includes(sampleRate) || !owned.controlReferenceRender || descriptor.engineVersion !== 1 || typeof yieldControl !== 'function')
    throw new TypeError('Offline controls require a pinned owned source and a supported sample rate.');
  const patch = validateInstrumentPatchV2(definition, descriptor);
  if (patch.sampleRefs.length || patch.modulations.length || !owned.extended && (patch.macros.length || patch.causalBindings.length || patch.variation) || patch.voicePolicy.steal !== 'reject' || patch.voicePolicy.maxVoices > owned.voices) throw new Error('Offline controls need a realized asset-free owned patch.');
  if (!source || Object.keys(source).some(key => !['packId', 'packVersion', 'contentHash', 'patchIdentity', 'definitionHash', 'attribution'].includes(key)) ||
      typeof source.packId !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(source.packId) || typeof source.packVersion !== 'string' || !source.packVersion || source.packVersion.length > 64 ||
      typeof source.attribution !== 'string' || source.attribution.length > 32768 || applicationBuildId != null && !/^[a-f0-9]{64}$/.test(applicationBuildId) ||
      !/^[a-f0-9]{64}$/.test(source.contentHash) || !/^[a-f0-9]{64}$/.test(source.definitionHash) ||
      source.patchIdentity !== patch.id + '@' + patch.revision || await hashData(definition) !== source.definitionHash) throw new Error('Offline reference source differs from its exact saved definition.');
  canonicalDataText(source, { maxBytes: 65536, maxNodes: 4096 }); signal?.throwIfAborted();
  const identity = { onsetId: 'control-fixture', voiceId: 'control-fixture', actorId: null, generation: 1 };
  const performance = owned.extended ? compileInstrumentPerformance(patch, owned.parameters).resolve({}, 0, identity) : null;
  const values = performance?.values || Object.fromEntries(Object.entries(owned.fields).map(([id, spec]) => [id, patch.parameters[id] ?? spec[2]]));
  if (!owned.acceptsParameters(values)) throw new Error('Offline source parameter layout is unavailable.');
  const seed = ownedSourceSeed(owned, patch, identity, performance);
  const releaseFrame = sampleRate, releaseFrames = Math.max(1, Math.round(values.releaseSeconds * sampleRate)), frames = releaseFrame + releaseFrames + 128;
  const packet = new Float64Array(SOUND_CONTENT_CONTROL_FIXTURE.events.length * WIDTH);
  const frequency = cents => 440 * 2 ** ((cents - 6900) / 1200);
  const basePitch = SOUND_CONTENT_CONTROL_FIXTURE.events[0].pitchCents;
  for (let index = 0; index < SOUND_CONTENT_CONTROL_FIXTURE.events.length; index++) {
    const event = SOUND_CONTENT_CONTROL_FIXTURE.events[index], offset = index * WIDTH, expression = event.expression || {};
    packet[offset] = 1; packet[offset + 1] = Math.round(event.seconds * sampleRate); packet[offset + 2] = index + 1;
    packet[offset + 3] = event.kind === 'begin' ? BEGIN : event.kind === 'update' ? UPDATE : END; packet[offset + 4] = 0; packet[offset + 5] = 1; packet[offset + 17] = 1;
    if (event.kind === 'begin') {
      if (!owned.acceptsOnset(values, frequency(event.pitchCents), null)) throw new Error('Offline source onset is out of range.');
      for (const [field, value] of Object.entries(owned.beginFields(values, seed, null))) packet[offset + Number(field)] = value;
      packet[offset + 6] = frequency(event.pitchCents); packet[offset + 7] = event.velocity01 * values.gain01 * patch.mix.gain01;
      packet[offset + 8] = expression.pressure01; packet[offset + 9] = Math.max(-1, Math.min(1, expression.pan01 + patch.mix.pan01));
      packet[offset + 10] = Math.round(values.attackSeconds * sampleRate); packet[offset + 11] = Math.round(values.decaySeconds * sampleRate);
      packet[offset + 12] = values.sustain01; packet[offset + 13] = releaseFrames; packet[offset + 16] = frames + 128;
    } else if (event.kind === 'update') {
      let mask = 0;
      if (expression.pitchOffsetCents != null) { packet[offset + 6] = frequency(basePitch + expression.pitchOffsetCents); mask |= 1; }
      if (expression.pressure01 != null) { packet[offset + 8] = expression.pressure01; mask |= 2; }
      if (expression.pan01 != null) { packet[offset + 9] = Math.max(-1, Math.min(1, expression.pan01 + patch.mix.pan01)); mask |= 4; }
      packet[offset + 14] = Math.ceil(0.008 * sampleRate); packet[offset + 15] = mask;
    } else packet[offset + 13] = releaseFrames;
  }
  const kernel = await createOwnedControlKernel(owned, sampleRate, patch.voicePolicy.maxVoices, { signal, yieldControl }), pcm = new Uint8Array(frames * 8), pcmView = new DataView(pcm.buffer);
  const left = new Float32Array(128), right = new Float32Array(128); let squares = 0, peak = 0, overFullScale = 0, blocks = 0;
  const checkReceipts = () => {
    for (let index = 0; index < kernel.receiptCount; index++) {
      const code = kernel.receipts[index * RECEIPT_WIDTH]; if (code === REJECTED || code === FAULTED) throw new Error('Offline owned source kernel rejected or faulted a fixture command.');
    }
    kernel.receiptCount = 0;
  };
  kernel.accept(packet, SOUND_CONTENT_CONTROL_FIXTURE.events.length, 1); checkReceipts();
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
  const pcmHash = await digest(pcm), fixtureHash = await hashData(SOUND_CONTENT_CONTROL_FIXTURE); signal?.throwIfAborted();
  const manifest = { schema: 'lemmings-rendered-audition/v1', source, engineRequirement: { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion,
    artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash }, applicationBuildId,
  fixture: SOUND_CONTENT_CONTROL_FIXTURE, fixtureHash, physicalTakeEvidence: false, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', frames,
  pcmHash, renderTap: owned.id === 'worklet-sine' ? 'sine-kernel-stereo-before-shared-owner-master-and-limiter' : owned.id + '-kernel-stereo-before-shared-owner-master-and-limiter', renderScope: 'fixed-controls-from-silence', fixedBank: kernel.source?.bank ? { id: kernel.source.bank.id, hash: kernel.source.bank.hash, bytes: kernel.source.bank.bytes } : null, sourceTypedBytes: owned.sourceBytes(sampleRate), sourcePerformance: { seed, values, controls: performance?.controls || null, variation: performance?.variation || null, bindingOutcomes: performance?.bindingOutcomes || [], physicalSources: 'none-in-authored-control-fixture' }, normalization: 'none', quality: 'native-kernel-rate-no-resampling',
  tail: { releaseFrames, extraFrames: 128, state: 'all-voices-ended' }, statistics: { peak, rms: Math.sqrt(squares / (frames * 2)), overFullScaleSamples: overFullScale },
  qualification: 'rendered-controls-not-physical-take-or-listening-qualified', rights: 'reference-render-grants-no-new-redistribution-rights', acousticReceipt: false };
  const metadata = canonicalDataText(manifest, { maxBytes: 65536, maxNodes: 8192 }).bytes, padded = metadata.byteLength + metadata.byteLength % 2;
  const wav = new Uint8Array(56 + pcm.byteLength + 8 + padded), view = new DataView(wav.buffer);
  ascii(view, 0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); ascii(view, 8, 'WAVE'); ascii(view, 12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 8, true); view.setUint16(32, 8, true); view.setUint16(34, 32, true);
  ascii(view, 36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, frames, true); ascii(view, 48, 'data'); view.setUint32(52, pcm.byteLength, true); wav.set(pcm, 56);
  const metadataAt = 56 + pcm.byteLength; ascii(view, metadataAt, 'lmjs'); view.setUint32(metadataAt + 4, metadata.byteLength, true); wav.set(metadata, metadataAt + 8);
  return { bytes: wav, manifest };
}
