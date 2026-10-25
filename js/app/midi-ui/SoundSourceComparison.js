import { freezeData } from '../../core/CanonicalData.js';

export function planSoundSourceComparison(patch, pin, mode) {
  const ref = pin?.ref;
  if (!['original', 'region'].includes(mode) || !['worklet-granular', 'worklet-sample'].includes(patch?.engineId) || patch.engineId === 'worklet-sample' && mode !== 'original' || patch.sampleRefs?.length !== 1 || !pin?.isActive?.() ||
      ref?.kind !== 'sample' || !/^[a-f0-9]{64}$/.test(ref.contentHash) || ref.contentHash !== patch.sampleRefs[0].sha256 || ref.bytes !== patch.sampleRefs[0].bytes ||
      !Number.isSafeInteger(ref.frames) || ref.frames < 2 || !Number.isSafeInteger(ref.sourceSampleRate) || ref.sourceSampleRate < 8000 || ref.sourceSampleRate > 192000)
    throw new TypeError('Source comparison needs one active pinned granular or owned sample source.');
  const low = mode === 'region' ? patch.parameters.regionStart01 ?? 0 : 0, high = mode === 'region' ? patch.parameters.regionEnd01 ?? 1 : 1;
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 1 || low >= high) throw new TypeError('Invalid source comparison region.');
  const onsetFrame = Math.floor(low * ref.frames), requestedEndFrame = Math.ceil(high * ref.frames), endFrame = Math.min(requestedEndFrame, onsetFrame + 8 * ref.sourceSampleRate);
  if (onsetFrame < 0 || endFrame > ref.frames || endFrame - onsetFrame < 2) throw new TypeError('Source comparison region is empty.');
  const seconds = (endFrame - onsetFrame) / ref.sourceSampleRate, id = 'source-comparison.' + ref.contentHash.slice(0, 32);
  const region = { domain: 'source-frames', assetHash: ref.contentHash, onsetFrame, endFrame, rootCents: 6000, gain01: 1, playbackMode: 'forward', pitchRange: { minCents: 6000, maxCents: 6000 } };
  const parameters = { attackSeconds: 0.003, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.01, gain01: 1, pan01: 0 };
  return freezeData({ mode, region, seconds, releaseSeconds: parameters.releaseSeconds,
    source: { assetHash: ref.contentHash, sourceSampleRate: ref.sourceSampleRate, sourceFrames: ref.frames, onsetFrame, endFrame, requestedEndFrame,
      truncated: endFrame !== requestedEndFrame, maximumSeconds: 8, direction: 'forward', rateRatio: 1, effects: 'dry', mixGain01: 0.4 },
    resolution: { status: 'ready', patch: { id, revision: 1, engineId: 'native-sample', engineVersion: 1, parameters, sampleRefs: patch.sampleRefs,
      voicePolicy: { maxVoices: 1, steal: 'reject' }, mix: { gain01: 0.4, pan01: 0 } }, receipt: { patchId: id, revision: 1 } },
    fixture: { schema: 'lemmings-source-comparison/v1', id: 'dry-' + mode + '-source-v1', source: 'authored-source-comparison', physicalTakeEvidence: false, events: [
      { kind: 'begin', seconds: 0, pitchCents: 6000, velocity01: 1, expression: { pressure01: 1, pan01: 0 } }, { kind: 'end', seconds }
    ] }
  });
}
