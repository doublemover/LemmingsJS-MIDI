import { SAMPLE_LAYOUT } from './OwnedSourceLayout.js';
import { prepareSampleBodyProfile } from '../../midi/content/SampleBodyProfile.js';
import { createSampleMapResolver, sampleMapRenderIdentity, OWNED_SAMPLE_MAP_PROFILE } from '../../midi/content/SampleInstrumentMap.js';
import { validOwnedPcmSetDescriptor } from '../../midi/content/OwnedPcmFormat.js';
import { prepareSampleCursorProfile } from '../../midi/content/SampleCursorProfile.js';
import { sampleRegionRate, sampleRegionArticulation } from './NativeSamplePlan.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';

export const OWNED_SAMPLE_PLAN_REVISION = 'owned-sample-region-plan-motion-body-v2';
export const OWNED_SAMPLE_VOICES = SAMPLE_LAYOUT.voices;
export const OWNED_SAMPLE_CURSOR_CAPACITY = 32;
const fail = message => { throw Object.assign(new Error(message), { name: 'OwnedSamplePreflightError', code: 'owned-sample-preflight' }); };
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

// This compiles the existing content owner's map against already verified PCM
// metadata. It never copies PCM or advances the deterministic onset selector.
export function prepareOwnedSamplePlan(patch, descriptor, sampleRate) {
  if (!validOwnedPcmSetDescriptor(descriptor) || ![44100, 48000, 96000].includes(sampleRate) || !Array.isArray(patch?.sampleRefs) ||
      !integer(patch.voicePolicy?.maxVoices, 1, OWNED_SAMPLE_VOICES)) fail('The owned sampler requires a bounded complete PCM set and output-rate profile.');
  const refs = new Set(patch.sampleRefs.map(ref => ref.sha256));
  if (refs.size !== descriptor.assetHashes.length || descriptor.assetHashes.some(hash => !refs.has(hash))) fail('Prepared sample assets differ from the complete patch inventory.');
  descriptor = freezeData({ ...descriptor, assetHashes: [...descriptor.assetHashes], banks: descriptor.banks.map(bank => ({ ...bank })) });
  const resolve = createSampleMapResolver(patch.sampleMap, patch.sampleRefs, { patchId: patch.id, patchRevision: patch.revision, rendererProfile: OWNED_SAMPLE_MAP_PROFILE });
  const body = prepareSampleBodyProfile(patch.parameters, sampleRate), map = resolve.map, indices = new Map(descriptor.assetHashes.map((hash, index) => [hash, index]));
  const compile = (region, child = false) => {
    const assetIndex = indices.get(region.assetHash), bank = descriptor.banks[assetIndex];
    if (!bank || region.endFrame > bank.sourceFrames || region.endFrame - region.onsetFrame < 2) fail('An owned source region exceeds its pinned original source frames.');
    const conversion = bank.sampleRate / bank.sourceSampleRate, first = region.onsetFrame * conversion, end = Math.min(bank.frames, region.endFrame * conversion);
    if (end - first < 2) fail('An owned source region has fewer than two decoded frames.');
    const loop = region.loop ? { ...region.loop, first: region.loop.startFrame * conversion, end: Math.min(bank.frames, region.loop.endFrame * conversion),
      crossfade: region.loop.crossfadeFrames * conversion, gainLaw: region.loop.gainLaw ?? 'linear', seamPolicy: 'fixed-period-symmetric-edge-held-v1' } : null;
    if (loop && (loop.end - loop.first < 2 || loop.crossfade > (loop.end - loop.first) / 2 || loop.crossfade > 0 && loop.crossfade < 2)) fail('The decoded loop span or seam cannot be represented in the admitted source region.');
    const mode = child ? 'forward' : region.playbackMode ?? 'forward', policy = mode === 'positionDriven' ? region.positionPolicy : null;
    const cursorProfile = policy ? prepareSampleCursorProfile({ sampleRate, sourceSampleRate: bank.sourceSampleRate, decodedSampleRate: bank.sampleRate,
      sourceFrames: bank.sourceFrames, decodedFrames: bank.frames, regionStartFrame: region.onsetFrame, regionEndFrame: region.endFrame,
      bankHash: descriptor.bankHash, mapRevision: map.revision, capacity: OWNED_SAMPLE_CURSOR_CAPACITY, slewSeconds: policy.slewSeconds,
      maximumReadDerivative: policy.maximumReadDerivative, boundary: policy.boundary, interpolation: policy.interpolation }) : null;
    const positionSeam = policy?.boundary === 'wrap' ? { first, end, crossfade: policy.crossfadeFrames * conversion, gainLaw: policy.gainLaw, seamPolicy: 'fixed-period-symmetric-edge-held-v1' } : null;
    if (positionSeam && (positionSeam.crossfade < 2 || positionSeam.crossfade > (end - first) / 2)) fail('The position wrap seam is outside the decoded region bound.');
    return freezeData({ assetIndex, assetHash: region.assetHash, first, end, guardFirst: Math.floor(first), guardEnd: Math.ceil(end),
      sourceFirst: region.onsetFrame, sourceEnd: region.endFrame, sourceSampleRate: bank.sourceSampleRate, decodedSampleRate: bank.sampleRate,
      rootCents: region.rootCents, tuningCents: region.tuningCents, rootFrequencyHz: 440 * 2 ** ((region.rootCents - region.tuningCents - 6900) / 1200), pitchRange: region.pitchRange, pitchTracking: region.pitchTracking ?? 'varispeed', gain01: region.gain01, mode, loop, cursorProfile,
      positionSeam, traversal: policy?.traversal ?? null,
      filterGuard: 'clamp-actual-region-sample-indices', periodDomain: 'fractional-decoded-source-frames;crossfade-does-not-shorten-loop' });
  };
  if (body && map.zones.some(zone => zone.loop || zone.releaseRegion || (body.excitationMode ? zone.playbackMode !== 'positionDriven' || !zone.positionPolicy?.traversal : zone.playbackMode !== 'forward'))) fail('A body graft requires its exact finite one-shot or canonical-motion cursor source without loop/release-trigger children.');
  const entries = map.zones.map(zone => freezeData({ zoneId: zone.id, attack: compile(zone), release: zone.releaseRegion ? compile(zone.releaseRegion, true) : null }));
  const byZone = new Map(entries.map((entry, index) => [entry.zoneId, index]));
  let cursorBytes = 0, cursorTransferBytes = 0, cursorCount = 0;
  for (const entry of entries) if (entry.attack.cursorProfile) {
    cursorCount += patch.voicePolicy.maxVoices; cursorBytes += entry.attack.cursorProfile.stateBytes * patch.voicePolicy.maxVoices;
    cursorTransferBytes = Math.max(cursorTransferBytes, entry.attack.cursorProfile.transferBytes);
  }
  const identity = canonicalDataText({ revision: OWNED_SAMPLE_PLAN_REVISION, patchId: patch.id, patchRevision: patch.revision, map: sampleMapRenderIdentity(map),
    bankHash: descriptor.bankHash, sampleRate, ...(body ? { body } : {}), cursorCapacity: OWNED_SAMPLE_CURSOR_CAPACITY }, { maxBytes: 262144, maxNodes: 32768 }).text;
  const rateFor = (entry, pitch, offset = 0) => {
    const ratio = sampleRegionRate(entry, pitch, offset), derivative = ratio == null ? NaN : ratio * entry.decodedSampleRate / sampleRate;
    return Number.isFinite(derivative) && derivative > 0 && (entry.mode === 'positionDriven' || derivative <= 4) ? { ratio, derivative } : null;
  };
  return Object.freeze({ revision: OWNED_SAMPLE_PLAN_REVISION, map, entries: Object.freeze(entries), descriptor, sampleRate, identity, body,
    footprint: freezeData({ cursorCount, cursorBytes, maximumCursorTransferBytes: cursorTransferBytes, metadataEstimateBytes: 524288 + cursorCount * 6144,
      layersPerVoice: 2, maximumReadHeadsPerVoice: 4, maximumVoices: patch.voicePolicy.maxVoices, realTimeCapacityQualified: false }),
    select(intent) {
      const region = resolve(intent), zoneIndex = byZone.get(region.selection.zoneId), entry = entries[zoneIndex], offset = intent.expression?.pitchOffsetCents ?? 0;
      const attack = rateFor(entry.attack, intent.pitch, offset), release = entry.release ? rateFor(entry.release, intent.pitch, offset) : null;
      if (body && offset !== 0) fail('The feed-forward body keeps its prepared onset tuning; independent pitch bends require a separate qualified template.');
      if (!attack || entry.release && !release) fail('Selected attack or release exceeds its authored pitch or four-decoded-frame/output-frame read bound.');
      if (entry.attack.mode === 'positionDriven' && offset !== 0) fail('Position-driven varispeed uses observed cursor derivative; an independent pitch offset is unavailable.');
      return freezeData({ zoneIndex, region, velocity01: intent.velocity01, rateRatio: attack.ratio, readDerivative: entry.attack.mode === 'reverse' ? -attack.derivative : entry.attack.mode === 'positionDriven' ? 0 : attack.derivative,
        releaseRateRatio: release?.ratio ?? null, releaseReadDerivative: release?.derivative ?? null,
        articulation: { ...sampleRegionArticulation(region, entry.attack.sourceSampleRate, attack.ratio, patch.parameters?.releaseSeconds ?? 0.04), ...(body ? { bodyTailSeconds: 4, policy: body.excitationMode ? 'observed-motion-exciter-plus-independent-body;bounded-four-second-release-tail' : 'finite-exciter-plus-independent-body;bounded-four-second-tail' } : {}) },
        pitchPolicy: entry.attack.mode === 'positionDriven' ? 'note-selects-zone;observed-position-derivative-owns-varispeed-pitch' : entry.attack.pitchTracking === 'fixed' ? 'unpitched-fixed-source-rate;note-selects-zone-only' : 'independent-varispeed-ratio',
        evidenceClass: 'prepared-source-region-selection', acousticReceipt: false });
    }, rateFor
  });
}
