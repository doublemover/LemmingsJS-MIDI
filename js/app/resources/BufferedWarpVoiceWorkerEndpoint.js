import { createBackgroundSnapshotReceiver } from './BackgroundSnapshotPages.js';
import { prepareOwnedStretchCore } from './OwnedStretchCore.js';
import { prepareBufferedWarpHistory } from './BufferedWarpHistory.js';
import { createBufferedWarpVoice } from './BufferedWarpVoice.js';
import { validateBufferedWarpPlan } from '../../midi/content/BufferedWarpPlan.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { createResourceBudget } from './ResourceBudget.js';
import { createOwnedResourceReservation } from './OwnedResourceReservation.js';
import { sealStretchImageMaterial } from '../midi-ui/StretchImageMaterial.js';
import { instantiateStretchInitialImage } from './RestoredStretchCore.js';

export const BUFFERED_WARP_WORKER_PROTOCOL = 'lemmings-buffered-warp-worker/v1';
const failure = message => Object.assign(new Error(message), { code: 'streaming-warp-unavailable' });
export function createBufferedWarpVoiceWorkerEndpoint({ postMessage, close, timers = globalThis } = {}) {
  const budget = createResourceBudget(), controller = new AbortController();
  let identity = null, phase = 'new', receiver = null, workspace = null, core = null, image = null, history = null, voice = null, port = null,
    prepareWork = null, processing = null, timer = null, clockPending = null, pcmPending = null, stopPending = null, sequence = 0, inputSequence = 0, retiring = null;
  const envelope = (type, fields = {}) => ({ protocol: BUFFERED_WARP_WORKER_PROTOCOL, ...identity, type, ...fields });
  const send = (type, fields = {}) => postMessage(envelope(type, fields));
  const valid = value => value?.ownerId === identity?.ownerId && value.ownerEpoch === identity?.ownerEpoch;
  const fail = error => {
    if (phase === 'closed' || phase === 'retiring') return;
    phase = 'failed'; if (timer !== null) timers.clearTimeout(timer); timer = null;
    clockPending?.reject(error); pcmPending?.reject(error); clockPending = pcmPending = null;
    try { send('failed', { message: String(error.message || error).slice(0, 512), diagnostics: voice?.diagnostics() || null }); } catch {}
  };
  const waitFor = (kind, sendMessage, timeoutMs = 1500) => new Promise((resolve, reject) => {
    const row = { sequence: ++sequence, timer: null, resolve: value => { timers.clearTimeout(row.timer); resolve(value); }, reject: error => { timers.clearTimeout(row.timer); reject(error); } };
    if (kind === 'clock') { if (clockPending) throw failure('The processor clock observation remains pending.'); clockPending = row; }
    else if (kind === 'pcm') { if (pcmPending) throw failure('The PCM pool buffer remains leased.'); pcmPending = row; }
    else stopPending = row;
    row.timer = timers.setTimeout(() => row.reject(failure('The PCM processor did not acknowledge its bounded lease.')), timeoutMs);
    try { sendMessage(row.sequence); } catch (error) { row.reject(error); }
  });
  const readClock = () => waitFor('clock', requestId => port.postMessage(envelope('clock', { requestId })));
  const publish = chunk => waitFor('pcm', sequence => port.postMessage(envelope('pcm', { sequence, chunk }), [chunk.left.buffer, chunk.right.buffer]));
  const schedule = () => { if (phase === 'bound' && timer === null && !processing) timer = timers.setTimeout(pump, 4); };
  const pump = () => {
    timer = null; if (phase !== 'bound' || processing) return;
    processing = (async () => {
      const clock = await readClock(); if (phase !== 'bound') return;
      if (clock.failure || clock.sampleRate !== history.plan.outputRate) throw failure(clock.failure || 'The PCM processor changed its prepared sample rate.');
      let free = Math.min(16, clock.freeChunks), horizon = clock.currentFrame + 2048;
      while (free-- > 0 && phase === 'bound' && voice.diagnostics().outputFrame < horizon) {
        await voice.processChunk({ signal: controller.signal });
        const state = voice.diagnostics();
        if (state.schedule.ended && !state.tailRemaining) { phase = 'ended'; port.postMessage(envelope('end', { outputFrame: state.outputFrame })); send('ended', { diagnostics: state }); break; }
      }
    })().catch(fail).finally(() => { processing = null; schedule(); });
  };
  const retire = () => {
    if (retiring) return retiring; phase = 'retiring'; controller.abort(); if (timer !== null) timers.clearTimeout(timer); timer = null;
    retiring = (async () => {
      if (prepareWork) await Promise.allSettled([prepareWork]);
      if (port) await waitFor('stop', () => port.postMessage(envelope('stop')));
      if (processing) await processing;
      voice?.dispose({ producerRetired: true }); history?.dispose(); core?.dispose(); image?.dispose(); receiver?.dispose(); port?.close(); workspace?.release();
      phase = 'closed'; send('retired', { outcome: 'complete' }); close();
    })().catch(error => { phase = 'closed'; send('retired', { outcome: 'unknown', message: String(error.message).slice(0, 512) }); close(); }); return retiring;
  };
  return Object.freeze({ fail, receive: async request => {
    try {
      if (phase === 'closed' || phase === 'retiring') return;
      if (phase === 'new') {
        if (request?.protocol !== BUFFERED_WARP_WORKER_PROTOCOL || request.type !== 'prepare-start' || typeof request.ownerId !== 'string' || !request.ownerId || request.ownerId.length > 128 ||
            !Number.isSafeInteger(request.ownerEpoch) || request.ownerEpoch < 1 || request.requiredIdentity?.activeExecution !== 'bound' || !compareActiveExecutionIdentity(request.requiredIdentity, 'browser-background-jobs').matched || !request.port)
          throw failure('Streaming warp requires its exact immutable build and independently owned PCM consumer port.');
        identity = { ownerId: request.ownerId, ownerEpoch: request.ownerEpoch }; port = request.port;
        port.onmessage = event => {
          const value = event.data; if (!valid(value)) return;
          if (value.type === 'clock' && clockPending?.sequence === value.requestId) { const row = clockPending; clockPending = null; row.resolve(value); }
          else if (value.type === 'pcm-ack' && pcmPending?.sequence === value.sequence) { const row = pcmPending; pcmPending = null; row.resolve(value); }
          else if (value.type === 'source-retired' && stopPending) { const row = stopPending; stopPending = null; value.outcome === 'complete' ? row.resolve(value) : row.reject(failure('The processor source retirement remains unknown.')); }
          else fail(failure('The PCM consumer acknowledgment does not own its pending source request.'));
        }; port.onmessageerror = () => fail(failure('The PCM consumer response could not be decoded.')); port.start();
        workspace = createOwnedResourceReservation({ budget, owner: 'streaming-warp-worker', generation: identity.ownerEpoch, kind: 'core-source-copy-preparation-and-streaming-overlap', category: 'candidate', bytes: 256 * 1048576 });
        receiver = createBackgroundSnapshotReceiver({ maxBytes: 64 * 1048576, maxNodes: 1000000, estimatedPeakBytes: 256 * 1048576, allowOwnedBinary: true, allowOwnedWasmModule: true }); phase = 'receiving'; send('input-ack', { sequence: 0 }); return;
      }
      if (!valid(request) || request.protocol !== BUFFERED_WARP_WORKER_PROTOCOL) throw failure('The warp request belongs to a different source execution.');
      if (request.type === 'dispose') return retire();
      if (phase === 'receiving') {
        if (request.type === 'prepare-page') { const receipt = receiver.push(request.packet); inputSequence = receipt.sequence; send('input-ack', { sequence: inputSequence }); return; }
        if (request.type !== 'prepare-end' || request.sequence !== inputSequence) throw failure('Finish the complete immutable warp preparation source.');
        let input = receiver.finish(request.sequence); receiver = null; phase = 'preparing';
        prepareWork = (async () => {
          const plan = validateBufferedWarpPlan(input.plan), blockFrames = plan.outputRate === 96000 ? 4096 : 2048;
          if (input.image) {
            const applicationBuildId = getActiveExecutionIdentity('browser-background-jobs').buildId;
            image = await sealStretchImageMaterial(input.image, { applicationBuildId, sampleRate: plan.outputRate, estimatedPeakBytes: 256 * 1048576, signal: controller.signal }); controller.signal.throwIfAborted();
            core = instantiateStretchInitialImage(image, { applicationBuildId, estimatedPeakBytes: 128 * 1048576 }); image.dispose(); image = null;
          } else core = await prepareOwnedStretchCore(input.wasmBytes, { sampleRate: plan.outputRate, blockFrames, intervalFrames: blockFrames / 4,
            randomSeed: input.randomSeed ?? 1, captureInitialImage: plan.algorithm.artifactHashes.length > 1, estimatedPeakBytes: 256 * 1048576, signal: controller.signal });
          controller.signal.throwIfAborted();
          history = await prepareBufferedWarpHistory({ plan, parentAssetHash: plan.assetHash, pcm: input.pcm, configuration: core.configuration,
            configurationHash: core.configurationHash, estimatedPeakBytes: 128 * 1048576, signal: controller.signal }); controller.signal.throwIfAborted(); input = null;
          phase = 'ready'; send('material-ready', { configuration: core.configuration, configurationHash: core.configurationHash, executionIdentity: getActiveExecutionIdentity('browser-background-jobs') });
        })(); await prepareWork; return;
      }
      if (request.type === 'bind' && phase === 'ready') {
        const clock = await readClock(); controller.signal.throwIfAborted();
        if (clock.failure || clock.sampleRate !== history.plan.outputRate || !request.identity || request.segment?.active !== true || request.segment.outputFrame !== request.onsetOutputFrame)
          throw failure('Bind one explicit canonical onset to the prepared-rate processor clock.');
        voice = createBufferedWarpVoice({ core, history, ...request.identity, onsetOutputFrame: request.onsetOutputFrame,
          preparedAtOutputFrame: clock.currentFrame, resourceBudget: budget, publish });
        const admission = voice.schedule(request.segment, request.identity); if (admission.status !== 'accepted') throw failure('The canonical onset identity was refused.');
        if (request.endOutputFrame != null) {
          if (!Number.isSafeInteger(request.endOutputFrame) || request.endOutputFrame <= request.onsetOutputFrame) throw failure('A declared finite gate must end after its fixed onset.');
          const end = voice.schedule({ outputFrame: request.endOutputFrame, active: false }, { ...request.identity, sequence: request.identity.sequence + 1 });
          if (end.status !== 'accepted') throw failure('The finite gate could not be admitted atomically with its onset.');
        }
        phase = 'bound'; send('response', { requestId: request.requestId, value: { admission, preparation: voice.preparation, clock } }); schedule(); return;
      }
      if (request.type === 'schedule' && phase === 'bound') { const value = voice.schedule(request.segment, request.identity); send('response', { requestId: request.requestId, value }); return; }
      if (request.type === 'cancel-from' && phase === 'bound') { const value = voice.cancelFrom(request.outputFrame, request.identity); send('response', { requestId: request.requestId, value }); return; }
      if (request.type === 'inspect') { send('response', { requestId: request.requestId, value: { phase, diagnostics: voice?.diagnostics() || null } }); return; }
      throw failure('The streaming source is not ready for this operation.');
    } catch (error) { fail(error); }
  } });
}
