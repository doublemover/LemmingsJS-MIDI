import { cloneData, freezeData } from '../../core/CanonicalData.js';

const id = value => typeof value === 'string' && /^[a-z][a-z0-9._:-]{0,127}$/i.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const keys = (value, allowed) => value && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new TypeError('Drum kit: ' + message); };
const admitted = new WeakMap();

export function validateDrumKitDefinition(raw) {
  if (admitted.has(raw)) return raw;
  const kit = cloneData(raw, { maxBytes: 65536, maxNodes: 8192 });
  if (!keys(kit, ['schema', 'id', 'revision', 'name', 'generatorRevision', 'variant', 'voices', 'chokeGroups', 'unknownVoiceId', 'pitchPolicy', 'qualification', 'roomPolicy']) || kit.schema !== 'lemmings-drum-kit/v1' || !id(kit.id) || !integer(kit.revision, 1, 2147483647) || typeof kit.name !== 'string' || !kit.name.length || kit.name.length > 128 || !id(kit.generatorRevision) || !id(kit.variant) || !Array.isArray(kit.voices) || !kit.voices.length || kit.voices.length > 16 || !Array.isArray(kit.chokeGroups) || kit.chokeGroups.length > 8 || kit.pitchPolicy !== 'fixed-prepared-source;GM-note-selects-articulation' || kit.qualification !== 'unqualified-original-content;device-and-listening-pending' || !['dry-prepared-source', 'printed-finite-taps;not-shared-room-send'].includes(kit.roomPolicy)) fail('Use a bounded exact prepared-source kit and explicit pitch/room/qualification policies.');
  const voices = new Map(), notes = new Set(), articulations = new Set();
  for (const voice of kit.voices) {
    if (!keys(voice, ['id', 'name', 'gmNote', 'articulationId', 'assetHash', 'sourceRate', 'sourceFrames', 'sourceChannels', 'nominalBodyHz', 'nominalAmplitudeT60Seconds', 'preparationComponents', 'runtimeChildren', 'chokeGroup']) || !id(voice.id) || voices.has(voice.id) || typeof voice.name !== 'string' || !voice.name.length || voice.name.length > 80 || !integer(voice.gmNote, 0, 127) || notes.has(voice.gmNote) || !id(voice.articulationId) || articulations.has(voice.articulationId) || !hash(voice.assetHash) || voice.sourceRate !== 48000 || voice.sourceChannels !== 1 || !integer(voice.sourceFrames, 2, 96000) || !Number.isFinite(voice.nominalBodyHz) || voice.nominalBodyHz < 0 || voice.nominalBodyHz > 10000 || !Number.isFinite(voice.nominalAmplitudeT60Seconds) || voice.nominalAmplitudeT60Seconds < 0.01 || voice.nominalAmplitudeT60Seconds > 1.5 || !integer(voice.preparationComponents, 1, 16) || voice.runtimeChildren !== 1 || voice.chokeGroup !== null && !id(voice.chokeGroup)) fail('Voice IDs, GM fallback, actual source clocks/hashes and composite cost must be explicit.');
    voices.set(voice.id, voice); notes.add(voice.gmNote); articulations.add(voice.articulationId);
  }
  const groups = new Set(), grouped = new Set();
  for (const group of kit.chokeGroups) {
    if (!keys(group, ['id', 'scope', 'action', 'members']) || !id(group.id) || groups.has(group.id) || group.scope !== 'lane-kit-instance' || group.action !== 'newest-admitted-voice;click-safe-end' || !Array.isArray(group.members) || group.members.length < 2 || group.members.length > 16 || new Set(group.members).size !== group.members.length || group.members.some(member => !voices.has(member) || grouped.has(member) || voices.get(member).chokeGroup !== group.id)) fail('Choke uses one declared lane/kit instance and known voice members, never global strings or cyclic redirects.');
    groups.add(group.id); for (const member of group.members) grouped.add(member);
  }
  if (!voices.has(kit.unknownVoiceId) || kit.voices.some(voice => voice.chokeGroup !== null && (!groups.has(voice.chokeGroup) || !grouped.has(voice.id)))) fail('Unknown fallback or choke membership is incomplete.');
  const prepared = freezeData(kit); admitted.set(prepared, { byNote: new Map(kit.voices.map(voice => [voice.gmNote, voice])), fallback: voices.get(kit.unknownVoiceId) }); return prepared;
}

