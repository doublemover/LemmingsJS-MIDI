import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { validateInstrumentPatchV2 } from '../../midi/content/InstrumentPatchV2.js';
import { compileInstrumentPerformance, retainInstrumentCause } from '../../midi/content/InstrumentPerformance.js';
import { createOwnedControlKernel } from './OwnedControlKernel.js';
import { verifyOwnedPcmPayload } from './OwnedPcmVerification.js';
import { verifyOwnedPcmSetPayload } from './OwnedPcmSetVerification.js';
import { getOwnedSourceProfile } from '../midi-ui/OwnedSourceProfiles.js';
const fail = message => { throw Object.assign(new Error('Owned continuation: ' + message), { code: 'incompatible-source-continuation' }); };
const natural = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const equal = (left, right) => canonicalDataText(left, { maxBytes: 1048576, maxNodes: 100000 }).text === canonicalDataText(right, { maxBytes: 1048576, maxNodes: 100000 }).text;
export async function prepareOwnedSourceCut({ definition, descriptor, metadata, bytes, pcm = null }, { signal, yieldControl = () => Promise.resolve(), maxWorkingBytes = 128 * 1048576 } = {}) {
  const profile = getOwnedSourceProfile(descriptor?.engineId), patch = validateInstrumentPatchV2(definition, descriptor), cut = metadata?.cut, host = metadata?.host;
  if (metadata?.schema !== 'lemmings-live-source-cut/v1' || metadata.sourceClock !== 'frozen-at-detached-block-boundary' || metadata.effects !== 'not-included-source-cut-only' || !cut || !host ||
      ![44100, 48000, 96000].includes(cut.sampleRate) || !natural(cut.frame) || !natural(cut.maxVoices, profile.voices) || cut.maxVoices < 1 || !natural(cut.graphRevision, 0xffffffff) ||
      cut.engineArtifactHash !== descriptor.artifactHash || cut.patchDefinitionHash !== await hashData(definition) || host.engineId !== profile.id || host.patchId !== patch.id || host.patchRevision !== patch.revision ||
      !['engineId', 'engineVersion', 'buildId', 'runtimeABI', 'stateTransferProtocol'].every(key => host.runtime?.[key] === profile.runtime[key]) || !equal(metadata.runtime, { engineArtifactHash: cut.engineArtifactHash, patchDefinitionHash: cut.patchDefinitionHash, graphRevision: cut.graphRevision }) ||
      !(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.byteOffset || bytes.byteLength !== bytes.buffer.byteLength || bytes.length !== cut.bytes || bytes.length > 16 * 1048576)
    fail('exact pinned engine, patch, rate, graph and source cut are required');
  signal?.throwIfAborted();
  const sourcePCM = profile.requiresPCM ? await (profile.requiresPCMSet ? verifyOwnedPcmSetPayload : verifyOwnedPcmPayload)(pcm, profile.requiresPCMSet ? patch.sampleRefs : patch.sampleRefs[0], { signal, yieldControl }) : null;
  if (!profile.requiresPCM && pcm != null || !equal(host.sourceBank, sourcePCM?.descriptor || null)) fail('source assets differ from the detached owner');
  const sourceBytes = profile.sourceBytes({ sampleRate: cut.sampleRate, voices: cut.maxVoices, pcm: sourcePCM?.descriptor || null, ...(profile.id === 'worklet-sample' ? { sampleZones: patch.sampleMap.zones.length } : {}) });
  if (!natural(maxWorkingBytes) || bytes.length * 2 + sourceBytes + (sourcePCM?.descriptor?.bytes || 0) + 32 * 1048576 > maxWorkingBytes) fail('source restoration exceeds admitted workspace');
  const kernel = await createOwnedControlKernel(profile, cut.sampleRate, cut.maxVoices, { pcm: sourcePCM, patch, signal, yieldControl }); signal?.throwIfAborted();
  const identity = { engineArtifactHash: descriptor.artifactHash, patchDefinitionHash: cut.patchDefinitionHash, graphRevision: cut.graphRevision };
  const restored = kernel.restoreFrom(bytes, identity); if (restored.frame !== cut.frame || kernel.stateByteLength() !== bytes.length || restored.abi !== cut.abi) fail('source state frontier or ABI differs');
  if (!Array.isArray(host.voices) || host.voices.length > cut.maxVoices || !Array.isArray(host.epochs) || host.epochs.length > 64 || !Array.isArray(host.inFlight) || host.inFlight.length > 512 ||
      !natural(host.commandSequence) || !natural(host.packetSequence) || host.packetSequence !== kernel.lastPacket || !natural(host.nextEpoch) || !Array.isArray(host.slotTokens) || host.slotTokens.length !== profile.voices || host.slotTokens.some(value => !natural(value, 0xffffffff)) ||
      !Array.isArray(host.laneIdentities) || host.laneIdentities.length > 4096) fail('invalid producer ownership inventory');
  const epochs = new Map(), epochTokens = new Set(), lanes = new Set(), laneTokens = new Set();
  for (const pair of host.epochs) { if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0] || pair[0].length > 512 || !natural(pair[1]) || !pair[1] || epochs.has(pair[0]) || epochTokens.has(pair[1]) || pair[1] > host.nextEpoch) fail('invalid source epoch binding'); epochs.set(...pair); epochTokens.add(pair[1]); }
  for (const pair of host.laneIdentities) { if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0] || pair[0].length > 160 || !natural(pair[1], 4096) || !pair[1] || lanes.has(pair[0]) || laneTokens.has(pair[1])) fail('invalid source lane binding'); lanes.add(pair[0]); laneTokens.add(pair[1]); }
  const commands = new Map(), pendingOnsets = new Map();
  for (let index = 0; index < kernel.queueLength; index++) { const at = index * kernel.width, packet = kernel.queue.subarray(at, at + kernel.width); commands.set(packet[2], packet); if (packet[3] === 1) pendingOnsets.set(packet[4], packet); }
  const observed = new Set();
  for (const command of host.inFlight) { const packet = commands.get(command.sequence); if (!packet || observed.has(command.sequence) || command.opcode !== packet[3] || command.frame !== packet[1] || !Array.isArray(command.data) || command.data.length !== kernel.width || command.data.some((value, index) => value !== packet[index])) fail('producer future commands differ from the render cut'); observed.add(command.sequence); }
  if (observed.size !== commands.size) fail('future source commands lack producer ownership');
  const slots = new Set(), voices = new Set(), performance = profile.extended ? compileInstrumentPerformance(patch, profile.parameters) : null;
  for (const voice of host.voices) {
    const slot = voice.slot, at = slot * 28, pending = pendingOnsets.get(slot), token = kernel.active[slot] ? kernel.voice[at + 2] : pending?.[5], epoch = kernel.active[slot] ? kernel.voice[at] : pending?.[0], generation = kernel.active[slot] ? kernel.voice[at + 1] : pending?.[17];
    if (!natural(slot, cut.maxVoices - 1) || slots.has(slot) || typeof voice.voiceId !== 'string' || !voice.voiceId || voice.voiceId.length > 512 || voices.has(JSON.stringify([voice.executionEpoch, voice.voiceId])) ||
        token !== voice.slotToken || token !== host.slotTokens[slot] || epoch !== voice.epochToken || epoch !== epochs.get(voice.executionEpoch) || generation !== voice.generation || !natural(generation)) fail('semantic voice ownership differs from the render cut');
    slots.add(slot); voices.add(JSON.stringify([voice.executionEpoch, voice.voiceId]));
    if (![voice.start, voice.releaseAt, voice.end, voice.releaseSeconds, voice.baseFrequency, voice.velocityGain, voice.expressionPan, voice.mixPan].every(Number.isFinite) || voice.start < 0 || voice.releaseAt < voice.start || voice.end < voice.releaseAt || voice.releaseSeconds < 0 || voice.releaseSeconds > 4 || voice.velocityGain < 0 || voice.velocityGain > 1 || Math.abs(voice.expressionPan) > 1 || Math.abs(voice.mixPan) > 1 || !natural(voice.performanceFrame) || !natural(voice.physicalFrame)) fail('invalid held producer state');
    if (performance) {
      const initial = performance.resolve(voice.onsetPerformance?.controls, Math.round(voice.start * cut.sampleRate), voice.performanceIdentity);
      if (!equal(initial.values, voice.onsetPerformance?.values) || !equal(initial.continuousBase, voice.onsetPerformance?.continuousBase) || !Array.isArray(voice.physicalCauses) || voice.physicalCauses.length > 3) fail('onset performance identity differs');
      const causes = voice.physicalCauses.map(retainInstrumentCause), held = performance.resolveHeld(initial, voice.currentPerformanceControls, voice.performanceIdentity, causes, cut.frame);
      if (!equal(held.values, voice.performanceValues) || !equal(held.continuousBase, voice.continuousBase)) fail('held performance composition differs');
    } else if (voice.onsetPerformance !== null || voice.currentPerformanceControls !== null) fail('source has no authored performance adapter');
    await yieldControl(); signal?.throwIfAborted();
  }
  for (let slot = 0; slot < cut.maxVoices; slot++) if ((kernel.active[slot] || pendingOnsets.has(slot)) && !slots.has(slot)) fail('a rendered voice has no semantic continuation binding');
  let checksum = 2166136261;
  for (let start = 0; start < bytes.length; start += 65536) { for (let index = start, end = Math.min(bytes.length, start + 65536); index < end; index++) checksum = Math.imul(checksum ^ bytes[index], 16777619); await yieldControl(); signal?.throwIfAborted(); }
  return { schema: 'lemmings-prepared-source-cut/v1', bytes, metadata, transportChecksum32: checksum >>> 0, validation: 'worker-restored-exact-pinned-kernel', stateAbi: restored.abi, sourceFrame: restored.frame };
}
