import { createWarpSegmentQueue } from '../midi-ui/WarpSegmentQueue.js';
import { mapWarpSourceFrame, warpPreparationBoundary } from '../../midi/content/BufferedWarpPlan.js';
import { createOwnedResourceReservation } from './OwnedResourceReservation.js';

const fail = message => Object.assign(new Error('Buffered WarpVoice: ' + message), { code: 'buffered-warp-voice-unavailable' });
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function createBufferedWarpVoice({ core, history, voiceId, onsetId, generation, epoch, onsetOutputFrame,
  firstOutputFrame = onsetOutputFrame, preparedAtOutputFrame, resourceBudget, publish, capacity = 256 } = {}) {
  if (typeof document !== 'undefined' || typeof globalThis.registerProcessor === 'function') throw fail('Own this prepared source in a non-render processing worker.');
  if (!history?.plan || core?.configurationHash !== history.configurationHash || typeof publish !== 'function' ||
      !integer(firstOutputFrame) || !integer(preparedAtOutputFrame) || firstOutputFrame > onsetOutputFrame ||
      history.configuration.outputLatencyFrames !== core.configuration.outputLatencyFrames || core.configuration.bufferFrames < 128)
    throw fail('Use an independently owned core/history pair, exact output frame clocks and a bounded PCM publication owner.');
  const plan = history.plan, preparation = warpPreparationBoundary(plan, { preparedAtOutputFrame, targetOutputFrame: onsetOutputFrame });
  if (preparation.status !== 'prepared-in-domain') throw fail('The physical onset missed its declared preparation lead; the adapter will not retime it.');
  const queue = createWarpSegmentQueue({ plan, voiceId, onsetId, generation, epoch, onsetOutputFrame, capacity }),
    reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'buffered-warp:' + voiceId, generation, category: 'audio',
      kind: 'canonical-prefix-and-independent-render-cursor', bytes: 2 * 1048576 + capacity * 8192 });
  const lookahead = core.configuration.outputLatencyFrames, segments = [], scratchLeft = new Float32Array(128), scratchRight = new Float32Array(128);
  let outputLeft = new Float32Array(128), outputRight = new Float32Array(128);
  let anchor = null, outputFrame = firstOutputFrame, busy = false, disposed = false, fault = null, publication = null, begun = false,
    lastLoop = null, resets = 0, chunks = 0, bodyOutputFrames = 0, tailFrames = 0, tailRemaining = 0, latestReceipt = null;
  const check = () => { if (disposed || fault) throw fault || fail('The source execution retired.'); };
  const stateAt = frame => {
    let current = anchor;
    for (const segment of segments) { if (segment.outputFrame > frame) break; current = segment; }
    return mapWarpSourceFrame(plan, current, frame);
  };
  const resetAt = (state, frame) => {
    core.resetSpectralHistory(); lastLoop = state.loopIteration; resets++; tailRemaining = 0;
    latestReceipt = Object.freeze({ voiceId, onsetId, generation, epoch, outputFrame: frame, sourceFrame: state.sourceFrame,
      sourceFrameDomain: 'original-asset-rate', outputRate: plan.outputRate, sourceRate: plan.sourceRate,
      historyPolicy: 'reset-and-deterministic-preroll-from-selected-immutable-region', restoration: 'deterministicPreroll', acousticEvidence: false });
  };
  return Object.freeze({ plan, preparation, schedule: (segment, identity) => { check(); return queue.upsert(segment, identity); },
    cancelFrom: (frame, identity) => { check(); return queue.cancelFrom(frame, identity); },
    async processChunk({ frame = outputFrame, frames = 128, signal } = {}) {
      check(); signal?.throwIfAborted();
      if (busy || frame !== outputFrame || !integer(frames) || frames < 1 || frames > 128) throw fail('Process one monotonic, bounded owned output chunk at a time.');
      busy = true; let sent = false;
      try {
        const through = frame + frames - 1 + lookahead;
        if (!Number.isSafeInteger(through)) throw fail('The output frontier exceeds its exact frame domain.');
        publication = queue.prepareCommit(through);
        anchor ||= publication.initialState;
        segments.push(...publication.segments);
        if (segments.length > capacity * 2 + 2) throw fail('The committed lookahead inventory exceeds its declared source capacity.');
        const left = outputLeft, right = outputRight; left.fill(0); right.fill(0); let cursor = frame;
        while (cursor < frame + frames) {
          signal?.throwIfAborted(); const state = stateAt(cursor);
          let end = frame + frames;
          for (const segment of segments) if (segment.outputFrame > cursor) { end = Math.min(end, segment.outputFrame); break; }
          if (state.active && plan.loop) {
            const remaining = (plan.loop.endSourceFrame - state.sourceFrame) * plan.outputRate / plan.sourceRate / state.rateRatio;
            if (remaining > 0) end = Math.min(end, cursor + Math.max(1, Math.ceil(remaining)));
          }
          if (state.active && !plan.loop) {
            const remaining = (plan.sourceFrameRegion[1] - state.sourceFrame) * plan.outputRate / plan.sourceRate / state.rateRatio;
            end = Math.min(end, cursor + Math.max(1, Math.ceil(remaining)));
          }
          const count = end - cursor, offset = cursor - frame;
          if (state.active) {
            if (!begun || state.loopIteration !== lastLoop || segments.some(segment => segment.outputFrame === cursor && segment.historyPolicy === 'reset-and-deterministic-preroll')) resetAt(state, cursor);
            begun = true; tailRemaining = Math.ceil(core.configuration.inputLatencyFrames / state.rateRatio + core.configuration.outputLatencyFrames);
            const future = stateAt(cursor + lookahead);
            history.process(core, future.sourceFrame, state.rateRatio, state.pitchRatio, scratchLeft, scratchRight, 0, count, future.loopIteration);
            left.set(scratchLeft.subarray(0, count), offset); right.set(scratchRight.subarray(0, count), offset); bodyOutputFrames += count;
          } else if (begun && tailRemaining) {
            const tail = Math.min(count, tailRemaining); core.flush(scratchLeft, scratchRight, 0, tail);
            left.set(scratchLeft.subarray(0, tail), offset); right.set(scratchRight.subarray(0, tail), offset); tailRemaining -= tail; tailFrames += tail;
          }
          cursor = end;
        }
        const receipt = { schema: 'lemmings-buffered-warp-pcm-chunk/v1', voiceId, onsetId, generation, epoch, outputFrame: frame, frames,
          sampleRate: plan.outputRate, channels: 2, left, right, terminal: publication.finalLifecycle.ended && !tailRemaining, committedControlThroughOutputFrame: through,
          algorithmConfigurationHash: core.configurationHash, sourceAssetHash: plan.assetHash,
          inputLatencyFrames: core.configuration.inputLatencyFrames, outputLatencyFrames: lookahead, sourceMode: 'immutable-buffered-source',
          actualSourceCoordinate: stateAt(frame).sourceFrame, sourceFrameDomain: 'original-asset-rate',
          sourceBoundary: 'zero-outside-selected-region;loop-resets-explicit', qualification: 'streaming-worker-adapter;PCM-and-device-cost-qualification-pending' };
        signal?.throwIfAborted(); sent = true;
        const admitted = await publish(receipt); check();
        if (admitted === false || admitted?.accepted !== true) throw fail('The PCM consumer did not acknowledge its exact owned output chunk.');
        if (!left.byteLength || !right.byteLength) {
          const returned = admitted.returnedBuffers;
          if (!Array.isArray(returned) || returned.length !== 2 || returned.some(buffer => !(buffer instanceof ArrayBuffer) || buffer.byteLength !== 512) || returned[0] === returned[1]) throw fail('The transferred PCM pool buffers were not returned after the consumer copied its chunk.');
          outputLeft = new Float32Array(returned[0]); outputRight = new Float32Array(returned[1]);
        }
        queue.acknowledge(publication); publication = null; outputFrame += frames;
        anchor = stateAt(outputFrame); while (segments.length && segments[0].outputFrame <= outputFrame) segments.shift(); chunks++;
        return Object.freeze({ status: 'accepted', stage: 'pcm-consumer-admission', outputFrame: frame, frames, committedThroughOutputFrame: through,
          appliedFrame: admitted.appliedFrame ?? null, renderEvidence: admitted.evidence || 'consumer-admission-only', logicalOnsetsAdded: 0 });
      } catch (error) {
        fault = error;
        if (publication) { if (sent) queue.retainUnknown(publication); else queue.rejectUnpublished(publication); publication = null; }
        throw error;
      } finally { busy = false; }
    },
    diagnostics: () => Object.freeze({ voiceId, onsetId, generation, epoch, outputFrame, busy, disposed, fault: fault?.message || null,
      chunks, bodyOutputFrames, tailFrames, tailRemaining, historyResets: resets, committedLookaheadFrames: lookahead, retainedSegments: segments.length,
      schedule: queue.diagnostics(), latestReceipt, liveInput: 'unavailable;buffered-source-time-warp-only', restoration: 'canonical-segments-and-deterministic-preroll;no-arbitrary-held-heap-snapshot',
      coreAndSourceOwnership: 'dedicated-caller-leases;retire-after-producer-and-PCM-consumer-acknowledgment' }),
    dispose({ producerRetired = false } = {}) { if (disposed) return false; if (busy || !producerRetired) throw fail('Confirm processing and all PCM consumer leases retired before disposing this voice.');
      disposed = true; queue.invalidate(); segments.length = 0; anchor = null; reservation.release(); return true; }
  });
}
