import { LIVE_LANE_ID_LIMIT } from '../OwnedSourceLayout.js';
export const SINE_STATE_ABI = 'owned-sine-state-le-v3-lane-transfer';
const WIDTH = 18, CAPACITY = 512, VOICES = 64, VOICE_WIDTH = 28, RECEIPTS = 2048, RECEIPT_WIDTH = 6;
const QUEUE = 128, VOICE = QUEUE + CAPACITY * WIDTH * 8, ACTIVE = VOICE + VOICES * VOICE_WIDTH * 8;
const MIX = ACTIVE + VOICES, COUNTERS = MIX + VOICES * 6 * 8, RECEIPT = COUNTERS + 8 * 4;
export const SINE_STATE_BYTES = RECEIPT + RECEIPTS * RECEIPT_WIDTH * 8 + VOICES * 7 * 8;
const layoutFor = width => {
  if (![18, 24, 26, 33, 40, 73, 80].includes(width)) throw new Error('Unknown owned kernel state width.');
  const voice = QUEUE + CAPACITY * width * 8, active = voice + VOICES * VOICE_WIDTH * 8, mix = active + VOICES, counters = mix + VOICES * 6 * 8, receipt = counters + 8 * 4;
  const lanes = receipt + RECEIPTS * RECEIPT_WIDTH * 8, pending = lanes + VOICES * 5 * 8;
  return { WIDTH: width, VOICE: voice, ACTIVE: active, MIX: mix, COUNTERS: counters, RECEIPT: receipt, LANES: lanes, PENDING: pending, bytes: pending + VOICES * 2 * 8 };
};
export const ownedKernelStateBytes = kernel => layoutFor(kernel.width).bytes;
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'incompatible-sine-state' }); };
const natural = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const identityFields = ['engineArtifactHash', 'patchDefinitionHash'];
const inspectIdentity = identity => {
  if (!identity || Object.keys(identity).some(key => ![...identityFields, 'graphRevision'].includes(key)) ||
      identityFields.some(key => typeof identity[key] !== 'string' || !/^[a-f0-9]{64}$/.test(identity[key])) || !natural(identity.graphRevision, 0xffffffff))
    fail('DSP state needs exact engine, patch and graph identities.');
};
const viewFor = (bytes, length = SINE_STATE_BYTES) => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length ||
      typeof SharedArrayBuffer === 'function' && bytes.buffer instanceof SharedArrayBuffer) fail('DSP state requires one exclusively owned fixed-size byte buffer.');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
};
const inspectKernel = kernel => {
  const { WIDTH } = layoutFor(kernel?.width);
  if (!kernel || !(kernel.queue instanceof Float64Array) || kernel.queue.length !== CAPACITY * WIDTH ||
      !(kernel.laneRoutes instanceof Float64Array) || kernel.laneRoutes.length !== VOICES * 5 || !(kernel.pendingLanes instanceof Float64Array) || kernel.pendingLanes.length !== VOICES * 2 ||
      !(kernel.mix instanceof Float64Array) || kernel.mix.length !== VOICES * 6 || !(kernel.voice instanceof Float64Array) || kernel.voice.length !== VOICES * VOICE_WIDTH || !(kernel.active instanceof Uint8Array) || kernel.active.length !== VOICES ||
      !(kernel.receipts instanceof Float64Array) || kernel.receipts.length !== RECEIPTS * RECEIPT_WIDTH || !(kernel.counters instanceof Uint32Array) || kernel.counters.length !== 8 ||
      !natural(kernel.queueLength, CAPACITY) || !natural(kernel.receiptCount, RECEIPTS) || !natural(kernel.lastPacket) || !natural(kernel.lastFrame) ||
      kernel.nonfinite !== 0 || typeof kernel.panicPending !== 'boolean')
    fail('DSP kernel storage differs from the snapshot ABI.');
};
const verify = (bytes, identity, { sampleRate, maxVoices, width }) => {
  const { WIDTH, VOICE, ACTIVE, MIX, RECEIPT, LANES, PENDING, bytes: length } = layoutFor(width);
  inspectIdentity(identity); const view = viewFor(bytes, length);
  if (view.getUint32(0, true) !== 0x31534e4c || view.getUint32(4, true) !== 4 || view.getUint32(8, true) !== length ||
      view.getUint32(12, true) !== maxVoices || view.getFloat64(16, true) !== sampleRate || !natural(maxVoices, VOICES) || maxVoices < 1 ||
      !bounded(sampleRate, 8000, 384000) || view.getUint32(120, true) !== identity.graphRevision || view.getUint32(124, true) !== (width === 18 ? 0 : width))
    fail('DSP state ABI, rate, voice profile or graph identity is incompatible.');
  for (let field = 0; field < identityFields.length; field++) for (let index = 0; index < 32; index++)
    if (view.getUint8(56 + field * 32 + index) !== parseInt(identity[identityFields[field]].slice(index * 2, index * 2 + 2), 16)) fail('DSP state engine or patch hash is incompatible.');
  const frame = view.getFloat64(24, true), packet = view.getFloat64(32, true), queued = view.getUint32(40, true), received = view.getUint32(44, true);
  if (!natural(frame) || !natural(packet) || queued > CAPACITY || received > RECEIPTS || view.getUint32(48, true) !== 0 || view.getUint32(52, true) > 1)
    fail('DSP state has invalid frontiers or an unresolved nonfinite fault.');
  for (let index = 0; index < CAPACITY * WIDTH; index++) {
    const value = view.getFloat64(QUEUE + index * 8, true);
    if (!Number.isFinite(value) || index >= queued * WIDTH && value !== 0) fail('DSP command storage is noncanonical.');
  }
  const sequenceSet = new Set();
  for (let index = 0; index < queued; index++) {
    const at = QUEUE + index * WIDTH * 8, get = field => view.getFloat64(at + field * 8, true), opcode = get(3), slot = get(4), token = get(5);
    if (!natural(get(0)) || !natural(get(1)) || get(1) > frame + sampleRate * 10 || !natural(get(2)) || get(2) < 1 || sequenceSet.has(get(2)) ||
        ![1, 2, 3, 4, 6, 7].includes(opcode) || !natural(get(17)) || (opcode === 4 ? slot !== -1 || token !== 0 : !natural(slot, maxVoices - 1) || !natural(token) || token < 1))
      fail('DSP future-control identity or frontier is invalid.');
    sequenceSet.add(get(2));
    if (index) {
      const parent = QUEUE + Math.floor((index - 1) / 2) * WIDTH * 8, parentFrame = view.getFloat64(parent + 8, true), parentSequence = view.getFloat64(parent + 16, true);
      if (get(1) < parentFrame || get(1) === parentFrame && get(2) < parentSequence) fail('DSP future-control heap order is invalid.');
    }
  }
  for (let index = 0; index < VOICES * VOICE_WIDTH; index++) if (!Number.isFinite(view.getFloat64(VOICE + index * 8, true))) fail('DSP voice storage contains nonfinite state.');
  for (let slot = 0; slot < VOICES; slot++) {
    const active = view.getUint8(ACTIVE + slot); if (active > 1 || slot >= maxVoices && active) fail('DSP voice membership is invalid.');
    if (!active) continue;
    const get = field => view.getFloat64(VOICE + (slot * VOICE_WIDTH + field) * 8, true);
    if (!natural(get(0)) || !natural(get(1)) || !natural(get(2)) || get(2) < 1 || !bounded(get(3), 0, 2 * Math.PI) || !bounded(get(4), 0, 1) ||
        !bounded(get(5), Number.MIN_VALUE, sampleRate / 2) || get(5) >= sampleRate / 2 || !bounded(get(6), Number.MIN_VALUE, sampleRate / 2) || get(6) >= sampleRate / 2 || !bounded(get(7), 0, 1) ||
        !bounded(get(8), 0, 1) || !bounded(get(9), 0, 1) || !bounded(get(10), -1, 1) || !bounded(get(11), -1, 1) ||
        ![12, 13, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27].every(field => natural(get(field))) ||
        !bounded(get(14), 0, 1) || get(19) < 0 || get(15) >= frame || get(26) >= frame || get(22) < 1 || get(16) <= get(15))
      fail('DSP active voice state is invalid or incomplete.');
  }
  for (let slot = 0; slot < VOICES; slot++) for (let field = 0; field < 6; field++) {
    const value = view.getFloat64(MIX + (slot * 6 + field) * 8, true);
    if (field % 3 === 2 ? !natural(value, sampleRate) : !bounded(value, field < 3 ? 0 : -1, field < 3 ? 2 : 1)) fail('DSP lane mix state is invalid.');
  }
  for (let slot = 0; slot < VOICES; slot++) {
    const get = field => view.getFloat64(LANES + (slot * 5 + field) * 8, true), token = view.getFloat64(PENDING + slot * 2 * 8, true), lane = view.getFloat64(PENDING + (slot * 2 + 1) * 8, true);
    if (!natural(get(0), LIVE_LANE_ID_LIMIT) || !natural(get(1), LIVE_LANE_ID_LIMIT) || !natural(get(2), sampleRate) || !natural(get(3), sampleRate) ||
        get(2) > get(3) || !natural(get(4), frame) || !natural(token, 0xffffffff) || !natural(lane, LIVE_LANE_ID_LIMIT) || !token && lane ||
        view.getUint8(ACTIVE + slot) && token && token < view.getFloat64(VOICE + (slot * VOICE_WIDTH + 2) * 8, true)) fail('DSP lane transfer identity or fade state is invalid.');
  }
  for (let index = 0; index < RECEIPTS * RECEIPT_WIDTH; index++) {
    const value = view.getFloat64(RECEIPT + index * 8, true);
    if (!Number.isFinite(value) || index >= received * RECEIPT_WIDTH && value !== 0) fail('DSP receipt storage is noncanonical.');
  }
  for (let index = 0; index < received; index++) {
    const at = RECEIPT + index * RECEIPT_WIDTH * 8, get = field => view.getFloat64(at + field * 8, true);
    if (!natural(get(0), 6) || get(0) < 1 || !natural(get(1)) || !Number.isInteger(get(2)) || get(2) < -1 || get(2) >= maxVoices ||
        !natural(get(3)) || !natural(get(4)) || !natural(get(5), 13)) fail('DSP receipt frontier is invalid.');
  }
  return { view, frame, packet, queued, received };
};

