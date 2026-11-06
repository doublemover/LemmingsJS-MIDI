import { ownedStateTransferBytes } from './OwnedStateBundle.js';
const PROTOCOL = 1, CHUNK_BYTES = 32768, MAX_BYTES = 48 * 1048576, SMALL_SYNC_BYTES = 524288;
const exclusive = bytes => bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer && !bytes.byteOffset && bytes.length === bytes.buffer.byteLength;
const frame = value => Number.isSafeInteger(value) && value >= 0;
export class OwnedEffectTransfer {
  constructor({ kernel, port, restoring = false, alignmentFrames = 1, getHostState = () => ({}), restoreHostState = () => {} }) {
    this.kernel = kernel; this.port = port; this.getHostState = getHostState; this.restoreHostState = restoreHostState;
    if (!Number.isInteger(alignmentFrames) || alignmentFrames < 1 || alignmentFrames > 2048) throw new TypeError('Invalid effect activation grid.');
    this.alignmentFrames = alignmentFrames;
    this.bytes = ownedStateTransferBytes(kernel); this.chunked = !!kernel.stateTransfer?.writeChunks && !!kernel.stateTransfer?.restorePreparedChunks;
    this.supported = this.bytes <= MAX_BYTES && (this.chunked || this.bytes <= SMALL_SYNC_BYTES);
    this.operation = restoring ? { phase: 'empty', requestId: 0 } : null; this.frameOffset = 0; this.blockFrame = 0; this.blockFrames = 0; this.retired = false;
  }
  capabilities() { return { effectStateProtocol: this.supported ? PROTOCOL : null, effectStateBytes: this.bytes, effectStateChunkBytes: CHUNK_BYTES, effectStateAlignmentFrames: this.alignmentFrames, effectStateRestore: this.operation?.phase === 'empty' }; }
  fenced() { return !!this.operation && this.operation.phase !== 'offered'; }
  logicalFrame(audioFrame) { return audioFrame + this.frameOffset; }
  audioFrame(logicalFrame) { return logicalFrame - this.frameOffset; }
  reply(type, operation, fields = {}, transfers = []) { this.port.postMessage({ type, effectStateProtocol: PROTOCOL, requestId: operation.requestId, ...fields }, transfers); }
  fail(operation, reason) {
    const bytes = operation.bytes; operation.bytes = operation.iterator = null; operation.phase = 'failed';
    this.reply('effect-state-error', operation, { reason, ...(exclusive(bytes) && bytes.length ? { bytes } : {}) }, exclusive(bytes) && bytes.length ? [bytes.buffer] : []);
  }
  consume(data) {
    if (data?.type === 'dispose' || data?.type === 'panic') {
      if (this.operation && !['empty', 'detached', 'failed'].includes(this.operation.phase)) this.fail(this.operation, 'effect-state-owner-interrupted');
      if (data.type === 'dispose') this.retired = true; return false;
    }
    if (typeof data?.type !== 'string' || !data.type.startsWith('effect-state-')) return false;
    if (data.effectStateProtocol !== PROTOCOL || !Number.isInteger(data.requestId) || data.requestId < 1 || data.requestId > 0xffffffff || this.retired || !this.supported) return true;
    const now = globalThis.currentFrame || 0;
    if (data.type === 'effect-state-offer') {
      if (this.operation) { this.reply('effect-state-error', data, { reason: 'effect-state-owner-busy' }); return true; }
      const operation = this.operation = { requestId: data.requestId, phase: 'offered', bytes: null };
      this.reply('effect-state-offered', operation, { bytes: this.bytes, chunkBytes: CHUNK_BYTES, blockFrame: this.blockFrame, blockFrames: this.blockFrames }); return true;
    }
    if (data.type === 'effect-state-restore') {
      if (this.operation?.phase !== 'empty' || data.validation !== 'worker-restored-pinned-effect-components' || !exclusive(data.bytes) || data.bytes.length !== this.bytes || !frame(data.audioFrame) || !frame(data.logicalAudioFrame) || !frame(data.sourceFrame) || !Number.isInteger(data.transportChecksum32) || data.transportChecksum32 < 0 || data.transportChecksum32 > 0xffffffff) {
        this.reply('effect-state-error', data, { reason: 'fresh-worker-prepared-effect-required', ...(exclusive(data.bytes) ? { bytes: data.bytes } : {}) }, exclusive(data.bytes) ? [data.bytes.buffer] : []); return true;
      }
      this.operation = { requestId: data.requestId, phase: 'checking', bytes: data.bytes, sourceAudioFrame: data.audioFrame, logicalAudioFrame: data.logicalAudioFrame, sourceFrame: data.sourceFrame,
        hostState: data.hostState, cursor: 0, checksum: 2166136261, expectedChecksum: data.transportChecksum32, iterator: null }; return true;
    }
    const operation = this.operation;
    if (!operation || operation.requestId !== data.requestId) return true;
    if (data.type === 'effect-state-begin') {
      if (operation.phase !== 'offered' || !exclusive(data.bytes) || data.bytes.length !== this.bytes || !frame(data.targetAudioFrame) || data.targetAudioFrame < now || data.targetAudioFrame > now + globalThis.sampleRate * 2) {
        if (exclusive(data.bytes)) operation.bytes = data.bytes; this.fail(operation, 'invalid-effect-cut-buffer-or-target'); return true;
      }
      operation.bytes = data.bytes; operation.targetAudioFrame = data.targetAudioFrame; operation.phase = 'waiting'; return true;
    }
    if (data.type === 'effect-state-activate') {
      if (operation.phase !== 'prepared' || !frame(data.startAfterFrame) || data.startAfterFrame < now || data.startAfterFrame > now + globalThis.sampleRate * 2 || (data.startAfterFrame - operation.logicalAudioFrame) % this.alignmentFrames) { this.fail(operation, 'invalid-effect-activation-frontier'); return true; }
      operation.startAfterFrame = data.startAfterFrame; operation.phase = 'armed'; return true;
    }
    if (data.type === 'effect-state-cancel') {
      if (operation.phase === 'offered') this.operation = null; else this.fail(operation, 'effect-state-canceled'); return true;
    }
    return true;
  }
  beforeProcess(outputs) {
    this.blockFrame = globalThis.currentFrame || 0; this.blockFrames = outputs[0]?.[0]?.length || 0;
    const operation = this.operation;
    if (!operation || operation.phase === 'offered') return false;
    if (operation.phase === 'waiting' && this.blockFrame < operation.targetAudioFrame) return false;
    if (operation.phase === 'armed' && this.blockFrame === operation.startAfterFrame) {
      this.frameOffset = operation.logicalAudioFrame - this.blockFrame; this.operation = null;
      this.reply('effect-state-activated', operation, { audioFrame: this.blockFrame, logicalAudioFrame: operation.logicalAudioFrame, sourceFrame: this.kernel.frame, frameOffset: this.frameOffset }); return false;
    }
    for (const output of outputs) for (const channel of output) channel.fill(0);
    try {
      if (operation.phase === 'waiting') {
        if (this.blockFrame !== operation.targetAudioFrame) throw new Error('effect-cut-frame-missed');
        operation.audioFrame = this.blockFrame; operation.logicalAudioFrame = this.logicalFrame(this.blockFrame); operation.sourceFrame = this.kernel.frame; operation.hostState = this.getHostState();
        operation.iterator = this.chunked ? this.kernel.stateTransfer.writeChunks(operation.bytes) : (function* (kernel, bytes) { kernel.snapshotInto(bytes); return { frame: kernel.frame }; })(this.kernel, operation.bytes);
        operation.phase = 'copying';
      }
      if (operation.phase === 'copying') {
        const step = operation.iterator.next();
        if (step.done) { const bytes = operation.bytes; operation.bytes = operation.iterator = null; operation.phase = 'detached';
          this.reply('effect-state-complete', operation, { bytes, audioFrame: operation.audioFrame, logicalAudioFrame: operation.logicalAudioFrame, sourceFrame: operation.sourceFrame, hostState: operation.hostState, sourceClock: 'frozen-at-common-audio-block-boundary' }, [bytes.buffer]); }
      } else if (operation.phase === 'checking') {
        const end = Math.min(operation.cursor + CHUNK_BYTES, operation.bytes.length);
        while (operation.cursor < end) operation.checksum = Math.imul(operation.checksum ^ operation.bytes[operation.cursor++], 16777619);
        if (operation.cursor === operation.bytes.length) {
          if ((operation.checksum >>> 0) !== operation.expectedChecksum) throw new Error('effect-transport-checksum-differs');
          operation.iterator = this.chunked ? this.kernel.stateTransfer.restorePreparedChunks(operation.bytes) : (function* (kernel, bytes) { kernel.restoreFrom(bytes); return { frame: kernel.frame }; })(this.kernel, operation.bytes); operation.phase = 'restoring';
        }
      } else if (operation.phase === 'restoring') {
        const step = operation.iterator.next();
        if (step.done) {
          if (this.kernel.frame !== operation.sourceFrame) throw new Error('effect-restored-frame-differs');
          this.restoreHostState(operation.hostState); const bytes = operation.bytes; operation.bytes = operation.iterator = null; operation.phase = 'prepared';
          this.reply('effect-state-staged', operation, { bytes, sourceFrame: this.kernel.frame, sourceAudioFrame: operation.sourceAudioFrame, logicalAudioFrame: operation.logicalAudioFrame, blockFrame: this.blockFrame, blockFrames: this.blockFrames }, [bytes.buffer]);
        }
      } else if (operation.phase === 'armed' && this.blockFrame > operation.startAfterFrame) throw new Error('effect-activation-frame-missed');
    } catch (error) { this.fail(operation, String(error.message || 'effect-state-transfer-failed').slice(0, 128)); }
    return true;
  }
}

export function createOwnedEffectTransfer(processor, options, hostFields = []) {
  return new OwnedEffectTransfer({ kernel: processor.kernel, port: processor.port, restoring: options?.processorOptions?.effectStateRestore === true,
    alignmentFrames: hostFields.includes('started') ? processor.kernel.profile.hopFrames : 1,
    getHostState: () => Object.fromEntries(hostFields.map(key => [key, processor[key]])),
    restoreHostState: state => {
      if (!state || Object.getPrototypeOf(state) !== Object.prototype || Object.keys(state).length !== hostFields.length || hostFields.some(key => !Object.hasOwn(state, key))) throw new Error('effect-host-state-layout-differs');
      for (const key of hostFields) processor[key] = state[key];
      processor.reportedFaults = processor.kernel.faults; processor.captureFlights?.fill(0);
    }
  });
}
