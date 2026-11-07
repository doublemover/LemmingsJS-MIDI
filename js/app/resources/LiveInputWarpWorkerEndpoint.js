import { createBackgroundSnapshotReceiver } from './BackgroundSnapshotPages.js';
import { prepareOwnedStretchCore } from './OwnedStretchCore.js';
import { instantiateStretchInitialImage } from './RestoredStretchCore.js';
import { sealStretchImageMaterial } from '../midi-ui/StretchImageMaterial.js';
import { acceptsWarpPitch } from '../../midi/content/BufferedWarpPlan.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';

export const LIVE_WARP_PROTOCOL = 'lemmings-live-warp-worker/v1';
const fail = message => Object.assign(new Error(message), { code: 'live-input-warp-unavailable' });
const natural = value => Number.isSafeInteger(value) && value >= 0;
export function createLiveInputWarpWorkerEndpoint({ postMessage, close, timers = globalThis } = {}) {
  const controller = new AbortController(), queue = [], controls = []; let identity = null, port = null, receiver = null, phase = 'new', preparation = null, processing = null, retirement = null,
    core = null, image = null, sampleRate = null, pipelineFrames = null, firstInputFrame = null, endInputFrame = null, receivedThrough = null, committedThrough = -1, outputFrame = null,
    outputLeft = new Float32Array(128), outputRight = new Float32Array(128), pcmPending = null, clockPending = null, requestSequence = 0, controlSequence = -1, chunks = 0, inputFrames = 0, flushedFrames = 0, stoppedInputZeroPaddingFrames = 0, lastClock = null;
  const envelope = (type, fields = {}) => ({ protocol: LIVE_WARP_PROTOCOL, ...identity, type, ...fields }), send = (type, fields = {}) => postMessage(envelope(type, fields));
  const check = () => { controller.signal.throwIfAborted(); if (phase !== 'running' && phase !== 'flushing') throw fail('The live input producer is no longer running.'); };
  const failed = error => { if (phase === 'retiring' || phase === 'closed') return; phase = 'failed'; pcmPending?.reject(error); clockPending?.reject(error); pcmPending = clockPending = null; send('failed', { message: String(error.message || error).slice(0, 512), committedThroughInputFrame: committedThrough }); };
  const pending = (kind, callback) => new Promise((resolve, reject) => {
    const sequence = ++requestSequence, timeout = timers.setTimeout(() => reject(fail('The owned live PCM transport acknowledgment expired.')), 1500), row = { sequence, resolve: value => { timers.clearTimeout(timeout); resolve(value); }, reject: error => { timers.clearTimeout(timeout); reject(error); } };
    if (kind === 'clock') { if (clockPending) throw fail('The prior processor clock lease is pending.'); clockPending = row; } else { if (pcmPending) throw fail('The prior output PCM buffer is pending.'); pcmPending = row; } callback(sequence);
  });
  const readClock = () => pending('clock', requestId => port.postMessage(envelope('clock', { requestId })));
  const returnInput = packet => port.postMessage(envelope('input-return', { slot: packet.slot, sequence: packet.sequence, leftBuffer: packet.left.buffer, rightBuffer: packet.right.buffer }), [packet.left.buffer, packet.right.buffer]);
  const publish = async (frames = 128, terminal = false) => {
    while (true) { check(); const clock = await readClock(); lastClock = clock; if (clock.failure || clock.sampleRate !== sampleRate || outputFrame < clock.currentFrame) throw fail(clock.failure || 'The positive live processing pipeline missed its actual output frame.');
      if (clock.freeChunks > 0 && outputFrame < clock.currentFrame + 2048) break; await new Promise(resolve => timers.setTimeout(resolve, 4)); }
    const receipt = await pending('pcm', sequence => port.postMessage(envelope('pcm', { sequence, chunk: { schema: 'lemmings-buffered-warp-pcm-chunk/v1', outputFrame, sampleRate, frames, terminal, left: outputLeft, right: outputRight,
      sourceMode: 'actual-live-input-only;rate-one', inputCommittedThroughFrame: committedThrough } }), [outputLeft.buffer, outputRight.buffer]));
    check(); if (receipt.accepted !== true || !Array.isArray(receipt.returnedBuffers) || receipt.returnedBuffers.length !== 2 || receipt.returnedBuffers.some(buffer => !(buffer instanceof ArrayBuffer) || buffer.byteLength !== 512) || receipt.returnedBuffers[0] === receipt.returnedBuffers[1]) throw fail(receipt.reason || 'The live output consumer refused its owned PCM.');
    outputLeft = new Float32Array(receipt.returnedBuffers[0]); outputRight = new Float32Array(receipt.returnedBuffers[1]); outputFrame += frames; chunks++;
  };
  const diagnostics = () => ({ phase, sourceMode: 'causal-live-input', rateRatio: 1, firstInputFrame, endInputFrame, receivedThroughInputFrame: receivedThrough, committedThroughInputFrame: committedThrough, queuedInputChunks: queue.length, queuedControls: controls.length,
    outputFrame, chunks, inputFrames, flushedFrames, stoppedInputZeroPaddingFrames, configuration: core?.configuration || null, configurationHash: core?.configurationHash || null, pipelineFrames,
    reportedAlgorithmLatencyFrames: core ? core.configuration.inputLatencyFrames + core.configuration.outputLatencyFrames : null,
    declaredSignalLatencyFrames: core ? pipelineFrames + core.configuration.inputLatencyFrames + core.configuration.outputLatencyFrames : null,
    latencyEvidence: 'transport-target-plus-core-report;impulse-and-device-measurement-separate', processorRenderedThroughOutputFrame: lastClock?.renderedThroughOutputFrame ?? null, restoration: 'semanticResume;complete-captured-input-history-required-for-qualified-preroll' });
  const pump = () => {
    if (processing || phase !== 'running' || !queue.length) return;
    processing = (async () => {
      while (queue.length && phase === 'running') {
        const packet = queue.shift(); committedThrough = packet.inputFrame + packet.frames - 1; let first = 0;
        while (first < packet.frames) {
          while (controls.length && controls[0].inputFrame <= packet.inputFrame + first) { const control = controls.shift(); core.setPitch(control.pitchRatio); send('control-applied', { sequence: control.sequence, inputFrame: packet.inputFrame + first, targetInputFrame: control.inputFrame, outputFrame: packet.inputFrame + first + pipelineFrames, evidence: 'core-parameter-call;effective-spectral-transition-and-device-output-separate' }); }
          const count = Math.min(packet.frames - first, controls.length ? Math.max(1, controls[0].inputFrame - packet.inputFrame - first) : packet.frames);
          core.process(packet.left, packet.right, first, count, outputLeft, outputRight, first, count); first += count;
        }
        inputFrames += packet.realInputFrames; stoppedInputZeroPaddingFrames += packet.frames - packet.realInputFrames; await publish(); returnInput(packet);
        if (packet.terminal) {
          phase = 'flushing'; const reported = core.configuration.inputLatencyFrames + core.configuration.outputLatencyFrames, tail = Math.max(128, Math.ceil(reported / 128) * 128);
          if (tail > sampleRate * 4 || tail > core.configuration.bufferFrames * 2) throw fail('The live flush exceeds its bounded reported algorithm history.');
          for (let left = tail; left > 0;) { check(); const count = Math.min(128, left); core.flush(outputLeft, outputRight, 0, count); await publish(count, left === count); flushedFrames += count; left -= count; }
          phase = 'ended'; send('ended', { diagnostics: diagnostics(), outputEndFrame: outputFrame }); break;
        }
      }
    })().catch(failed).finally(() => { processing = null; if (phase === 'running' && queue.length) pump(); });
  };
  const retire = () => retirement || (retirement = (async () => { phase = 'retiring'; controller.abort(); pcmPending?.reject(fail('Live input retired.')); clockPending?.reject(fail('Live input retired.')); pcmPending = clockPending = null;
    await Promise.allSettled([preparation, processing].filter(Boolean)); for (const packet of queue.splice(0)) { try { returnInput(packet); } catch {} } core?.dispose(); image?.dispose(); receiver?.dispose(); core = image = receiver = null; controls.length = 0; port?.close(); phase = 'closed'; send('retired', { outcome: 'complete' }); close(); })());
  const receiveInput = packet => {
    if (phase !== 'running' || packet.protocol !== LIVE_WARP_PROTOCOL || packet.ownerId !== identity.ownerId || packet.ownerEpoch !== identity.ownerEpoch || !natural(packet.slot) || packet.slot > 7 || !natural(packet.sequence) || !natural(packet.inputFrame) || packet.inputFrame !== (receivedThrough ?? firstInputFrame) || packet.frames !== 128 || !Number.isSafeInteger(packet.realInputFrames) || packet.realInputFrames < 1 || packet.realInputFrames > 128 || packet.inputFrame + packet.realInputFrames > endInputFrame || packet.terminal !== (packet.inputFrame + packet.frames >= endInputFrame) || !packet.terminal && packet.realInputFrames !== 128 || !(packet.left instanceof Float32Array) || !(packet.right instanceof Float32Array) || packet.left.length !== 128 || packet.right.length !== 128 || packet.left.buffer === packet.right.buffer || queue.length >= 8) throw fail('Actual input is discontinuous, stale or exceeds its fixed transport pool.');
    for (let frame = 0; frame < 128; frame++) if (!Number.isFinite(packet.left[frame]) || !Number.isFinite(packet.right[frame]) || Math.max(Math.abs(packet.left[frame]), Math.abs(packet.right[frame])) > 16 || frame >= packet.realInputFrames && (packet.left[frame] !== 0 || packet.right[frame] !== 0)) throw fail('Actual input or its explicitly stopped suffix exceeds the finite source policy.');
    receivedThrough = packet.inputFrame + packet.frames; queue.push(packet); pump();
  };
  return Object.freeze({ fail: failed, async receive(request) {
    try {
      if (phase === 'closed' || phase === 'retiring') return;
      if (phase === 'new') {
        if (request?.protocol !== LIVE_WARP_PROTOCOL || request.type !== 'prepare-start' || typeof request.ownerId !== 'string' || !request.ownerId || request.ownerId.length > 128 || !natural(request.ownerEpoch) || !request.port || !compareActiveExecutionIdentity(request.requiredIdentity, 'browser-background-jobs').matched) throw fail('A live processing worker requires its exact build and exclusively owned input/output port.');
        identity = { ownerId: request.ownerId, ownerEpoch: request.ownerEpoch }; port = request.port; port.onmessage = event => { const value = event.data; if (value?.ownerId !== identity.ownerId || value.ownerEpoch !== identity.ownerEpoch) return;
          try { if (value.type === 'live-input') receiveInput(value); else if (value.type === 'clock' && value.requestId === clockPending?.sequence) { const row = clockPending; clockPending = null; row.resolve(value); } else if (value.type === 'pcm-ack' && value.sequence === pcmPending?.sequence) { const row = pcmPending; pcmPending = null; row.resolve(value); } else throw fail('A live PCM acknowledgment has no current lease.'); } catch (error) { failed(error); } };
        port.onmessageerror = () => failed(fail('The direct live audio port could not decode its owned packet.')); port.start(); receiver = createBackgroundSnapshotReceiver({ maxBytes: 64 * 1048576, maxNodes: 1000000, estimatedPeakBytes: 256 * 1048576, allowOwnedBinary: true, allowOwnedWasmModule: true }); phase = 'receiving'; send('input-ack', { sequence: 0 }); return;
      }
      if (request.protocol !== LIVE_WARP_PROTOCOL || request.ownerId !== identity.ownerId || request.ownerEpoch !== identity.ownerEpoch) throw fail('The live input request has a stale owner.');
      if (request.type === 'dispose') return retire();
      if (phase === 'receiving') {
        if (request.type === 'prepare-page') { const value = receiver.push(request.packet); send('input-ack', { sequence: value.sequence }); return; }
        if (request.type !== 'prepare-end') throw fail('Complete the bounded live processing source.'); let input = receiver.finish(request.sequence); receiver = null; phase = 'preparing';
        preparation = (async () => {
          if (!input || Object.keys(input).some(key => !['sampleRate', 'rateRatio', 'pitchRatio', 'pipelineFrames', 'image', 'wasmBytes'].includes(key)) || ![44100, 48000, 96000].includes(input.sampleRate) || input.rateRatio !== 1 || !acceptsWarpPitch(input.pitchRatio) || !Number.isSafeInteger(input.pipelineFrames) || input.pipelineFrames < 256 || input.pipelineFrames > 1536 || input.pipelineFrames % 128) throw fail('Live input supports pitch shifting at rate one with a positive bounded 128-frame pipeline.');
          sampleRate = input.sampleRate; pipelineFrames = input.pipelineFrames;
          if (input.image) { image = await sealStretchImageMaterial(input.image, { applicationBuildId: getActiveExecutionIdentity('browser-background-jobs').buildId, sampleRate, estimatedPeakBytes: 256 * 1048576, signal: controller.signal }); core = instantiateStretchInitialImage(image, { applicationBuildId: getActiveExecutionIdentity('browser-background-jobs').buildId, estimatedPeakBytes: 128 * 1048576 }); image.dispose(); image = null; }
          else { const blockFrames = sampleRate === 96000 ? 4096 : 2048; core = await prepareOwnedStretchCore(input.wasmBytes, { sampleRate, blockFrames, intervalFrames: blockFrames / 4, randomSeed: 1, estimatedPeakBytes: 256 * 1048576, signal: controller.signal }); }
          controller.signal.throwIfAborted(); core.resetSpectralHistory(); core.setPitch(input.pitchRatio); input = null; phase = 'ready'; send('material-ready', { executionIdentity: getActiveExecutionIdentity('browser-background-jobs'), diagnostics: diagnostics() });
        })(); await preparation; return;
      }
      if (request.type === 'start' && phase === 'ready') { if (!natural(request.inputFrame) || request.inputFrame % 128 || !natural(request.endInputFrame) || request.endInputFrame <= request.inputFrame || request.endInputFrame > request.inputFrame + sampleRate * 30) throw fail('Choose an explicit future actual-input interval of at most thirty seconds.'); firstInputFrame = request.inputFrame; endInputFrame = request.endInputFrame; outputFrame = firstInputFrame + pipelineFrames; phase = 'running'; send('response', { requestId: request.requestId, value: { status: 'accepted', ...diagnostics() } }); return; }
      if (request.type === 'pitch' && phase === 'running') {
        if (!natural(request.sequence) || request.sequence <= controlSequence || !natural(request.inputFrame) || request.inputFrame <= committedThrough || request.inputFrame < firstInputFrame || request.inputFrame >= endInputFrame || !acceptsWarpPitch(request.pitchRatio) || controls.length >= 64) { send('response', { requestId: request.requestId, value: { status: 'rejected', reason: 'pitch-control-outside-uncommitted-live-input', committedThroughInputFrame: committedThrough } }); return; }
        const row = { inputFrame: request.inputFrame, pitchRatio: request.pitchRatio, sequence: request.sequence }, index = controls.findIndex(value => value.inputFrame >= row.inputFrame); if (index >= 0 && controls[index].inputFrame === row.inputFrame) controls[index] = row; else controls.splice(index < 0 ? controls.length : index, 0, row); controlSequence = request.sequence; send('response', { requestId: request.requestId, value: { status: 'accepted', stage: 'live-input-control-queued', targetInputFrame: row.inputFrame, sequence: row.sequence, committedThroughInputFrame: committedThrough } }); return;
      }
      if (request.type === 'inspect') { send('response', { requestId: request.requestId, value: diagnostics() }); return; }
      throw fail('The live input source is not ready for this operation.');
    } catch (error) { failed(error); }
  } });
}