export function writeOwnedKernelState(kernel, destination, identity) {
  const { WIDTH, VOICE, ACTIVE, MIX, COUNTERS, RECEIPT, LANES, PENDING, bytes: length } = layoutFor(kernel.width);
  inspectKernel(kernel); inspectIdentity(identity); const view = viewFor(destination, length);
  if ([kernel.queue, kernel.voice, kernel.mix, kernel.laneRoutes, kernel.pendingLanes, kernel.active, kernel.counters, kernel.receipts].some(array => array.buffer === destination.buffer)) fail('DSP transfer storage aliases active kernel state.');
  destination.fill(0);
  view.setUint32(0, 0x31534e4c, true); view.setUint32(4, 4, true); view.setUint32(8, length, true); view.setUint32(12, kernel.maxVoices, true);
  view.setFloat64(16, kernel.sampleRate, true); view.setFloat64(24, kernel.lastFrame, true); view.setFloat64(32, kernel.lastPacket, true);
  view.setUint32(40, kernel.queueLength, true); view.setUint32(44, kernel.receiptCount, true); view.setUint32(48, kernel.nonfinite, true); view.setUint32(52, Number(kernel.panicPending), true);
  for (let field = 0; field < identityFields.length; field++) for (let index = 0; index < 32; index++) view.setUint8(56 + field * 32 + index, parseInt(identity[identityFields[field]].slice(index * 2, index * 2 + 2), 16));
  view.setUint32(120, identity.graphRevision, true); view.setUint32(124, kernel.width === 18 ? 0 : kernel.width, true);
  for (let index = 0; index < kernel.queueLength * WIDTH; index++) view.setFloat64(QUEUE + index * 8, kernel.queue[index], true);
  for (let index = 0; index < kernel.voice.length; index++) view.setFloat64(VOICE + index * 8, kernel.voice[index], true);
  for (let index = 0; index < kernel.mix.length; index++) view.setFloat64(MIX + index * 8, kernel.mix[index], true);
  for (let index = 0; index < kernel.laneRoutes.length; index++) view.setFloat64(LANES + index * 8, kernel.laneRoutes[index], true);
  for (let index = 0; index < kernel.pendingLanes.length; index++) view.setFloat64(PENDING + index * 8, kernel.pendingLanes[index], true);
  destination.set(kernel.active, ACTIVE); for (let index = 0; index < 8; index++) view.setUint32(COUNTERS + index * 4, kernel.counters[index], true);
  for (let index = 0; index < kernel.receiptCount * RECEIPT_WIDTH; index++) view.setFloat64(RECEIPT + index * 8, kernel.receipts[index], true);
  const cut = verify(destination, identity, kernel);
  return Object.freeze({ abi: SINE_STATE_ABI, frame: cut.frame, bytes: length, sampleRate: kernel.sampleRate, maxVoices: kernel.maxVoices,
    futureCommands: cut.queued, pendingReceipts: cut.received, equivalence: 'same-artifact-rate-and-profile', ...identity });
}

