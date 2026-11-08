import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';

const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
export function retainOwnedSampleDiagnostics(data, plan) {
  const source = data?.source;
  if (!integer(data?.frame, 0) || source?.kind !== 'owned-sample-source' || source.bankHash !== plan.descriptor.bankHash || source.pcmHash !== plan.descriptor.pcmHash ||
      source.mapId !== plan.map.mapId || source.mapRevision !== plan.map.revision || !Array.isArray(source.voices) || source.voices.length > plan.footprint.maximumVoices) throw new Error('Source diagnostics differ from the prepared sample owner.');
  canonicalDataText(source, { maxBytes: 65536, maxNodes: 4096 });
  const slots = new Set(), voices = source.voices.map(voice => {
    const entry = plan.entries.find(entry => entry.zoneId === voice.zoneId), region = entry?.attack;
    if (!region || !integer(voice.slot, 0, plan.footprint.maximumVoices - 1) || slots.has(voice.slot) || !integer(voice.token, 1, 0xffffffff) || !integer(voice.epoch, 1) || !integer(voice.generation, 0) ||
        voice.frame !== data.frame || voice.assetHash !== region.assetHash || voice.mode !== region.mode || !finite(voice.decodedPosition, region.first - 4, region.end + 4) ||
        !finite(voice.readDerivative, -4, 4) || !finite(voice.rateRatio, 1 / 16, 16) || !finite(voice.sourcePosition, -1073741824, 1073741824) || !integer(voice.readHeads, 0, 4) ||
        typeof voice.childActive !== 'boolean' || voice.childActive && !entry.release || !finite(voice.childDecodedPosition, 0, (entry.release?.end ?? 0) + 4) ||
        typeof voice.loopActive !== 'boolean' || voice.loopActive && !region.loop || !integer(voice.loopTurns, 0)) throw new Error('Source diagnostics contain an invalid selected voice or frame domain.');
    if (plan.body && (!voice.body || voice.body.modes !== plan.body.count || voice.body.energyBudget !== plan.body.energyBudget || !finite(voice.body.injectedEnergy, 0, plan.body.energyBudget) || !integer(voice.body.remainingTailFrames, 0, plan.sampleRate * 5) || typeof voice.body.active !== 'boolean' || typeof voice.body.calibrationExceeded !== 'boolean')) throw new Error('Graft diagnostics differ from the prepared body profile.');
    slots.add(voice.slot);
    return { slot: voice.slot, token: voice.token, epoch: voice.epoch, generation: voice.generation, zoneId: entry.zoneId, assetHash: region.assetHash,
      sourceRegionFrames: [region.sourceFirst, region.sourceEnd], sourceSampleRate: region.sourceSampleRate, decodedSampleRate: region.decodedSampleRate,
      decodedPosition: voice.decodedPosition, sourcePosition: voice.sourcePosition, rateRatio: voice.rateRatio, readDerivative: voice.readDerivative, pitchTracking: region.pitchTracking, mode: region.mode, readHeads: voice.readHeads, ...(plan.body ? { body: voice.body } : {}),
      loop: region.loop ? { mode: region.loop.mode, startFrame: region.loop.startFrame, endFrame: region.loop.endFrame, crossfadeFrames: region.loop.crossfadeFrames, gainLaw: region.loop.gainLaw, active: voice.loopActive, turns: voice.loopTurns } : null,
      child: entry.release ? { active: voice.childActive, assetHash: entry.release.assetHash, sourceRegionFrames: [entry.release.sourceFirst, entry.release.sourceEnd], decodedPosition: voice.childDecodedPosition } : null };
  });
  return freezeData({ schema: 'lemmings-owned-sample-diagnostics/v1', frame: data.frame, mapId: plan.map.mapId, mapRevision: plan.map.revision, bankHash: source.bankHash,
    voices, positionDomain: 'original-source-frames;unwrapped-for-position-driven', decodedDomain: 'private-PCM-frames', rateDomain: 'varispeed-note-ratio;fixed-unpitched-rate-one;position-mode-uses-observed-readDerivative',
    evidenceClass: 'processor-state-at-reported-completed-frame', acousticReceipt: false });
}
