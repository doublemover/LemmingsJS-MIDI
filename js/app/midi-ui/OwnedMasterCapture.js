import { createAudioResourceLeases, releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { prepareReplayableExportArtifact } from '../export/ExportArtifact.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
import { createMasterCaptureProvenance } from './MasterCaptureProvenance.js';

const PROTOCOL = 1, CHANNELS = 2, CHUNK_FRAMES = 4096, MAX_GAPS = 256, COPY_BYTES = 65536;
let captureSequence = 0;
const fail = text => Object.assign(new Error(text), { name: 'MasterCaptureError' });
const integer = value => Number.isSafeInteger(value) && value >= 0;
const ascii = (bytes, offset, text) => { for (let index = 0; index < text.length; index++) bytes[offset + index] = text.charCodeAt(index); };

export function createPcmCaptureWavLayout(manifest) {
  if (!integer(manifest?.timelineFrames) || manifest.timelineFrames > 192000 * 300 || !integer(manifest.sampleRate) ||
      manifest.sampleRate < 8000 || manifest.sampleRate > 192000) throw fail('Invalid captured WAV bounds.');
  const annotation = canonicalDataText(manifest, { maxBytes: 256 * 1024, maxNodes: 16384 }).bytes;
  const dataBytes = manifest.timelineFrames * CHANNELS * 4, suffix = new Uint8Array(8 + annotation.byteLength + (annotation.byteLength & 1));
  ascii(suffix, 0, 'lmjs'); new DataView(suffix.buffer).setUint32(4, annotation.byteLength, true); suffix.set(annotation, 8);
  const header = new Uint8Array(56), view = new DataView(header.buffer), byteLength = header.byteLength + dataBytes + suffix.byteLength;
  if (byteLength - 8 > 0xffffffff) throw fail('Captured WAV exceeds the RIFF size bound.');
  ascii(header, 0, 'RIFF'); view.setUint32(4, byteLength - 8, true); ascii(header, 8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); view.setUint16(22, CHANNELS, true); view.setUint32(24, manifest.sampleRate, true);
  view.setUint32(28, manifest.sampleRate * CHANNELS * 4, true); view.setUint16(32, CHANNELS * 4, true); view.setUint16(34, 32, true);
  ascii(header, 36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, manifest.timelineFrames, true);
  ascii(header, 48, 'data'); view.setUint32(52, dataBytes, true);
  return { header, suffix, dataBytes, byteLength };
}

// The capture source is private and preallocated. Every consumer receives bounded
// copies; discarding an artifact waits for its outstanding source readers.
function captureArtifact({ storage, manifest, storageLease, ownerId }) {
  const layout = createPcmCaptureWavLayout(manifest);
  let readers = 0, retired = false, released = false, releaseError = null;
  const release = () => {
    if (!retired || readers || released || releaseError) return;
    try { storageLease.release(); released = true; storage = null; } catch (error) { releaseError = error; }
  };
  const artifact = prepareReplayableExportArtifact({
    immutableSourceRef: ownerId, formatVersion: manifest.schema, mediaType: 'audio/wav', suggestedFilename: ownerId + '.wav',
    byteLength: layout.byteLength, maxDeliveryBytes: layout.byteLength, coverageLossReportRef: 'embedded-lmjs-capture-manifest',
    openChunks: async function* ({ signal }) {
      signal.throwIfAborted(); yield layout.header.slice();
      for (let offset = 0; offset < layout.dataBytes; offset += COPY_BYTES) {
        signal.throwIfAborted(); const count = Math.min(COPY_BYTES, layout.dataBytes - offset), bytes = new Uint8Array(count), view = new DataView(bytes.buffer);
        for (let at = 0; at < count; at += 4) view.setFloat32(at, storage[(offset + at) / 4], true);
        yield bytes;
      }
      signal.throwIfAborted(); yield layout.suffix.slice();
    }
  });
  artifact.onDiscard(() => { retired = true; release(); });
  return Object.freeze({ ...artifact, metadata: () => Object.freeze({ ...artifact.metadata(),
    pcmOwnership: released ? 'released' : releaseError ? 'failed-or-unknown' : retired ? 'waiting-for-readers' : 'retained' }),
  borrow() {
    if (readers) throw fail('A captured PCM delivery already owns this source.');
    const lease = artifact.borrow(); readers++;
    lease.settlement.then(() => { readers--; release(); });
    return lease;
  } });
}

export function createOwnedMasterCapture({ preview, resourceBudget, AudioWorkletNodeType = globalThis.AudioWorkletNode, onChange = () => {} } = {}) {
  if (!preview?.getAudioContext || !preview?.getState || !preview?.acquireMasterCaptureTap || !resourceBudget?.reserve ||
      !resourceBudget?.release || typeof onChange !== 'function') throw new TypeError('Master capture requires an owned browser master and shared storage admission.');
  const resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: 'master-pcm', maxReservations: 8 });
  const retirement = createProcgenRetirementScope(), uncertain = new Set(); let current = null, disposed = false, ownershipFault = false;
  const hasUnknownOwnership = () => ownershipFault || uncertain.size > 0 || resources.diagnostics().unreconciledReservations > 0;
  const state = () => Object.freeze({ state: current?.phase ?? (disposed ? 'disposed' : 'idle'), ownerId: current?.ownerId ?? null,
    sampleRate: current?.sampleRate ?? null, frames: current?.frames ?? 0, maxFrames: current?.maxFrames ?? 0,
    capturedFrames: current?.capturedFrames ?? 0, manifest: current?.manifest ?? null, artifact: current?.artifact ?? null,
    error: current?.error?.message ?? null, nativeRetirement: current?.nativeReceipt?.outcome ?? null,
    unresolvedOwnership: hasUnknownOwnership(), resourceAccounting: resources.diagnostics() });
  const report = () => { try { onChange(state()); } catch { /* Presentation cannot change capture ownership. */ } };
  const checkContext = operation => !disposed && preview.getAudioContext() === operation.context &&
    preview.getState().contextEpoch === operation.contextEpoch && operation.context.sampleRate === operation.sampleRate && operation.context.state === 'running';
  const retireNative = (operation, terminalAcknowledged) => {
    if (operation.nativeReceipt) return operation.nativeReceipt;
    const receipt = createProcgenRetirementScope().retire([
      { name: 'master-tap', run: () => operation.tap?.release() },
      { name: 'capture-node', run: () => operation.node?.disconnect() },
      { name: 'silent-pull', run: () => operation.pull?.disconnect() },
      { name: 'capture-port', run: () => { if (operation.node) { operation.node.port.onmessage = null; operation.node.port.onmessageerror = null; operation.node.port.close(); } } }
      , { name: 'processor-retirement', run: () => {
        if (operation.node && !terminalAcknowledged && operation.context.state !== 'closed') throw fail('Capture processor termination has no acknowledgment.');
      } }
    ]);
    operation.nativeReceipt = receipt;
    try { releaseAudioResourceAfterRetirement(operation.nativeLease, receipt); }
    catch (error) { uncertain.add(operation); operation.error ||= error; }
    if (receipt.outcome !== 'complete') uncertain.add(operation);
    if (operation.nativeLease.releaseState() === 'failed-or-unknown' && operation.context.state !== 'closed') {
      operation.onClosed = () => {
        if (operation.context.state !== 'closed') return;
        resources.confirmClosedContext();
        if (operation.nativeLease.releaseState() === 'released') uncertain.delete(operation);
        operation.context.removeEventListener?.('statechange', operation.onClosed); report();
      };
      operation.context.addEventListener?.('statechange', operation.onClosed);
    } else if (operation.context.state === 'closed') {
      resources.confirmClosedContext(); if (operation.nativeLease.releaseState() === 'released') uncertain.delete(operation);
    }
    return receipt;
  };
  const finish = (operation, terminal = null, reason = null) => {
    if (operation.finished) return; operation.finished = true;
    clearTimeout(operation.timer); clearTimeout(operation.watchdog); clearTimeout(operation.readyTimer);
    try { operation.unsubscribeProvenance?.(); } catch (error) { operation.error ||= error; }
    operation.unsubscribeProvenance = null;
    if (operation.onContextState) operation.context.removeEventListener?.('statechange', operation.onContextState);
    let verified = false, gaps = [], end = operation.lastFrame ?? operation.sourceStartFrame;
    if (terminal) {
      try {
        const clock = terminal.clockDiscontinuity;
        if (clock != null && (terminal.reason !== 'noncontiguous-render-clock' || Object.keys(clock).length !== 3 || !integer(clock.expectedFrame) || clock.expectedFrame !== terminal.lastFrame || !integer(clock.actualFrame) || !integer(clock.frames) ||
            clock.frames < 1 || clock.frames > 8192 || clock.expectedFrame === clock.actualFrame)) throw fail('Invalid capture render-clock receipt.');
        if (terminal.sourceStartFrame !== operation.sourceStartFrame && !(operation.sourceStartFrame == null && terminal.capturedFrames === 0) ||
            !integer(terminal.lastFrame) || terminal.sourceStartFrame != null && (!integer(terminal.sourceStartFrame) || terminal.lastFrame < terminal.sourceStartFrame ||
            terminal.lastFrame - terminal.sourceStartFrame > operation.maxFrames) || terminal.capturedFrames !== operation.capturedFrames ||
            terminal.lastSequence !== operation.sequence || !integer(terminal.droppedFrames) || !integer(terminal.gapCount) || terminal.gapCount > MAX_GAPS ||
            !(terminal.gaps instanceof Float64Array) || terminal.gaps.length !== MAX_GAPS * 3 || !integer(terminal.zeroChannelFrames) || !integer(terminal.monoFrames) ||
            terminal.zeroChannelFrames + terminal.monoFrames > terminal.capturedFrames || typeof terminal.reason !== 'string' || terminal.reason.length > 80) throw fail('Invalid capture terminal receipt.');
        if (operation.sourceStartFrame == null) operation.sourceStartFrame = terminal.sourceStartFrame;
        end = terminal.lastFrame; let dropped = 0, previous = operation.sourceStartFrame;
        for (let index = 0; index < terminal.gapCount; index++) {
          const at = index * 3, first = terminal.gaps[at], last = terminal.gaps[at + 1], code = terminal.gaps[at + 2];
          if (!integer(first) || !integer(last) || first < previous || last <= first || last > end || ![1, 2].includes(code)) throw fail('Invalid capture gap interval.');
          gaps.push({ firstFrame: first, lastFrame: last, reason: code === 1 ? 'transfer-buffer-pressure' : 'missing-input' }); dropped += last - first; previous = last;
        }
        if (terminal.overflowFirstFrame != null || terminal.overflowLastFrame != null || dropped !== terminal.droppedFrames ||
            end - (operation.sourceStartFrame ?? end) !== terminal.capturedFrames + dropped || end < (operation.lastFrame ?? end)) throw fail('Capture coverage is incomplete or its gap index overflowed.');
        const expected = operation.packetGaps.slice(), trailing = operation.lastFrame ?? operation.sourceStartFrame;
        if (trailing != null && trailing < end) expected.push({ firstFrame: trailing, lastFrame: end });
        let gapIndex = 0;
        for (const interval of expected) {
          let cursor = interval.firstFrame;
          while (gapIndex < gaps.length && gaps[gapIndex].firstFrame === cursor && gaps[gapIndex].lastFrame <= interval.lastFrame) cursor = gaps[gapIndex++].lastFrame;
          if (cursor !== interval.lastFrame) throw fail('Capture gaps disagree with received PCM coverage.');
        }
        if (gapIndex !== gaps.length) throw fail('Capture gaps overlap received PCM.');
        verified = true; reason = terminal.reason;
      } catch (error) { operation.error = error; reason ||= 'invalid-terminal-receipt'; }
    }
    retireNative(operation, verified);
    if (!verified) {
      // Only received, validated packets have known boundaries after interruption.
      end = operation.lastFrame ?? operation.sourceStartFrame;
      gaps = operation.packetGaps;
    }
    const timelineFrames = operation.sourceStartFrame == null || end == null ? 0 : Math.max(0, end - operation.sourceStartFrame);
    operation.frames = timelineFrames;
    const complete = verified && !gaps.length && ['user-stop', 'capacity-reached'].includes(reason) && !operation.error;
    const provenance = operation.provenance.finish({ sourceStartFrame: operation.sourceStartFrame, endFrameExclusive: end,
      terminationReason: reason || operation.stopRequested || 'capture-interrupted' });
    operation.manifest = freezeData({ schema: 'lemmings-master-pcm/v1', ownerId: operation.ownerId, contextEpoch: operation.contextEpoch,
      tap: 'post-protection-shared-browser-master', includesCurrentMasterOwnersAndAuditions: true, separateCueBusExcluded: true,
      rehearsalOnMasterIncluded: true, monitorAtStart: operation.monitorAtStart,
      provenance, segments: provenance.segments,
      externalMidiAudio: false, microphone: false, acousticEvidence: false, sampleRate: operation.sampleRate, channels: CHANNELS, format: 'float32-le',
      intendedStartFrame: operation.targetStartFrame, sourceStartFrame: operation.sourceStartFrame, endFrameExclusive: end,
      timelineFrames, capturedFrames: operation.capturedFrames, state: complete ? 'Ready' : timelineFrames ? 'Partial' : 'Failed',
      stopReason: reason || operation.stopRequested || 'capture-interrupted', requestedStopReason: operation.stopRequested ?? null, terminalAcknowledged: verified, gaps,
      clockDiscontinuity: verified ? terminal.clockDiscontinuity || null : null,
      missingFramePolicy: 'explicit-zero-placeholders-preserve-source-time', trailingCoverage: verified ? 'verified-through-end-frame' : 'unknown-after-last-received-frame',
      zeroChannelFrames: verified ? terminal.zeroChannelFrames : null, monoFrames: verified ? terminal.monoFrames : null,
      resampling: false, normalization: false, digestState: 'omitted-streaming', nativeRetirement: operation.nativeReceipt.outcome });
    operation.phase = timelineFrames ? complete ? 'ready' : 'partial' : 'failed';
    try {
      if (timelineFrames) operation.artifact = captureArtifact({ storage: operation.storage, manifest: operation.manifest, storageLease: operation.storageLease, ownerId: operation.ownerId });
      else operation.storageLease.release();
      operation.storage = null;
    } catch (error) { operation.error = error; operation.phase = 'failed'; ownershipFault = true; }
    operation.complete(operation.manifest); report();
  };
  const stop = (reason = 'user-stop') => {
    const operation = current;
    if (!operation) return Promise.resolve(null);
    if (operation.finished) return operation.completion;
    if (!['user-stop', 'panic', 'context-interrupted', 'owner-retired', 'provenance-unavailable'].includes(reason)) return Promise.reject(fail('Invalid capture stop reason.'));
    operation.stopRequested ||= reason;
    if (!operation.node) { report(); return operation.completion; }
    if (operation.phase !== 'stopping') {
      operation.phase = 'stopping';
      try { operation.node.port.postMessage({ type: 'stop', protocol: PROTOCOL, epoch: operation.ownerId,
        frame: Math.ceil(operation.context.currentTime * operation.sampleRate), reason: operation.stopRequested }); }
      catch (error) { operation.error = error; finish(operation, null, 'capture-port-fault'); }
      if (!operation.finished) operation.timer = setTimeout(() => finish(operation, null, 'stop-acknowledgment-timeout'), 2000);
    }
    if (operation.context.state !== 'running') finish(operation, null, reason);
    report(); return operation.completion;
  };
  const start = async ({ seconds = 60, includeCue = false } = {}) => {
    if (disposed || hasUnknownOwnership() || current && !current.finished || current?.artifact?.metadata().retained ||
        includeCue !== false || typeof AudioWorkletNodeType !== 'function' || !Number.isFinite(seconds) || seconds <= 0 || seconds > 300) throw fail('Master capture is unavailable; finish and discard the previous capture first. Separate cue inclusion is unsupported.');
    const context = preview.getAudioContext(), source = preview.getState(), sampleRate = context?.sampleRate;
    if (!source.enabled || context?.state !== 'running' || !context.audioWorklet?.addModule || !integer(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw fail('Enable browser audio before starting capture.');
    const maxFrames = Math.ceil(seconds * sampleRate), ownerId = 'master-pcm-' + (++captureSequence), contextEpoch = source.contextEpoch;
    const nativeLease = resources.reserve({ kind: 'pcm-capture-runtime', owner: ownerId, generation: contextEpoch,
      bytes: 2 * CHUNK_FRAMES * CHANNELS * 4 + MAX_GAPS * 3 * 8, estimateBytes: 256 * 1024 });
    let storageLease;
    try { storageLease = resources.reserve({ kind: 'captured-pcm-f32', owner: ownerId, generation: contextEpoch, bytes: maxFrames * CHANNELS * 4 + 512 * 1024 }); }
    catch (error) { try { nativeLease.release(); } catch { ownershipFault = true; } throw error; }
    const operation = { ownerId, context, contextEpoch, sampleRate, maxFrames, nativeLease, storageLease, storage: null, phase: 'preparing',
      frames: 0, capturedFrames: 0, sequence: 0, tokens: new Uint32Array(2), sourceStartFrame: null, lastFrame: null, packetGaps: [], finished: false,
      complete: null, completion: null, targetStartFrame: 0, error: null, monitorAtStart: source.monitorRoute || null };
    operation.completion = new Promise(resolve => { operation.complete = resolve; }); current = operation; report();
    operation.provenance = createMasterCaptureProvenance({ contextEpoch, sampleRate });
    try {
      const observeProvenance = snapshot => {
        if (operation.finished || operation.stopRequested) return;
        if (!checkContext(operation)) { void stop('context-interrupted'); return; }
        try { operation.provenance.observe(snapshot); }
        catch (error) { operation.error ||= error; void stop('provenance-unavailable'); }
      };
      if (preview.getCaptureProvenance && preview.subscribeCaptureProvenance) {
        operation.unsubscribeProvenance = preview.subscribeCaptureProvenance(observeProvenance);
        observeProvenance(preview.getCaptureProvenance());
      }
      operation.storage = new Float32Array(maxFrames * CHANNELS);
      // addModule is an accepted native operation: its ownership survives stop.
      await context.audioWorklet.addModule(new URL('./worklet/OwnedPcmCaptureProcessor.js', import.meta.url));
      if (!checkContext(operation) || operation.stopRequested) { finish(operation, null, operation.stopRequested || 'context-interrupted'); return state(); }
      operation.targetStartFrame = Math.ceil(context.currentTime * sampleRate);
      operation.node = new AudioWorkletNodeType(context, 'lemmings-owned-pcm-capture-v1', { numberOfInputs: 1, numberOfOutputs: 1,
        outputChannelCount: [CHANNELS], channelCount: CHANNELS, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        processorOptions: { protocol: PROTOCOL, epoch: ownerId, maxFrames, targetStartFrame: operation.targetStartFrame, chunkFrames: CHUNK_FRAMES } });
      operation.node.port.onmessage = event => {
        const message = event.data; if (operation.finished) return;
        try {
          if (message?.protocol !== PROTOCOL || message.epoch !== ownerId) throw fail('Capture message belongs to another owner.');
          if (preview.getAudioContext() !== context || preview.getState().contextEpoch !== contextEpoch || context.sampleRate !== sampleRate) { finish(operation, null, 'context-interrupted'); return; }
          if (message.type === 'ready') {
            if (operation.ready || message.sampleRate !== sampleRate || message.channels !== CHANNELS || message.chunkFrames !== CHUNK_FRAMES || message.pool !== 2 ||
                message.targetStartFrame !== operation.targetStartFrame) throw fail('Invalid capture readiness receipt.');
            operation.ready = true; clearTimeout(operation.readyTimer); operation.phase = operation.stopRequested ? 'stopping' : 'recording'; report(); return;
          }
          if (!operation.ready) throw fail('Capture data preceded readiness.');
          if (message.type === 'stopped') { finish(operation, message); return; }
          if (message.type !== 'pcm' || !integer(message.index) || message.index > 1 || !integer(message.token) || message.token > 0xffffffff || message.token !== operation.tokens[message.index] + 1 ||
              message.sequence !== operation.sequence + 1 || !integer(message.sourceStartFrame) || message.sourceStartFrame < operation.targetStartFrame ||
              operation.sourceStartFrame != null && message.sourceStartFrame !== operation.sourceStartFrame || !integer(message.firstFrame) ||
              !integer(message.frameCount) || message.frameCount < 1 || message.frameCount > CHUNK_FRAMES ||
              message.firstFrame < (operation.lastFrame ?? message.sourceStartFrame) || message.firstFrame + message.frameCount - message.sourceStartFrame > maxFrames ||
              !(message.buffer instanceof ArrayBuffer) || message.buffer.byteLength !== CHUNK_FRAMES * CHANNELS * 4) throw fail('Invalid or out-of-order PCM capture packet.');
          const samples = new Float32Array(message.buffer), count = message.frameCount * CHANNELS;
          for (let index = 0; index < count; index++) if (!Number.isFinite(samples[index])) throw fail('Nonfinite captured PCM.');
          operation.sourceStartFrame ??= message.sourceStartFrame;
          const previous = operation.lastFrame ?? operation.sourceStartFrame;
          if (message.firstFrame > previous) {
            if (operation.packetGaps.length === MAX_GAPS) throw fail('Capture packet gap capacity reached.');
            operation.packetGaps.push({ firstFrame: previous, lastFrame: message.firstFrame, reason: 'unreceived-source-frames' });
          }
          operation.storage.set(samples.subarray(0, count), (message.firstFrame - operation.sourceStartFrame) * CHANNELS);
          operation.lastFrame = message.firstFrame + message.frameCount; operation.frames = operation.lastFrame - operation.sourceStartFrame;
          operation.capturedFrames += message.frameCount; operation.sequence = message.sequence; operation.tokens[message.index] = message.token;
          operation.node.port.postMessage({ type: 'return-buffer', protocol: PROTOCOL, epoch: ownerId, index: message.index, token: message.token, buffer: message.buffer }, [message.buffer]);
          if (operation.sequence % 16 === 0) report();
        } catch (error) { operation.error = error; finish(operation, null, 'capture-protocol-fault'); }
      };
      operation.node.port.onmessageerror = () => finish(operation, null, 'capture-message-error');
      operation.node.onprocessorerror = () => finish(operation, null, 'capture-processor-error');
      operation.pull = context.createGain(); operation.pull.gain.value = 0;
      operation.node.connect(operation.pull); operation.pull.connect(context.destination);
      operation.tap = preview.acquireMasterCaptureTap({ context, contextEpoch, node: operation.node, onRetire: stop });
      operation.readyTimer = setTimeout(() => finish(operation, null, 'capture-readiness-timeout'), 3000);
      operation.onContextState = () => { if (context.state !== 'running') void stop('context-interrupted'); };
      context.addEventListener?.('statechange', operation.onContextState);
      operation.watchdog = setTimeout(() => { if (!operation.finished) void stop('context-interrupted'); }, seconds * 1000 + 5000);
      report(); return state();
    } catch (error) { operation.error = error; finish(operation, null, 'capture-start-failed'); throw error; }
  };
  return Object.freeze({ start, stop, state, discard() {
    if (current && !current.finished) throw fail('Stop capture before discarding its PCM.');
    current?.artifact?.discard(); report(); return state();
  }, dispose() {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true;
    const pending = stop('owner-retired');
    return retirement.retire([{ name: 'capture-finalization', run: () => pending },
      { name: 'ownership', run: async () => { await pending; if (hasUnknownOwnership()) throw fail('Capture native ownership remains unresolved.'); } }]);
  } });
}