export function restoreOwnedKernelState(kernel, source, identity) {
  const { VOICE, ACTIVE, MIX, COUNTERS, RECEIPT, LANES, PENDING } = layoutFor(kernel.width);
  inspectKernel(kernel); const cut = verify(source, identity, kernel), { view } = cut;
  for (let index = 0; index < kernel.queue.length; index++) kernel.queue[index] = view.getFloat64(QUEUE + index * 8, true);
  for (let index = 0; index < kernel.voice.length; index++) kernel.voice[index] = view.getFloat64(VOICE + index * 8, true);
  for (let index = 0; index < kernel.mix.length; index++) kernel.mix[index] = view.getFloat64(MIX + index * 8, true);
  for (let index = 0; index < kernel.laneRoutes.length; index++) kernel.laneRoutes[index] = view.getFloat64(LANES + index * 8, true);
  for (let index = 0; index < kernel.pendingLanes.length; index++) kernel.pendingLanes[index] = view.getFloat64(PENDING + index * 8, true);
  for (let index = 0; index < VOICES; index++) kernel.active[index] = view.getUint8(ACTIVE + index);
  for (let index = 0; index < 8; index++) kernel.counters[index] = view.getUint32(COUNTERS + index * 4, true);
  for (let index = 0; index < kernel.receipts.length; index++) kernel.receipts[index] = view.getFloat64(RECEIPT + index * 8, true);
  kernel.lastFrame = cut.frame; kernel.lastPacket = cut.packet; kernel.queueLength = cut.queued; kernel.receiptCount = cut.received; kernel.nonfinite = 0; kernel.panicPending = !!view.getUint32(52, true);
  kernel.displayTokens.fill(0); kernel.displayState.fill(0); kernel.displayData.fill(0); kernel.displayCount = 0;
  kernel.displayEnabled = kernel.displayReady = false; kernel.displayInterval = kernel.displayNext = kernel.displayRevision = kernel.displaySequence = kernel.displayDropped = 0;
  return Object.freeze({ abi: SINE_STATE_ABI, frame: cut.frame, futureCommands: cut.queued, pendingReceipts: cut.received, displaySubscriptions: 'new-observation-required' });
}

export function writeOwnedSineState(kernel, destination, identity) {
  if (kernel.width !== WIDTH || kernel.source) fail('Sine state requires the exact sine source profile.');
  return writeOwnedKernelState(kernel, destination, identity);
}
export function restoreOwnedSineState(kernel, source, identity) {
  if (kernel.width !== WIDTH || kernel.source) fail('Sine state requires the exact sine source profile.');
  return restoreOwnedKernelState(kernel, source, identity);
}
