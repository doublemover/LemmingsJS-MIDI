import { cloneData, freezeData, hashData } from '../../../../core/CanonicalData.js';
import { prepareEffectGraphRevision } from '../../../../midi/content/EffectGraphRevision.js';
import { prepareSympatheticNetworkProfile } from '../../../../midi/content/SympatheticNetworkProfile.js';
import { validateTopologyRegion, topologyResultMatchesRegion, topologyComponentAt } from './TopologyInstrumentRegion.js';

export const CAVITY_SOUND_REVISION = 'authored-square-pixel-modal-map-v1';
export const CAVITY_SOUND_RECIPES = Object.freeze(['clay-chamber', 'throat-duet', 'crumbled-chimes']);
const id = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9._:-]{0,95}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => names.includes(key));
const fail = message => Object.assign(new Error('Cavity sound: ' + message), { code: 'cavity-sound-unavailable' });
export function createCavitySoundMap({ id: mapId = 'original.clay-chamber', revision = 1, topologyRegionRef, bodyRecipe = 'clay-chamber', anchorIds = [], throat = null, bindingPolicy = 'endOfTick' } = {}) {
  return validateCavitySoundMap({ schema: 'lemmings-cavity-sound-map/v1', id: mapId, revision, topologyRegionRef, componentSelector: { anchorIds }, bodyRecipe,
    descriptorMappings: { referenceAreaPixels2: 64, referenceFrequencyHz: 220, minimumFrequencyHz: 80, maximumFrequencyHz: 1760, boundaryNormalizationPixels: 32 },
    excitationPolicy: 'actual-work-contact-only', bindingPolicy, splitMergePolicy: 'prepared-replacement-keep-old-tail', unknownCoveragePolicy: 'omit-current-excitation', qualityVariant: 'four-authored-modes', throat });
}
export function validateCavitySoundMap(raw) {
  const value = cloneData(raw, { maxBytes: 8192, maxNodes: 512 }), r = value?.topologyRegionRef, selector = value?.componentSelector, m = value?.descriptorMappings, t = value?.throat;
  if (!keys(value, ['schema', 'id', 'revision', 'topologyRegionRef', 'componentSelector', 'bodyRecipe', 'descriptorMappings', 'excitationPolicy', 'bindingPolicy', 'splitMergePolicy', 'unknownCoveragePolicy', 'qualityVariant', 'throat']) || value.schema !== 'lemmings-cavity-sound-map/v1' || !id(value.id) || !integer(value.revision) || !value.revision || !keys(r, ['id', 'revision']) || !id(r.id) || !integer(r.revision) || !keys(selector, ['anchorIds']) || !Array.isArray(selector.anchorIds) || selector.anchorIds.length > 4 || selector.anchorIds.some(anchor => !id(anchor)) || new Set(selector.anchorIds).size !== selector.anchorIds.length || !CAVITY_SOUND_RECIPES.includes(value.bodyRecipe) ||
      !keys(m, ['referenceAreaPixels2', 'referenceFrequencyHz', 'minimumFrequencyHz', 'maximumFrequencyHz', 'boundaryNormalizationPixels']) || m.referenceAreaPixels2 !== 64 || m.referenceFrequencyHz !== 220 || m.minimumFrequencyHz !== 80 || m.maximumFrequencyHz !== 1760 || m.boundaryNormalizationPixels !== 32 || value.excitationPolicy !== 'actual-work-contact-only' || !['endOfTick', 'postTransaction'].includes(value.bindingPolicy) || value.splitMergePolicy !== 'prepared-replacement-keep-old-tail' || value.unknownCoveragePolicy !== 'omit-current-excitation' || value.qualityVariant !== 'four-authored-modes') throw fail('Use a complete original bounded mapping with explicit square-pixel units and revision policies.');
  if (value.bodyRecipe === 'throat-duet' ? selector.anchorIds.length !== 2 || !keys(t, ['x', 'y1', 'y2', 'referenceWidthPixels']) || ![t.x, t.y1, t.y2, t.referenceWidthPixels].every(integer) || t.y2 <= t.y1 || t.y2 - t.y1 > 32 || !t.referenceWidthPixels || t.referenceWidthPixels > 32 : t != null) throw fail('A throat duet requires two named anchors and one bounded authored cross-section.');
  return freezeData(value);
}
export function validateCavitySoundRegion(rawMap, rawRegion) {
  const map = validateCavitySoundMap(rawMap), region = validateTopologyRegion(rawRegion), t = map.throat, b = region.bounds;
  if (map.topologyRegionRef.id !== region.id || map.topologyRegionRef.revision !== region.revision || map.bindingPolicy !== region.bindingPolicy || region.space !== 'free' || region.mapping.bodyId !== map.id || region.mapping.dampingMacroId != null || map.componentSelector.anchorIds.some(id => !region.anchors.some(anchor => anchor.id === id)) || t && (t.x < b.x1 || t.x >= b.x2 || t.y1 < b.y1 || t.y2 > b.y2)) throw fail('The sound map differs from its exact free-space region, body identity, anchors or binding policy.');
  return Object.freeze({ map, region });
}
export async function compileCavitySoundMap(rawMap, rawRegion, result, { sampleRate = 48000, graphRevision = 1, sourceBusId = null } = {}) {
  const { map, region } = validateCavitySoundRegion(rawMap, rawRegion);
  if (!integer(graphRevision) || !graphRevision || graphRevision > 2147483647 || ![44100, 48000, 96000].includes(sampleRate) || sourceBusId != null && !id(sourceBusId)) throw fail('Use a bounded graph revision, output rate and optional explicit source bus.');
  const unavailable = reason => freezeData({ status: 'unavailable', reason, mapId: map.id, mapRevision: map.revision, semanticOnsetsAdded: 0 });
  if (!topologyResultMatchesRegion(result, region) || result.coverage !== 'complete') return unavailable('qualified-complete-geometry-unavailable');
  const anchored = map.componentSelector.anchorIds, selected = result.components.filter(component => !anchored.length || component.anchors.some(anchor => anchored.includes(anchor)));
  if (!selected.length || selected.length > 4 || selected.some(component => component.enclosure !== 'closed' || component.musical.status !== 'complete')) return unavailable('closed-selected-component-unavailable');
  if (map.bodyRecipe !== 'throat-duet' && selected.length !== 1) return unavailable('select-one-excited-component-with-an-anchor');
  const bindings = [], bodies = [], m = map.descriptorMappings;
  const addBody = async (component, identity, frequencyHz) => {
    const bodyId = 'cavity-' + await hashData({ mapId: map.id, identity }), shape = Math.min(1, component.boundaryLengthPixels / Math.max(1, Math.sqrt(component.areaPixels2) * 4));
    const bright = map.bodyRecipe === 'crumbled-chimes' ? Math.min(1, component.boundaryLengthPixels / Math.max(1, component.areaPixels2) * m.referenceAreaPixels2 / m.boundaryNormalizationPixels) : 0.35;
    const t60Seconds = 0.3 + (1 - Math.min(1, shape * 0.6)) * 1.2, ratios = [1, 2.02, 3.08, 4.16], gains = [1, 0.15 + bright * 0.35, 0.1 + bright * 0.2, 0.05 + bright * 0.15];
    bodies.push({ id: bodyId, excitation01: bodies.length ? 0 : 1, pickup01: 1, modes: ratios.map((ratio, index) => ({ frequencyHz: frequencyHz * ratio, decaySeconds: t60Seconds * [1, 0.85, 0.65, 0.45][index] / 1.5, gain01: gains[index] })) });
    bindings.push({ bodyId, componentId: component.id, identity, frequencyHz, t60Seconds, areaPixels2: component.areaPixels2, boundaryLengthPixels: component.boundaryLengthPixels, excitationBrightness01: bright });
  };
  if (map.bodyRecipe === 'throat-duet') {
    for (const [index, anchor] of anchored.entries()) { const component = selected.find(component => component.anchors.includes(anchor)); if (!component) return unavailable('duet-anchor-unavailable'); await addBody(component, 'anchor:' + anchor, m.referenceFrequencyHz * [1, 1.5][index]); }
  } else for (const component of selected) await addBody(component, 'component:' + component.id, Math.min(m.maximumFrequencyHz, Math.max(m.minimumFrequencyHz, m.referenceFrequencyHz * Math.sqrt(m.referenceAreaPixels2 / component.areaPixels2))));
  if (new Set(bodies.map(body => body.id)).size !== bodies.length) throw fail('Body identities collide.');
  let openingWidthPixels = 0; const edges = [];
  if (map.bodyRecipe === 'throat-duet' && bindings[0].componentId === bindings[1].componentId) {
    for (let y = map.throat.y1; y < map.throat.y2; y++) if (topologyComponentAt(result, { x: map.throat.x, y }, false)?.id === bindings[0].componentId) openingWidthPixels++;
    if (openingWidthPixels) edges.push({ fromBody: bodies[0].id, fromMode: 0, toBody: bodies[1].id, toMode: 0, amount: Math.min(0.04, 0.04 * openingWidthPixels / map.throat.referenceWidthPixels) });
  }
  const parameters = { bodies, edges, couple01: 0.65, damp01: 0 }, profile = prepareSympatheticNetworkProfile(parameters, sampleRate);
  const node = (id, kind, parameters = {}) => ({ id, kind, parameters }), edge = (from, to, gain01 = 1) => ({ from: { nodeId: from, port: 'audio' }, to: { nodeId: to, port: 'audio' }, gain01 });
  const nodes = [node('source', 'bus-in'), ...(sourceBusId ? [node('excitation', 'sidechain-in', { sourceBusId, tap: 'pre-fader', inputLayout: 'audioStereo' })] : []), node('body', 'sympathetic-network', parameters), node('return', 'gain', { gain01: 0.25, gainMaximum01: 0.25 }), node('output', 'bus-out')];
  const graph = prepareEffectGraphRevision({ schema: 'lemmings-effect-graph/v1', id: map.id, revision: graphRevision, latencyPolicy: 'align-declared', maximumLatencyFrames: 0, maximumTailSeconds: 3, nodes, edges: [edge(sourceBusId ? 'excitation' : 'source', 'body'), edge('body', 'return'), edge('return', 'output')] }).definition;
  return freezeData({ status: 'ready', revision: CAVITY_SOUND_REVISION, mapId: map.id, mapRevision: map.revision, worldId: result.worldId, generation: result.generation, topologyRegionId: result.regionId, topologyDefinition: result.definitionSignature, boundTopologyRevision: result.sourceRevision, bindings, excitationComponentId: bindings[0].componentId, openingWidthPixels, graph, bodyIdentityHash: await hashData({ worldId: result.worldId, generation: result.generation, map, bindings, parameters }),
    cost: { bodies: bodies.length, modes: profile.modeCount, stateBytes: profile.stateBytes, maximumTailFrames: profile.maximumTailFrames }, semanticOnsetsAdded: 0,
    interpretation: 'authored-square-pixel-proxies;not-3d-volume-material-or-acoustic-measurement', replacementPolicy: map.splitMergePolicy, excitationPolicy: map.excitationPolicy });
}
