import { validateSampleTraversalBinding } from './SampleTraversal.js';
import { canonicalDataText, freezeData } from '../../core/CanonicalData.js';
import { instrumentVariationValue } from './InstrumentIdentityVariation.js';

export const SAMPLE_MAP_SCHEMA = 'lemmings-sample-instrument-map/v1';
export const NATIVE_SAMPLE_MAP_PROFILE = 'native-forward-v1';
export const OWNED_SAMPLE_MAP_PROFILE = 'owned-sample-v1';
export const SAMPLE_SELECTION_ALGORITHM = 'stable-semantic-onset-fnv32-v1';
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const text = (value, max = 160) => typeof value === 'string' && value.length > 0 && value.length <= max;
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const fail = message => { throw new TypeError('Sample instrument map: ' + message); };
const keys = (value, allowed) => { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('unknown field or invalid record'); };
const advancedMap = map => map.rendererProfile === OWNED_SAMPLE_MAP_PROFILE;
const before = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const sampleMapRenderIdentity = map => map ? { schema: map.schema, mapId: map.mapId, revision: map.revision,
  articulationIds: map.articulations.map(entry => entry.id), neutralArticulationId: map.neutralArticulationId, selectionPolicy: map.selectionPolicy,
  releasePolicy: map.releasePolicy, ...(map.rendererProfile ? { rendererProfile: map.rendererProfile } : {}), zones: map.zones } : null;

export function retainSampleSelectionReceipt(outcome) {
  try {
    const region = outcome?.region, selection = region?.selection, owned = outcome?.sourceRenderer === 'owned-sample';
    if (outcome?.status !== 'accepted' || !selection || region.domain !== 'source-frames' || !/^[a-f0-9]{64}$/.test(region.assetHash) ||
        !integer(region.onsetFrame, 0, 7999999) || !integer(region.endFrame, region.onsetFrame + 1, 8000000) || !finite(region.rootCents, -24000, 24000) ||
        !finite(outcome.rateRatio, 1 / 16, 16) || !integer(region.selectionSeed, 0, 0xffffffff) || !id(selection.mapId) || !integer(selection.mapRevision, 1, 2147483647) ||
        !id(selection.zoneId) || !id(selection.articulationId) || !id(selection.requestedArticulationId) || !id(selection.roundRobinGroup) ||
        !integer(selection.alternates, 1, 32) || !integer(selection.alternateIndex, 0, selection.alternates - 1) ||
        !finite(selection.velocityMin01, 0, 1) || !finite(selection.velocityMax01, selection.velocityMin01, 1) || typeof selection.neutralFallback !== 'boolean' ||
        !['execution-birth', 'event-only-fallback'].includes(selection.identityScope) || selection.algorithmVersion !== SAMPLE_SELECTION_ALGORITHM) return null;
    if (owned && (!['forward', 'reverse', 'positionDriven'].includes(region.playbackMode) || !finite(outcome.readDerivative, -4, 4))) return null;
    return freezeData({ schema: owned ? 'lemmings-owned-sample-selection/v1' : 'lemmings-native-sample-selection/v1', assetHash: region.assetHash, onsetFrame: region.onsetFrame, endFrame: region.endFrame,
      rootCents: region.rootCents, rateRatio: outcome.rateRatio, selectionSeed: region.selectionSeed, mapId: selection.mapId, mapRevision: selection.mapRevision,
      zoneId: selection.zoneId, articulationId: selection.articulationId, requestedArticulationId: selection.requestedArticulationId, neutralFallback: selection.neutralFallback,
      roundRobinGroup: selection.roundRobinGroup, alternateIndex: selection.alternateIndex, alternates: selection.alternates, velocityMin01: selection.velocityMin01,
      velocityMax01: selection.velocityMax01, identityScope: selection.identityScope, algorithmVersion: SAMPLE_SELECTION_ALGORITHM,
      ...(owned ? { playbackMode: region.playbackMode, readDerivative: outcome.readDerivative, ...(region.pitchTracking ? { pitchTracking: region.pitchTracking } : {}) } : {}),
      evidenceClass: owned ? 'owned-source-selection-api' : 'native-source-selection-api', appliedFrame: null, acousticReceipt: false });
  } catch { return null; }
}

