import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';

const MAX_OBSERVATIONS = 48, MAX_TEXT_BYTES = 65536;
const frame = value => Number.isSafeInteger(value) && value >= 0;

// These are host observations. They never establish a processor's applied frame.
export function createMasterCaptureProvenance({ contextEpoch, sampleRate } = {}) {
  const observations = [];
  let textBytes = 0, lastIdentity = null, lastFrame = null, finalized = false;
  const observe = snapshot => {
    if (finalized) return false;
    if (!snapshot || snapshot.contextEpoch !== contextEpoch || snapshot.sampleRate !== sampleRate ||
        !frame(snapshot.observedFrame) || lastFrame != null && snapshot.observedFrame < lastFrame) {
      throw new Error('Capture provenance changed frame domain.');
    }
    const { observedFrame, ...identity } = snapshot;
    const { text } = canonicalDataText(identity, { maxBytes: 8192, maxNodes: 256, domain: 'Capture provenance observation' });
    lastFrame = observedFrame;
    if (text === lastIdentity) return false;
    const bytes = text.length * 2 + 256;
    if (observations.length === MAX_OBSERVATIONS || textBytes + bytes + text.length * 2 > MAX_TEXT_BYTES) {
      throw new Error('Capture provenance capacity reached.');
    }
    observations.push(freezeData({ observedFrame, appliedFrame: null, evidence: 'host-observed-context-clock',
      ...JSON.parse(text) }));
    textBytes += bytes; lastIdentity = text;
    return true;
  };
  const finish = ({ sourceStartFrame, endFrameExclusive, terminationReason }) => {
    finalized = true;
    lastIdentity = null;
    const available = observations.length > 0;
    return freezeData({ schema: 'lemmings-master-capture-provenance/v1',
      status: available ? 'host-observed' : 'unavailable', complete: available && terminationReason !== 'provenance-unavailable', maximumObservations: MAX_OBSERVATIONS,
      maximumTextBytes: MAX_TEXT_BYTES, retainedTextBytes: textBytes,
      exactGraphApplicationFrames: false, graphRevisionHistory: observations,
      segments: frame(sourceStartFrame) && frame(endFrameExclusive) && endFrameExclusive > sourceStartFrame ? [{
        contextEpoch, sourceStartFrame, frameCount: endFrameExclusive - sourceStartFrame, sampleRate,
        layout: 'audioStereo', routeRevision: observations[0]?.routeRevision ?? null,
        scoreMapping: { kind: 'owner-scoped-host-observations', observationCount: observations.length,
          history: 'graphRevisionHistory', unscoredMasterOwnersAndAuditionsPossible: true,
          exactApplicationFrames: false }, terminationReason
      }] : [] });
  };
  return Object.freeze({ observe, finish });
}
