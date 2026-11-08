import { createSampleMapResolver, validateSampleMapAssets } from '../../midi/content/SampleInstrumentMap.js';

export function sampleRegionRate(region, pitch, offset = 0) {
  const cents = pitch.cents + offset + 1200 * Math.log2((pitch.referenceHz ?? 440) / 440);
  if (!Number.isFinite(cents) || region.pitchRange && (cents < region.pitchRange.minCents || cents > region.pitchRange.maxCents)) return null;
  if (region.pitchTracking === 'fixed') return 1;
  const ratio = 2 ** ((cents - region.rootCents + region.tuningCents) / 1200);
  return Number.isFinite(ratio) && ratio >= 1 / 16 && ratio <= 16 ? ratio : null;
}

export function sampleRegionArticulation(region, sourceSampleRate, rate, releaseSeconds) {
  return Object.freeze({ version: 1, releaseSeconds,
    oneShotTailSeconds: Math.min(4, Math.max(0.04, (region.endFrame - region.onsetFrame) / sourceSampleRate / rate)),
    policy: 'selected-region-varispeed-duration-capped-at-four-seconds' });
}

// Planning uses the same immutable selector and source-frame/rate contract as
// playback. Native AudioBuffers remain pinned on the main thread throughout.
export function prepareNativeSamplePlan(patch, assets) {
  const resolve = createSampleMapResolver(patch.sampleMap, patch.sampleRefs, { patchId: patch.id, patchRevision: patch.revision });
  validateSampleMapAssets(resolve.map, assets);
  const pins = new Map(assets.map(pin => [pin.ref.contentHash, pin]));
  return intent => {
    const region = resolve(intent), rateRatio = sampleRegionRate(region, intent.pitch, intent.expression?.pitchOffsetCents ?? 0);
    if (rateRatio == null || region.releaseRegion && sampleRegionRate(region.releaseRegion, intent.pitch, intent.expression?.pitchOffsetCents ?? 0) == null)
      throw new Error('The selected sample or release region does not support the captured pitch.');
    const sourceSampleRate = pins.get(region.assetHash).ref.sourceSampleRate;
    if (!Number.isSafeInteger(sourceSampleRate) || sourceSampleRate < 8000 || sourceSampleRate > 192000) throw new Error('Sample source rate is unavailable.');
    const child = region.releaseRegion, childSourceRate = child ? pins.get(child.assetHash).ref.sourceSampleRate : null;
    if (child && (!Number.isSafeInteger(childSourceRate) || childSourceRate < 8000 || childSourceRate > 192000)) throw new Error('Release source rate is unavailable.');
    return { region, rateRatio, minimumRateRatio: rateRatio, sourceSampleRate, childSourceRate,
      articulation: sampleRegionArticulation(region, sourceSampleRate, rateRatio, patch.parameters.releaseSeconds ?? 0.04) };
  };
}

export function nativeSampleReleaseFrames(plan, releaseSeconds, sampleRate) {
  const child = plan.region.releaseRegion;
  const childRate = child?.pitchTracking === 'fixed' ? 1 : child ? plan.minimumRateRatio * 2 ** ((plan.region.rootCents - child.rootCents + child.tuningCents - plan.region.tuningCents) / 1200) : 1;
  const childSeconds = child ? Math.min(4, (child.endFrame - child.onsetFrame) / plan.childSourceRate / childRate) : 0;
  return Math.max(releaseSeconds, childSeconds, plan.articulation?.bodyTailSeconds ?? 0) * sampleRate;
}