export function validateSampleInstrumentMap(input, sampleRefs, { rendererProfile = NATIVE_SAMPLE_MAP_PROFILE } = {}) {
  keys(input, ['schema', 'mapId', 'revision', 'articulations', 'neutralArticulationId', 'selectionPolicy', 'releasePolicy', 'normalizationRef', 'rightsRef', 'zones', 'rendererProfile']);
  const profile = input.rendererProfile ?? NATIVE_SAMPLE_MAP_PROFILE, owned = rendererProfile === OWNED_SAMPLE_MAP_PROFILE;
  if (![NATIVE_SAMPLE_MAP_PROFILE, OWNED_SAMPLE_MAP_PROFILE].includes(rendererProfile) || ![NATIVE_SAMPLE_MAP_PROFILE, OWNED_SAMPLE_MAP_PROFILE].includes(profile) || !owned && profile !== NATIVE_SAMPLE_MAP_PROFILE) fail('renderer profile is unavailable');
  const advanced = profile === OWNED_SAMPLE_MAP_PROFILE;
  if (input.schema !== SAMPLE_MAP_SCHEMA || !id(input.mapId) || !integer(input.revision, 1, 2147483647) ||
      !Array.isArray(input.articulations) || !input.articulations.length || input.articulations.length > 16 ||
      !Array.isArray(input.zones) || !input.zones.length || input.zones.length > 128 ||
      !Array.isArray(sampleRefs) || !sampleRefs.length || sampleRefs.length > 32 || !text(input.rightsRef, 256) ||
      input.normalizationRef != null && !/^[a-f0-9]{64}$/.test(input.normalizationRef)) fail('invalid identity, source or bounded inventory');
  keys(input.selectionPolicy, ['algorithmVersion', 'seed', 'advanceOn', 'unknownArticulation', 'rootSelection']);
  const policy = input.selectionPolicy;
  if (policy.algorithmVersion !== SAMPLE_SELECTION_ALGORITHM || !integer(policy.seed, 0, 0xffffffff) || policy.advanceOn !== 'semantic-onset' ||
      !['neutral', 'reject'].includes(policy.unknownArticulation) || policy.rootSelection !== 'nearest-lower-tie' || input.releasePolicy !== 'owned-end') fail('unsupported selection or release policy');
  const articulations = new Set(), assets = new Set(sampleRefs.filter(ref => ref.required !== false).map(ref => ref.sha256));
  const gestures = input.articulations.map(entry => {
    keys(entry, ['id', 'name']); if (!id(entry.id) || articulations.has(entry.id) || !text(entry.name, 80)) fail('invalid or duplicate articulation');
    articulations.add(entry.id); return { id: entry.id, name: entry.name };
  }).sort(before);
  if (!articulations.has(input.neutralArticulationId)) fail('missing neutral articulation');
  const region = (value, child = false) => {
    keys(value, child ? ['assetHash', 'onsetFrame', 'endFrame', 'rootCents', 'gain01', 'tuningCents', 'pitchRange', ...(advanced ? ['pitchTracking'] : [])] :
      ['id', 'articulationId', 'roundRobinGroup', 'alternateIndex', 'velocityMin01', 'velocityMax01', 'assetHash', 'onsetFrame', 'endFrame', 'rootCents', 'gain01', 'tuningCents', 'pitchRange', 'loop', 'releaseRegion', 'chokeGroup', ...(advanced ? ['playbackMode', 'positionPolicy', 'pitchTracking'] : [])]);
    if (!assets.has(value.assetHash) || !integer(value.onsetFrame, 0, 7999999) || !integer(value.endFrame, value.onsetFrame + 1, 8000000) ||
        !finite(value.rootCents, -24000, 24000) || !finite(value.gain01, 0, 1) || !finite(value.tuningCents, -1200, 1200)) fail('invalid source frame region or authored trim');
    keys(value.pitchRange, ['minCents', 'maxCents', 'maxTransposeCents']);
    const range = value.pitchRange, pitchTracking = advanced ? value.pitchTracking ?? 'varispeed' : 'varispeed';
    if (!['fixed', 'varispeed'].includes(pitchTracking) || pitchTracking === 'fixed' && value.tuningCents !== 0) fail('fixed-rate material cannot hide pitch tuning');
    if (!finite(range.minCents, -24000, value.rootCents) || !finite(range.maxCents, value.rootCents, 24000) ||
        !finite(range.maxTransposeCents, 0, 4800) || (pitchTracking === 'fixed' ? range.maxTransposeCents !== 0 : Math.max(value.rootCents - range.minCents, range.maxCents - value.rootCents) > range.maxTransposeCents))
      fail('pitch range exceeds its declared varispeed transposition');
    const playbackMode = advanced && !child ? value.playbackMode ?? 'forward' : 'forward';
    if (!['forward', 'reverse', 'positionDriven'].includes(playbackMode)) fail('unsupported owned sample playback mode');
    let positionPolicy = null;
    if (!child && playbackMode === 'positionDriven') {
      keys(value.positionPolicy, ['boundary', 'interpolation', 'slewSeconds', 'maximumReadDerivative', 'crossfadeFrames', 'gainLaw', 'traversal']);
      const p = value.positionPolicy;
      if (!['stop', 'wrap', 'reflect'].includes(p.boundary) || !['linear', 'smoothstep'].includes(p.interpolation) || !finite(p.slewSeconds, 0.005, 0.02) ||
          !finite(p.maximumReadDerivative, 0.25, 4) || !['linear', 'equal-power'].includes(p.gainLaw) ||
          (p.boundary === 'wrap' ? !integer(p.crossfadeFrames, 16, Math.floor((value.endFrame - value.onsetFrame) / 2)) : p.crossfadeFrames !== 0) || value.loop != null) fail('position-driven policy needs bounded cursor, seam and rest semantics');
      positionPolicy = { ...p, ...(p.traversal == null ? {} : { traversal: validateSampleTraversalBinding(p.traversal) }) };
    } else if (!child && value.positionPolicy != null) fail('position policy requires position-driven playback');
    let loop = null;
    if (!child && value.loop != null) {
      keys(value.loop, ['mode', 'startFrame', 'endFrame', 'crossfadeFrames', ...(advanced ? ['gainLaw'] : [])]);
      if (!['forward', 'sustain'].includes(value.loop.mode) || !integer(value.loop.startFrame, value.onsetFrame, value.endFrame - 1) ||
          !integer(value.loop.endFrame, value.loop.startFrame + 1, value.endFrame) ||
          (advanced ? value.loop.crossfadeFrames !== 0 && !integer(value.loop.crossfadeFrames, 16, Math.floor((value.loop.endFrame - value.loop.startFrame) / 2)) || !['linear', 'equal-power'].includes(value.loop.gainLaw ?? 'linear') : value.loop.crossfadeFrames !== 0)) fail('loop range, seam crossfade or gain law is unavailable in this renderer profile');
      loop = { mode: value.loop.mode, startFrame: value.loop.startFrame, endFrame: value.loop.endFrame, crossfadeFrames: value.loop.crossfadeFrames,
        ...(advanced ? { gainLaw: value.loop.gainLaw ?? 'linear' } : {}) };
    }
    return { assetHash: value.assetHash, onsetFrame: value.onsetFrame, endFrame: value.endFrame, rootCents: value.rootCents,
      ...(value.pitchTracking != null ? { pitchTracking } : {}), gain01: value.gain01, tuningCents: value.tuningCents, pitchRange: { minCents: range.minCents, maxCents: range.maxCents, maxTransposeCents: range.maxTransposeCents },
      ...(!child ? { ...(advanced ? { playbackMode, positionPolicy } : {}), loop, releaseRegion: value.releaseRegion == null ? null : region(value.releaseRegion, true), chokeGroup: value.chokeGroup ?? null } : {}) };
  };
  const ids = new Set(), groups = new Map();
  const zones = input.zones.map(entry => {
    const source = region(entry);
    if (!id(entry.id) || ids.has(entry.id) || !articulations.has(entry.articulationId) || !id(entry.roundRobinGroup) ||
        !integer(entry.alternateIndex, 0, 31) || !finite(entry.velocityMin01, 0, 1) || !finite(entry.velocityMax01, 0, 1) ||
        entry.velocityMin01 >= entry.velocityMax01 || entry.chokeGroup != null && !id(entry.chokeGroup)) fail('invalid zone identity, velocity interval or alternate');
    ids.add(entry.id);
    const key = JSON.stringify([entry.articulationId, entry.roundRobinGroup, source.rootCents, source.pitchRange.minCents, source.pitchRange.maxCents, entry.velocityMin01, entry.velocityMax01]);
    let group = groups.get(key); if (!group) { group = new Set(); groups.set(key, group); }
    if (group.has(entry.alternateIndex)) fail('duplicate alternate in a selected layer'); group.add(entry.alternateIndex);
    return { id: entry.id, articulationId: entry.articulationId, roundRobinGroup: entry.roundRobinGroup, alternateIndex: entry.alternateIndex,
      velocityMin01: entry.velocityMin01, velocityMax01: entry.velocityMax01, ...source };
  }).sort(before);
  for (const group of groups.values()) if (group.size > 32 || [...group].some(index => index >= group.size)) fail('alternate indexes must be contiguous from zero');
  for (const articulation of articulations) if (!zones.some(zone => zone.articulationId === articulation)) fail('articulation has no authored sample');
  for (let a = 0; a < zones.length; a++) for (let b = a + 1; b < zones.length; b++) {
    const left = zones[a], right = zones[b];
    if (left.articulationId !== right.articulationId || left.rootCents !== right.rootCents ||
        left.velocityMax01 <= right.velocityMin01 || right.velocityMax01 <= left.velocityMin01 ||
        left.pitchRange.maxCents < right.pitchRange.minCents || right.pitchRange.maxCents < left.pitchRange.minCents) continue;
    if (left.roundRobinGroup !== right.roundRobinGroup || left.velocityMin01 !== right.velocityMin01 || left.velocityMax01 !== right.velocityMax01 ||
        left.pitchRange.minCents !== right.pitchRange.minCents || left.pitchRange.maxCents !== right.pitchRange.maxCents) fail('ambiguous overlapping layers at the same root');
  }
  const result = { schema: SAMPLE_MAP_SCHEMA, mapId: input.mapId, revision: input.revision, articulations: gestures, neutralArticulationId: input.neutralArticulationId,
    selectionPolicy: { ...policy }, releasePolicy: 'owned-end', ...(input.rendererProfile ? { rendererProfile: profile } : {}), normalizationRef: input.normalizationRef ?? null, rightsRef: input.rightsRef, zones };
  canonicalDataText(result, { maxBytes: advanced ? 128 * 1024 : 48 * 1024, maxNodes: advanced ? 16384 : 6144, domain: 'Sample instrument map' }); return freezeData(result);
}

