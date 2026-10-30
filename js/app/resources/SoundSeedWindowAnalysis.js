import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';
import { encodeOwnedAudioWav } from '../midi-ui/OwnedAudioWav.js';

export const SOUND_SEED_ANALYSIS_REVISION = 'owned-stereo-seed-window-v1';
const MAX_PCM = 15 * 1048576, MAX_METADATA = 262144;
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const fail = message => { throw Object.assign(new Error(message), { name: 'SoundSeedAnalysisError', code: 'sound-seed-window-unavailable' }); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

function sourceCoverage(origin, source, first, end) {
  if (origin.schema === 'lemmings-sound-seed/v1') {
    const prior = origin.coverage;
    if (!prior || !Array.isArray(prior.gaps) || prior.gaps.length > 256 || !['known-material', 'missing-source-region', 'partial-source;terminal-coverage-unverified'].includes(prior.status)) fail('The frozen source omitted its original material-coverage evidence.');
    const gaps = [];
    for (const gap of prior.gaps) {
      if (!integer(gap.firstFrame, 0) || !integer(gap.endFrame, gap.firstFrame + 1, source.sourceFrames) || typeof gap.reason !== 'string' || !gap.reason || gap.reason.length > 128) fail('The frozen source contains an invalid local missing-frame interval.');
      const from = Math.max(first, gap.firstFrame), to = Math.min(end, gap.endFrame);
      if (to > from) gaps.push({ firstFrame: from - first, endFrame: to - first, reason: gap.reason });
    }
    return { ...prior, status: gaps.length ? 'missing-source-region' : prior.status === 'missing-source-region' ? 'known-material' : prior.status, gaps, frameDomain: 'seed-local-output-frames', physicalEvidence: 'frozen-derived-material;original-coverage-retained' };
  }
  if (origin.schema !== 'lemmings-master-pcm/v1') return { status: 'known-material', originalState: 'complete-rendered-range', gaps: [], frameDomain: 'seed-local-output-frames',
    sourceTailTruncated: origin.tail?.truncated === true, physicalEvidence: 'new-render-from-covered-semantic-history;not-original-live-PCM' };
  if (!Array.isArray(origin.gaps) || origin.gaps.length > 256 || !integer(origin.sourceStartFrame, 0)) fail('The captured source omitted its bounded gap/frame inventory.');
  const gaps = [];
  for (const gap of origin.gaps) {
    const start = gap.firstFrame ?? gap.startFrame, finish = gap.lastFrame ?? gap.endFrame ?? gap.endFrameExclusive;
    if (!integer(start, 0) || !integer(finish, start + 1)) fail('The captured source has an invalid missing-frame interval.');
    const from = Math.max(first, start - origin.sourceStartFrame), to = Math.min(end, finish - origin.sourceStartFrame);
    if (to > from) gaps.push({ firstFrame: from - first, endFrame: to - first, reason: typeof gap.reason === 'string' ? gap.reason.slice(0, 128) : 'missing-capture-frames' });
  }
  return { status: gaps.length ? 'missing-source-region' : origin.terminalAcknowledged === true ? 'known-material' : 'partial-source;terminal-coverage-unverified',
    originalState: origin.state, gaps, frameDomain: 'seed-local-output-frames', sourceTailTruncated: false, physicalEvidence: 'protected-browser-master;all-original-master-owners;no-separated-cause-claim',
    originalTimelineFrames: source.sourceFrames };
}

export async function analyzeSoundSeedWindow(input, { signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {}, estimatedPeakBytes } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The selected sound-seed draft generation changed.'); };
  const { pcm, originBytes, source, firstFrame, endFrame, sampleRate, generation, fades = {} } = input || {};
  if (!input || Object.keys(input).some(key => !['pcm', 'originBytes', 'source', 'firstFrame', 'endFrame', 'sampleRate', 'generation', 'fades'].includes(key)) ||
      !(pcm instanceof Uint8Array) || !(pcm.buffer instanceof ArrayBuffer) || pcm.byteLength > MAX_PCM || !(originBytes instanceof Uint8Array) || originBytes.length > MAX_METADATA ||
      !source || !['LIVE CAPTURE', 'OFFLINE REVOICE', 'FROZEN SEED'].includes(source.originKind) || !integer(source.sourceFrames, 1) || source.sampleRate !== sampleRate || !integer(sampleRate, 8000, 192000) ||
      !integer(firstFrame, 0, source.sourceFrames - 1) || !integer(endFrame, firstFrame + 1, source.sourceFrames) || pcm.byteLength !== (endFrame - firstFrame) * 8 || !integer(generation, 1) ||
      !integer(estimatedPeakBytes, pcm.byteLength * 10 + 32 * 1048576, 512 * 1048576) || !fades || Object.getPrototypeOf(fades) !== Object.prototype || Object.keys(fades).some(key => !['inFrames', 'outFrames', 'law'].includes(key))) fail('Seed analysis requires one exact bounded owned stereo window and its source/frame metadata.');
  const frames = endFrame - firstFrame, fadeIn = fades.inFrames ?? 0, fadeOut = fades.outFrames ?? 0, law = fades.law ?? 'linear';
  if (!integer(fadeIn, 0, Math.min(4096, Math.floor(frames / 2))) || !integer(fadeOut, 0, Math.min(4096, Math.floor(frames / 2))) || !['linear', 'equal-power'].includes(law)) fail('Seed fades exceed the selected original frame region.');
  check(); let origin;
  try { origin = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(originBytes)); } catch { fail('Seed source origin is invalid UTF-8/JSON.'); }
  canonicalDataText(origin, { maxBytes: MAX_METADATA, maxNodes: 32768 });
  if (origin.schema !== source.formatVersion || (origin.timelineFrames ?? origin.frames) !== source.sourceFrames || origin.sampleRate !== sampleRate ||
      !['lemmings-master-pcm/v1', 'lemmings-causal-audio-render/v1', 'lemmings-sound-seed/v1'].includes(origin.schema)) fail('Seed origin annotation differs from its immutable source/frame inventory.');
  const coverage = sourceCoverage(origin, source, firstFrame, endFrame), blockFrames = 2 ** Math.max(0, Math.ceil(Math.log2(frames / 2048))), bins = Math.ceil(frames / blockFrames);
  const minMax = new Float32Array(bins * 4), output = new Uint8Array(pcm.byteLength), inputView = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength), outputView = new DataView(output.buffer);
  for (let bin = 0; bin < bins; bin++) { minMax[bin * 4] = minMax[bin * 4 + 2] = Infinity; minMax[bin * 4 + 1] = minMax[bin * 4 + 3] = -Infinity; }
  let rawPeak = 0, peak = 0, rawSquares = 0, squares = 0, clipping = 0, rawClipping = 0, lr = 0, ll = 0, rr = 0;
  for (let first = 0; first < frames; first += 16384) {
    check(); const end = Math.min(frames, first + 16384);
    for (let frame = first; frame < end; frame++) {
      let gain = Math.min(1, fadeIn ? frame / fadeIn : 1, fadeOut ? (frames - 1 - frame) / fadeOut : 1); if (law === 'equal-power') gain = Math.sin(Math.PI / 2 * gain);
      const bin = Math.floor(frame / blockFrames) * 4, l = inputView.getFloat32(frame * 8, true), r = inputView.getFloat32(frame * 8 + 4, true);
      if (!Number.isFinite(l) || !Number.isFinite(r) || Math.abs(l) > 16 || Math.abs(r) > 16) fail('The selected material contains nonfinite or unsupported-magnitude PCM.');
      lr += l * r; ll += l * l; rr += r * r;
      for (let channel = 0; channel < 2; channel++) {
        const value = channel ? r : l, at = bin + channel * 2, faded = Math.fround(value * gain);
        minMax[at] = Math.min(minMax[at], value); minMax[at + 1] = Math.max(minMax[at + 1], value);
        rawPeak = Math.max(rawPeak, Math.abs(value)); peak = Math.max(peak, Math.abs(faded)); rawSquares += value * value; squares += faded * faded;
        rawClipping += Number(Math.abs(value) > 1); clipping += Number(Math.abs(faded) > 1); outputView.setFloat32(frame * 8 + channel * 4, faded, true);
      }
    }
    onProgress({ phase: 'analyzing-immutable-seed-window', completedUnits: end, totalUnits: frames }); await yieldControl();
  }
  const levels = [{ blockFrames, bins, minMax }];
  while (levels[levels.length - 1].bins > 128) {
    const previous = levels[levels.length - 1], count = Math.ceil(previous.bins / 2), values = new Float32Array(count * 4);
    for (let bin = 0; bin < count; bin++) for (let channel = 0; channel < 2; channel++) {
      const a = bin * 8 + channel * 2, b = Math.min(previous.bins - 1, bin * 2 + 1) * 4 + channel * 2;
      values[bin * 4 + channel * 2] = Math.min(previous.minMax[a], previous.minMax[b]); values[bin * 4 + channel * 2 + 1] = Math.max(previous.minMax[a + 1], previous.minMax[b + 1]);
    }
    levels.push({ blockFrames: previous.blockFrames * 2, bins: count, minMax: values });
  }
  const crossingSuggestion = (from, to) => {
    let selected = null, energy = Infinity;
    for (let frame = Math.max(1, from); frame < Math.min(frames, to); frame++) {
      const l = inputView.getFloat32(frame * 8, true), r = inputView.getFloat32(frame * 8 + 4, true), oldL = inputView.getFloat32((frame - 1) * 8, true), oldR = inputView.getFloat32((frame - 1) * 8 + 4, true);
      const crosses = (a, b) => a !== b && (a <= 0 && b >= 0 || a >= 0 && b <= 0);
      if ((crosses(oldL, l) || crosses(oldR, r)) && Math.max(Math.abs(l), Math.abs(r)) < energy) { selected = frame; energy = Math.max(Math.abs(l), Math.abs(r)); }
    }
    return selected;
  };
  const zeroCrossings = { method: 'minimum-stereo-edge-amplitude-candidate-v1', inLocalFrame: crossingSuggestion(1, 129), outLocalFrame: crossingSuggestion(frames - 128, frames), suggestionOnly: true, searchedFramesPerEdge: Math.min(128, frames - 1) };
  check(); const rawPcmHash = await digest(pcm), pcmHash = await digest(output), parentManifestHash = await hashData(origin, { maxBytes: MAX_METADATA, maxNodes: 32768 }); check();
  const inherited = origin.schema === 'lemmings-sound-seed/v1' ? origin.ancestry : [];
  if (!Array.isArray(inherited) || inherited.length >= 16) fail('Nested sound-seed ancestry exceeds the admitted depth.');
  const ancestry = [...inherited, { originKind: source.originKind, immutableSourceRef: source.immutableSourceRef, completeParentArtifactHash: source.sourceDigest,
    parentManifestHash, parentFrameDomain: source.originalFrameDomain, parentSampleRate: sampleRate, firstFrame, endFrame, parentTimelineOriginFrame: source.parentTimelineOriginFrame,
    sourceTap: source.sourceTap, takeId: origin.takeId ?? null, takeRevision: origin.takeRevision ?? null, sourceCanonicalHash: origin.sourceCanonicalHash ?? null, sourcePatchReceipt: origin.schema === 'lemmings-causal-audio-render/v1' ? { definitionHash: origin.definitionHash ?? null, engineRequirement: origin.engineRequirement ?? null } : null,
    bakedEffects: origin.schema === 'lemmings-master-pcm/v1' ? 'all-original-master-effects-and-protection' : origin.effectGraph?.hash ?? origin.bakedEffects ?? 'none-declared',
    regeneration: 'requires-separately-retained-original-source;not-required-to-play-frozen-PCM' }];
  const manifest = freezeData({ schema: 'lemmings-sound-seed/v1', revision: SOUND_SEED_ANALYSIS_REVISION, frames, sampleRate, channels: 2, sampleFormat: 'ieee-float32-le', tap: 'frozen-source-region-with-explicit-fades',
    rawPcmHash, pcmHash, bakedEffects: origin.schema === 'lemmings-master-pcm/v1' ? 'all-original-master-effects-and-protection' : origin.effectGraph?.hash ?? origin.bakedEffects ?? 'none-declared', normalization: 'none', dither: 'none-float-output', fades: { inFrames: fadeIn, outFrames: fadeOut, law }, coverage, ancestry,
    statistics: { rawPeak, peak, rawRms: Math.sqrt(rawSquares / (frames * 2)), rms: Math.sqrt(squares / (frames * 2)), rawClippedSamples: rawClipping, clippedSamples: clipping,
      stereoCorrelation: ll > 0 && rr > 0 ? Math.max(-1, Math.min(1, lr / Math.sqrt(ll * rr))) : null, silence: rawPeak < 1e-8 },
    bakedCausePolicy: 'sample-transients-are-original-ancestry;each-new-trigger-retains-its-own-semantic-onset', physicalTakeEvidence: false,
    acousticReceipt: false, qualification: 'derived-PCM-and-source-annotation;not-a-listening-or-cause-separation-claim' });
  const bytes = encodeOwnedAudioWav(output, frames, sampleRate, manifest, { maxMetadataBytes: MAX_METADATA, maxMetadataNodes: 32768 }), assetHash = await digest(bytes); check();
  return { value: { bytes, manifest, assetHash, generation, waveform: { stage: 'raw-source-window-before-baked-fades', firstParentFrame: firstFrame, endParentFrame: endFrame, channels: 2, levels,
    zeroCrossings } }, inputBytes: pcm.byteLength + originBytes.byteLength, nodes: 2048,
  retainedBytes: bytes.byteLength + levels.reduce((sum, level) => sum + level.minMax.byteLength, 0) + 262144 };
}
