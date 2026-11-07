import { validateBufferedWarpPlan, validateWarpSegment, mapWarpSourceFrame } from '../../midi/content/BufferedWarpPlan.js';
import { freezeData } from '../../core/CanonicalData.js';

const fail = message => { throw Object.assign(new Error('Warp queue: ' + message), { code: 'warp-queue-unavailable' }); };
const integer = value => Number.isSafeInteger(value) && value >= 0;

// Ephemeral renderer projection of the existing canonical automation. It owns
// neither a second performance journal nor a mutable backend schedule. A pending
// publication freezes its whole prefix until a known acknowledgment arrives.
export function createWarpSegmentQueue({ plan: raw, voiceId, onsetId, generation, epoch, onsetOutputFrame, capacity = 256 } = {}) {
  const plan = validateBufferedWarpPlan(raw);
  if (![voiceId, onsetId].every(value => typeof value === 'string' && value.length && value.length <= 256) || ![generation, onsetOutputFrame].every(integer) || !(integer(epoch) || typeof epoch === 'string' && epoch.length > 0 && epoch.length <= 128) || !Number.isSafeInteger(capacity) || capacity < 2 || capacity > 1024) fail('Choose exact source ownership, onset and bounded schedule capacity.');
  let anchor = freezeData({ outputFrame: 0, sourceFrame: plan.sourceFrameRegion[0], active: false, rateRatio: plan.rateRatio, pitchRatio: plan.pitchRatio, loopIteration: 0 }), frontier = -1, revision = 0, lastSequence = -1, publicationOrdinal = 0, pending = null, unknown = false, retired = false, begun = false, ended = false;
  const commands = [];
  const check = () => { if (!Number.isSafeInteger(revision + 1) || retired || unknown) fail('The source schedule is retired or its publication outcome is unknown.'); };
  const checkTarget = frame => { check(); if (!integer(frame) || frame <= frontier || pending && frame <= pending.throughOutputFrame) fail('The committed or pending prefix cannot be edited.'); };
  const resolve = (through, collect = false) => {
    let state = anchor, hasBegun = begun, hasEnded = ended; const segments = [];
    for (const command of commands) {
      if (command.outputFrame > through) break;
      if (command.active && (!hasBegun && command.outputFrame !== onsetOutputFrame || hasEnded)) fail('A later rate/pitch update cannot create or revive a missing physical onset.');
      if (command.active) hasBegun = true; else hasEnded = true;
      const mapped = mapWarpSourceFrame(plan, state, command.outputFrame);
      state = freezeData({ ...mapped, ...command, sourceFrame: command.outputFrame === onsetOutputFrame && command.active ? plan.sourceFrameRegion[0] : command.sourceFrame ?? mapped.sourceFrame, rateRatio: command.rateRatio ?? mapped.rateRatio, pitchRatio: command.pitchRatio ?? mapped.pitchRatio,
        loopIteration: command.sourceFrame === undefined ? mapped.loopIteration : 0, historyPolicy: command.sourceFrame === undefined ? mapped.historyPolicy : 'reset-and-deterministic-preroll' });
      if (collect) segments.push(state);
    }
    return { state: mapWarpSourceFrame(plan, state, through), segments, lifecycle: { begun: hasBegun, ended: hasEnded } };
  };
  return Object.freeze({
    upsert(rawSegment, identity) {
      check(); if (!identity || identity.voiceId !== voiceId || identity.onsetId !== onsetId || identity.generation !== generation || identity.epoch !== epoch) return Object.freeze({ status: 'stale-source', revision });
      if (!integer(identity.sequence)) fail('Canonical updates need a nonnegative command sequence.'); if (identity.sequence <= lastSequence) return Object.freeze({ status: 'stale-command', revision });
      const command = validateWarpSegment(rawSegment, plan); checkTarget(command.outputFrame);
      if (command.active && command.outputFrame < onsetOutputFrame || command.outputFrame <= onsetOutputFrame && command.sourceFrame !== undefined && command.sourceFrame !== plan.sourceFrameRegion[0]) fail('The fixed physical onset and declared region origin cannot be retimed or replaced by a seek.');
      const index = commands.findIndex(value => value.outputFrame >= command.outputFrame);
      if (index >= 0 && commands[index].outputFrame === command.outputFrame) commands[index] = command;
      else { if (commands.length >= capacity) fail('Canonical segment capacity is occupied.'); commands.splice(index < 0 ? commands.length : index, 0, command); }
      lastSequence = identity.sequence; revision++; return Object.freeze({ status: 'accepted', revision, outputFrame: command.outputFrame, replacedFutureSuffix: false });
    },
    cancelFrom(outputFrame, identity) {
      check(); if (!identity || identity.voiceId !== voiceId || identity.onsetId !== onsetId || identity.generation !== generation || identity.epoch !== epoch) return Object.freeze({ status: 'stale-source', revision });
      if (!integer(identity.sequence)) fail('Canonical updates need a nonnegative command sequence.'); if (identity.sequence <= lastSequence) return Object.freeze({ status: 'stale-command', revision });
      checkTarget(outputFrame); lastSequence = identity.sequence; const index = commands.findIndex(value => value.outputFrame >= outputFrame), removed = index < 0 ? 0 : commands.length - index; if (removed) { commands.length = index; revision++; } return Object.freeze({ status: 'accepted', revision, removed });
    },
    at(outputFrame) { check(); if (!integer(outputFrame) || outputFrame < anchor.outputFrame) fail('The requested source coordinate precedes the retained committed anchor.'); return resolve(outputFrame).state; },
    prepareCommit(throughOutputFrame) {
      check(); if (!Number.isSafeInteger(publicationOrdinal + 1) || pending || !integer(throughOutputFrame) || throughOutputFrame <= frontier) fail('Wait for the prior publication or advance the committed frontier.');
      const resolved = resolve(throughOutputFrame, true);
      pending = freezeData({ schema: 'lemmings-warp-committed-prefix/v1', voiceId, onsetId, generation, epoch, publication: ++publicationOrdinal, revision, afterOutputFrame: frontier, throughOutputFrame,
        inactiveUntilOutputFrame: onsetOutputFrame, initialState: anchor, segments: resolved.segments, finalState: resolved.state, finalLifecycle: resolved.lifecycle, backendPolicy: 'append-monotonic-prefix;never-forward-unsorted-mutable-wrapper-updates' }); return pending;
    },
    acknowledge(publication) {
      check(); if (publication !== pending || !pending) fail('Only the exact pending publication can advance this source.');
      frontier = pending.throughOutputFrame; anchor = pending.finalState; begun = pending.finalLifecycle.begun; ended = pending.finalLifecycle.ended; while (commands.length && commands[0].outputFrame <= frontier) commands.shift(); pending = null;
      return Object.freeze({ status: 'committed', frontier, revision });
    },
    rejectUnpublished(publication) { check(); if (publication !== pending || !pending) fail('Unknown publication identity.'); pending = null; return Object.freeze({ status: 'known-unpublished', frontier }); },
    retainUnknown(publication) { if (publication !== pending || !pending) fail('Unknown publication identity.'); unknown = true; return this.diagnostics(); },
    // The caller must retain any producer lease independently. Invalidating this
    // projection does not claim its old backend or submitted commands retired.
    invalidate() { retired = true; return this.diagnostics(); },
    diagnostics() { return Object.freeze({ voiceId, onsetId, generation, epoch, onsetOutputFrame, revision, lastSequence, frontier, pendingThroughOutputFrame: pending?.throughOutputFrame ?? null, commands: commands.length, capacity, unknownPublication: unknown, retired, begun, ended,
      restoration: 'rebuild-from-canonical-intents-and-deterministic-preroll', producerRetirement: 'owned-by-caller;not-established-by-clearing-this-projection' }); }
  });
}