export function resolveDrumKitStrike(raw, { gmNote, intensity01 = 1, tuningCents = 0, instanceId } = {}) {
  const plan = admitted.get(raw); if (!plan) fail('Admit the immutable kit before resolving strikes.'); const kit = raw;
  if (!integer(gmNote, 0, 127) || !Number.isFinite(intensity01) || intensity01 < 0 || intensity01 > 1 || !id(instanceId) || instanceId.length > 48 || tuningCents !== 0) fail('Choose one explicit kit instance and intensity. This prepared tier does not retune a source by changing its GM articulation key.');
  const exact = plan.byNote.get(gmNote), voice = exact || plan.fallback, sampleKitId = kit.id + ':' + instanceId;
  if (sampleKitId.length > 128) fail('The complete kit instance identity exceeds the canonical source limit.');
  return freezeData({ voiceId: voice.id, articulationId: voice.articulationId, sampleGesture: voice.articulationId, sampleKitId, gmFallbackNote: gmNote, velocity01: intensity01,
    pitchCents: voice.gmNote * 100, pitchMeaning: 'local-sampler-selection-coordinate;hardware-GM-fallback-is-separate', localDisposition: exact ? 'authored-prepared-source' : 'named-approximation',
    localName: exact ? voice.name : voice.name + ' approximation for unmapped GM ' + gmNote, assetHash: voice.assetHash, chokeGroup: voice.chokeGroup, chokeScope: 'existing-owned-sampler:world-generation-lane-kit-instance-and-map', semanticSources: 1, runtimeChildren: voice.runtimeChildren, preparationComponents: voice.preparationComponents });
}

export function validateDrumKitBinding(raw, definition) {
  const kit = validateDrumKitDefinition(raw), map = definition?.sampleMap;
  if (definition?.engineId !== 'worklet-sample' || map?.rendererProfile !== 'owned-sample-v1' || !Array.isArray(map.articulations) || !Array.isArray(map.zones) || !Array.isArray(definition.sampleRefs) || map.articulations.length !== kit.voices.length || map.zones.length !== kit.voices.length || map.neutralArticulationId !== admitted.get(kit).fallback.articulationId || map.releasePolicy !== 'owned-end') fail('Bind this prepared kit to its complete owned sample map.');
  for (const voice of kit.voices) {
    const zone = map.zones.find(zone => zone.articulationId === voice.articulationId), sample = definition.sampleRefs.find(sample => sample.sha256 === voice.assetHash);
    if (!sample || !zone || zone.assetHash !== voice.assetHash || zone.onsetFrame !== 0 || zone.endFrame !== voice.sourceFrames || zone.rootCents !== voice.gmNote * 100 || zone.tuningCents !== 0 || zone.pitchRange?.maxTransposeCents !== 0 || zone.pitchTracking !== 'fixed' || zone.playbackMode !== 'forward' || zone.loop !== null || zone.releaseRegion !== null || zone.chokeGroup !== voice.chokeGroup) fail('A kit articulation differs from its exact fixed source or declared choke group.');
  }
  return kit;
}

export function verifyDrumKitDecodedSources(raw, assets) {
  const kit = validateDrumKitDefinition(raw), byHash = new Map(assets.map(pin => [pin.ref.contentHash, pin]));
  for (const voice of kit.voices) { const pin = byHash.get(voice.assetHash); if (!pin?.isActive?.() || pin.ref.sourceSampleRate !== voice.sourceRate || pin.ref.frames !== voice.sourceFrames || pin.ref.channels !== voice.sourceChannels) fail('The decoded source clock or channels differ from the kit definition.'); }
  return kit;
}
