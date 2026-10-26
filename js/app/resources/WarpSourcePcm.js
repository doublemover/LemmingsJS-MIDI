import { OwnedSampleReader } from '../midi-ui/worklet/OwnedSampleReader.js';
import { seedDigest, seedDerivedFailure } from './SoundSeedDerivedAudio.js';
import { freezeData } from '../../core/CanonicalData.js';

export const WARP_SOURCE_PCM_REVISION = 'owned-zero-boundary-prepared-rate-PCM-v1';

// Pure worker preparation. Each plane is private; no source cache backing buffer
// is detached, modified or used as scratch. The existing bandlimited reader owns
// the conversion equation instead of introducing another interpolation kernel.
export async function prepareWarpSourcePcm(source, { outputRate, bank, signal, current = () => true, yieldControl = async () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) seedDerivedFailure('The warp source region changed.'); }; check();
  if (!source || !Number.isSafeInteger(source.frames) || source.frames < 2 || source.frames > source.sampleRate * 8 || !Number.isSafeInteger(source.sampleRate) || source.sampleRate < 8000 || source.sampleRate > 192000 || !Number.isSafeInteger(source.firstFrame) || source.firstFrame < 0 || source.endFrame !== source.firstFrame + source.frames || typeof source.sample !== 'function' || ![44100, 48000, 96000].includes(outputRate)) seedDerivedFailure('Warp conversion requires the exact bounded original seed region and supported prepared rate.');
  if (Math.ceil(source.frames * outputRate / source.sampleRate) < 2) seedDerivedFailure('Select enough original material to retain at least two prepared-rate frames.');
  let planes = [new Float32Array(source.frames), new Float32Array(source.frames)];
  for (let first = 0; first < source.frames; first += 16384) {
    check(); for (let frame = first; frame < Math.min(source.frames, first + 16384); frame++) for (let channel = 0; channel < 2; channel++) { const sample = source.sample(frame, channel); if (!Number.isFinite(sample) || Math.abs(sample) > 16) seedDerivedFailure('The source exceeds its admitted finite magnitude.'); planes[channel][frame] = sample; }
    await yieldControl();
  }
  const passes = []; let sampleRate = source.sampleRate;
  if (sampleRate !== outputRate) {
    const reader = new OwnedSampleReader(bank);
    while (sampleRate !== outputRate) {
      // The existing reader's derivative domain is at most four. A staged
      // downsample keeps high-rate originals inside that already owned domain.
      const nextRate = sampleRate / outputRate > 4 ? Math.ceil(sampleRate / 2) : outputRate, derivative = sampleRate / nextRate, final = nextRate === outputRate,
        frames = final ? Math.ceil(source.frames * outputRate / source.sampleRate) : Math.ceil(planes[0].length * nextRate / sampleRate), next = [new Float32Array(frames), new Float32Array(frames)];
      for (let first = 0; first < frames; first += 8192) {
        check(); for (let frame = first; frame < Math.min(frames, first + 8192); frame++) { const position = frame * derivative;
          if (position >= planes[0].length) continue;
          if (!reader.read(planes[0], planes[1], position, derivative, 0, planes[0].length, 'zero') || Math.max(Math.abs(reader.leftSample), Math.abs(reader.rightSample)) > 16) seedDerivedFailure('Prepared-rate conversion exceeds the core input magnitude; no limiter or normalization was applied.');
          next[0][frame] = reader.leftSample; next[1][frame] = reader.rightSample;
        } await yieldControl();
      }
      passes.push({ sourceRate: sampleRate, outputRate: nextRate, inputFrames: planes[0].length, outputFrames: frames, derivative, boundary: 'zero-outside-selected-region;no-unselected-audio' }); planes = next; sampleRate = nextRate;
    }
  }
  check(); const planeHashes = await Promise.all(planes.map(value => seedDigest(new Uint8Array(value.buffer)))); check();
  return { planes, metadata: freezeData({ schema: 'lemmings-prepared-warp-PCM/v1', revision: WARP_SOURCE_PCM_REVISION, originalRate: source.sampleRate, originalRegionFrames: [source.firstFrame, source.endFrame], originalFrames: source.frames,
    preparedRate: outputRate, preparedFrames: planes[0].length, frameMapping: 'preparedFrame*originalRate/preparedRate+originalFirstFrame', finalFramePolicy: 'ceil-selected-duration-at-prepared-rate;fractional-final-support-zero-padded',
    passes, planeHashes, readerBankHash: passes.length ? bank.hash : null, ownership: 'private-copied-planar-Float32;parent-buffer-never-detached-or-mutated', normalization: 'none', interpolationQualification: 'existing-reader-kernel;cross-rate-warp-quality-not-established' }) };
}
