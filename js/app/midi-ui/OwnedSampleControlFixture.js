import { freezeData } from '../../core/CanonicalData.js';

export function createOwnedSampleControlFixture(plan, gesture = plan.map.neutralArticulationId, { holdSeconds = 0.2 } = {}) {
  if (!Number.isFinite(holdSeconds) || holdSeconds < 0.2 || holdSeconds > 8) throw new TypeError('The authored sample audition hold must be 0.2–8 seconds.');
  if (!plan.map.articulations.some(entry => entry.id === gesture)) throw new TypeError('Choose an authored owned sample gesture.');
  const candidates = plan.map.zones.filter(zone => zone.articulationId === gesture).sort((a, b) => Math.abs(a.rootCents - 6000) - Math.abs(b.rootCents - 6000) || a.rootCents - b.rootCents || (a.id < b.id ? -1 : 1));
  const upperFor = region => region.pitchTracking === 'fixed' ? region.pitchRange.maxCents : Math.min(region.pitchRange.maxCents, region.rootCents - region.tuningCents + 4800,
    region.mode === 'positionDriven' ? Infinity : region.rootCents - region.tuningCents + 1200 * Math.log2(4 * plan.sampleRate / region.decodedSampleRate));
  let selected = null, pitch = null, velocity = null, low = null, high = null;
  for (const zone of candidates) {
    const entry = plan.entries.find(entry => entry.zoneId === zone.id), regions = [entry.attack, entry.release].filter(Boolean);
    const minimum = Math.max(...regions.map(region => Math.max(region.pitchRange.minCents, region.pitchTracking === 'fixed' ? region.pitchRange.minCents : region.rootCents - region.tuningCents - 4800))),
      maximum = Math.min(6900 + 1200 * Math.log2(Math.min(20000, plan.sampleRate / 2 - 1) / 440), ...regions.map(upperFor));
    if (minimum > maximum) continue;
    const cents = Math.max(minimum, Math.min(maximum, zone.rootCents)), velocity01 = zone.velocityMin01 <= 0.6 && (zone.velocityMax01 > 0.6 || zone.velocityMax01 === 1) ? 0.6 : (zone.velocityMin01 + zone.velocityMax01) / 2;
    try { selected = plan.select({ version: 1, kind: 'begin', voiceId: 'control-fixture', onsetId: 'control-fixture', actorId: null, generation: 1, laneId: 0,
      pitch: { cents, referenceHz: 440 }, velocity01, sampleGesture: gesture, expression: {} }); pitch = cents; velocity = velocity01; const realized = plan.entries[selected.zoneIndex], selectedRegions = [realized.attack, realized.release].filter(Boolean);
    low = Math.max(...selectedRegions.map(region => Math.max(region.pitchRange.minCents, region.pitchTracking === 'fixed' ? region.pitchRange.minCents : region.rootCents - region.tuningCents - 4800))); high = Math.min(maximum, ...selectedRegions.map(upperFor)); break; } catch { /* Another authored zone may fit this output rate. */ }
  }
  if (!selected) throw new TypeError('No authored sample zone can realize this fixed control fixture at the selected output rate.');
  const entry = plan.entries[selected.zoneIndex], position = entry.attack.mode === 'positionDriven', bend = position || plan.body || entry.attack.pitchTracking === 'fixed' ? 0 : high - pitch >= 1 ? Math.min(100, (high - pitch) * 0.5) : -Math.min(100, (pitch - low) * 0.5);
  const events = [{ kind: 'begin', seconds: 0, pitchCents: pitch, velocity01: velocity, sampleGesture: gesture, expression: { pressure01: 0.3, pan01: 0 } }];
  if (position) {
    const p = entry.attack.cursorProfile, span = Math.round(0.1 * plan.sampleRate), distance = Math.min((p.regionEndFrame - p.regionStartFrame) * 0.25,
      span * Math.min(1, p.maximumReadDerivative) / p.sourceToDecoded / (p.interpolation === 'smoothstep' ? 1.5 : 1));
    events.push({ kind: 'position', seconds: 0, segment: { firstOutputFrame: 0, endOutputFrame: span, firstSourceFrame: p.regionStartFrame, endSourceFrame: p.regionStartFrame + distance, sequence: 1, discontinuity: 'continuous' } });
    events.push({ kind: 'position', seconds: 0.1, segment: { firstOutputFrame: span, endOutputFrame: span * 2, firstSourceFrame: p.regionStartFrame + distance, endSourceFrame: p.regionStartFrame, sequence: 2, discontinuity: 'continuous' } });
  }
  events.push({ kind: 'update', seconds: 0.06, expression: { pressure01: 0.9, pan01: -0.5 } },
    { kind: 'update', seconds: 0.14, expression: { pressure01: 0.5, pan01: 0.5, ...(position || plan.body || entry.attack.pitchTracking === 'fixed' ? {} : { pitchOffsetCents: bend }) } }, { kind: 'end', seconds: holdSeconds });
  events.sort((a, b) => a.seconds - b.seconds);
  return freezeData({ fixture: { schema: 'lemmings-control-audition/v1', id: position ? 'owned-sample-authored-position-outbound-return-v1' : 'owned-sample-gesture-pressure-pan-pitch-v1',
    source: 'authored-control-fixture', physicalTakeEvidence: false, ...(holdSeconds !== 0.2 ? { holdSeconds } : {}), outputSampleRate: plan.sampleRate, positionSource: position ? 'authored-source-frame-program;not-physical-motion' : null, events }, selected });
}