export function validateSampleMapAssets(map, pins) {
  if (!Array.isArray(pins) || pins.length > 32) fail('invalid decoded material inventory');
  const available = new Map(pins.map(pin => [pin?.ref?.contentHash, pin]));
  for (const zone of map.zones) for (const region of [zone, zone.releaseRegion].filter(Boolean)) {
    const pin = available.get(region.assetHash);
    if (!pin?.isActive?.() || !integer(pin.ref.frames, region.endFrame, 8000000) || !integer(pin.ref.channels, 1, 2)) fail('authored region exceeds its actual pinned source');
  }
  return true;
}

export function createSampleMapResolver(input, sampleRefs, { patchId, patchRevision, rendererProfile = NATIVE_SAMPLE_MAP_PROFILE } = {}) {
  const map = validateSampleInstrumentMap(input, sampleRefs, { rendererProfile });
  if (!id(patchId) || !integer(patchRevision, 1, 2147483647)) fail('an exact patch identity is required');
  const groups = new Map(), byGesture = new Map();
  for (const zone of map.zones) {
    const key = JSON.stringify([zone.articulationId, zone.roundRobinGroup, zone.rootCents, zone.pitchRange.minCents, zone.pitchRange.maxCents, zone.velocityMin01, zone.velocityMax01]);
    let group = groups.get(key);
    if (!group) { group = { zone, alternates: [] }; groups.set(key, group);
      let list = byGesture.get(zone.articulationId); if (!list) { list = []; byGesture.set(zone.articulationId, list); } list.push(group); }
    group.alternates.push(zone);
  }
  for (const group of groups.values()) group.alternates.sort((a, b) => a.alternateIndex - b.alternateIndex);
  const select = intent => {
    if (intent?.version !== 1 || intent.kind !== 'begin' || !text(intent.onsetId ?? intent.voiceId, 512) ||
        !integer(intent.generation, 0, Number.MAX_SAFE_INTEGER) || !finite(intent.velocity01, 0, 1) || !finite(intent.pitch?.cents, -24000, 24000) ||
        !finite(intent.pitch.referenceHz ?? 440, 0.1, 20000) || !finite(intent.expression?.pitchOffsetCents ?? 0, -24000, 24000) ||
        intent.worldId != null && !text(intent.worldId, 256) || intent.actorId != null && !(integer(intent.actorId, 0, Number.MAX_SAFE_INTEGER) || text(intent.actorId, 160)) ||
        intent.laneId != null && !(integer(intent.laneId, 0, Number.MAX_SAFE_INTEGER) || text(intent.laneId, 160)) ||
        intent.mappingId != null && !text(intent.mappingId, 128) || intent.sampleKitId != null && !id(intent.sampleKitId)) fail('selection requires the captured semantic onset');
    const requested = intent.sampleGesture ?? map.neutralArticulationId;
    if (!id(requested)) fail('invalid captured sample gesture');
    const fallback = !byGesture.has(requested);
    if (fallback && map.selectionPolicy.unknownArticulation !== 'neutral') fail('requested articulation is not authored');
    const gesture = fallback ? map.neutralArticulationId : requested;
    const cents = intent.pitch.cents + (intent.expression?.pitchOffsetCents ?? 0) + 1200 * Math.log2((intent.pitch.referenceHz ?? 440) / 440);
    let selected = null;
    for (const group of byGesture.get(gesture)) {
      const zone = group.zone;
      if (cents < zone.pitchRange.minCents || cents > zone.pitchRange.maxCents || intent.velocity01 < zone.velocityMin01 ||
          (intent.velocity01 >= zone.velocityMax01 && !(zone.velocityMax01 === 1 && intent.velocity01 === 1))) continue;
      const distance = Math.abs(cents - zone.rootCents), previous = selected?.zone;
      if (!selected || distance < Math.abs(cents - previous.rootCents) || distance === Math.abs(cents - previous.rootCents) && zone.rootCents < previous.rootCents) selected = group;
    }
    if (!selected) fail('no authored zone covers this gesture, velocity and pitch');
    const actorIdentity = intent.worldId != null && intent.actorId != null ? [intent.worldId, intent.generation, intent.actorId] : null;
    const seed = Math.min(0xffffffff, Math.floor((instrumentVariationValue([SAMPLE_SELECTION_ALGORITHM, map.mapId, map.revision, patchId, patchRevision, map.selectionPolicy.seed,
      actorIdentity || ['event-only', intent.onsetId ?? intent.voiceId], intent.onsetId ?? intent.voiceId,
      selected.alternates.map(zone => [zone.id, zone.assetHash])]) + 1) * 2147483648));
    const zone = selected.alternates[seed % selected.alternates.length];
    const toRegion = entry => ({ domain: 'source-frames', assetHash: entry.assetHash, onsetFrame: entry.onsetFrame, endFrame: entry.endFrame, rootCents: entry.rootCents,
      ...(entry.pitchTracking ? { pitchTracking: entry.pitchTracking } : {}), gain01: entry.gain01, tuningCents: entry.tuningCents, pitchRange: { minCents: entry.pitchRange.minCents, maxCents: entry.pitchRange.maxCents }, playbackMode: entry.playbackMode ?? 'forward' });
    const scope = JSON.stringify([intent.worldId ?? null, intent.generation, intent.laneId ?? null, intent.sampleKitId ?? intent.mappingId ?? 'control', map.mapId, map.revision]);
    if (scope.length > 1024) fail('sample kit scope exceeds its bounded identity');
    return freezeData({ ...toRegion(zone), ...(advancedMap(map) ? { positionPolicy: zone.positionPolicy } : {}), loop: zone.loop, releaseRegion: zone.releaseRegion ? toRegion(zone.releaseRegion) : null,
      chokeGroup: zone.chokeGroup, chokeScope: scope, selectionSeed: seed,
      selection: { mapId: map.mapId, mapRevision: map.revision, zoneId: zone.id, articulationId: gesture, requestedArticulationId: requested, neutralFallback: fallback,
        roundRobinGroup: zone.roundRobinGroup, alternateIndex: zone.alternateIndex, alternates: selected.alternates.length, velocityMin01: zone.velocityMin01,
        velocityMax01: zone.velocityMax01, algorithmVersion: SAMPLE_SELECTION_ALGORITHM, advanceOn: 'semantic-onset', identityScope: actorIdentity ? 'execution-birth' : 'event-only-fallback',
        counterState: 'none', normalization: 'authored-trim-no-per-hit-normalization' } });
  };
  Object.defineProperty(select, 'map', { value: map }); return Object.freeze(select);
}
