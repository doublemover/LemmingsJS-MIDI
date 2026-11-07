import { cloneMutableData, freezeData } from '../../core/CanonicalData.js';
import { validateWorldRegion, worldRegionDepth } from './WorldRegion.js';
import { ORIGINAL_MATERIAL_PATCH_IDS } from './MaterialResponseMap.js';

export const WORLD_ACOUSTIC_RENDERER_REQUIREMENT = 'owned-world-spatial-controls-and-shared-zone-returns';
export const ACOUSTIC_ZONE_RECIPES = Object.freeze(['felt-pocket', 'glass-arcade', 'pipe-corridor', 'open-clearing']);
const validated = new WeakSet(), id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value), natural = value => Number.isSafeInteger(value) && value >= 0;
const number = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new TypeError('Acoustic map: ' + message); };
export function validateAcousticMap(raw) {
  if (validated.has(raw)) return raw;
  const value = cloneMutableData(raw, { maxBytes: 131072, maxNodes: 16384 });
  if (!keys(value, ['schema', 'id', 'revision', 'zones', 'materialResponses', 'listener', 'controls', 'controlRateHz', 'maximumVoices', 'occlusion', 'stalePolicy']) || value.schema !== 'lemmings-acoustic-map/v1' || !id(value.id) || !natural(value.revision) || !Array.isArray(value.zones) || value.zones.length > 8 || !Array.isArray(value.materialResponses) || value.materialResponses.length > 8 || !number(value.controlRateHz, 5, 30) || !Number.isSafeInteger(value.maximumVoices) || value.maximumVoices < 1 || value.maximumVoices > 128 || value.stalePolicy !== 'hold-then-fade') fail('Use up to eight explicit world zones and128 admitted spatial voices.');
  const responses = new Set();
  for (const response of value.materialResponses) {
    if (!keys(response, ['id', 'exciterPatch', 'resonatorPatch', 'contactVariants', 'absorptionCurve', 'effectRecipe']) || !id(response.id) || responses.has(response.id) || !ORIGINAL_MATERIAL_PATCH_IDS.includes(response.exciterPatch) || !ORIGINAL_MATERIAL_PATCH_IDS.includes(response.resonatorPatch) || !keys(response.contactVariants, ['hard', 'soft', 'muted']) || ['hard', 'soft', 'muted'].some(kind => response.contactVariants[kind] !== kind) || !Array.isArray(response.absorptionCurve) || response.absorptionCurve.length < 2 || response.absorptionCurve.length > 8 || response.absorptionCurve.some((point, index) => !keys(point, ['frequencyHz', 'gain01']) || !number(point.frequencyHz, 20, 20000) || !number(point.gain01, 0, 1) || index && (point.frequencyHz <= response.absorptionCurve[index - 1].frequencyHz || point.gain01 > response.absorptionCurve[index - 1].gain01)) || !keys(response.effectRecipe, ['id', 'revision']) || !ACOUSTIC_ZONE_RECIPES.includes(response.effectRecipe.id) || response.effectRecipe.revision !== 1) fail('Responses need admitted original body names, explicit articulation, absorption units and a known effect recipe revision.');
    responses.add(response.id);
  }
  const zones = new Set();
  for (const zone of value.zones) {
    if (!keys(zone, ['zoneId', 'revision', 'worldRegion', 'priority', 'materialResponseId', 'receiverGroup', 'zoneSends', 'transitionDistancePixels', 'tailPolicy', 'enabled']) || !id(zone.zoneId) || zones.has(zone.zoneId) || !natural(zone.revision) || !Number.isSafeInteger(zone.priority) || Math.abs(zone.priority) > 10000 || !responses.has(zone.materialResponseId) || !id(zone.receiverGroup) || !Array.isArray(zone.zoneSends) || zone.zoneSends.length > 8 || zone.zoneSends.some(send => !keys(send, ['returnId', 'amount01']) || !responses.has(send.returnId) || !number(send.amount01, 0, 1)) || new Set(zone.zoneSends.map(send => send.returnId)).size !== zone.zoneSends.length || !number(zone.transitionDistancePixels, 0, 4096) || zone.tailPolicy !== 'retain-onset-return' || typeof zone.enabled !== 'boolean') fail('Zones need unique typed regions, priorities, sends, pixel borders and explicit retained-return ownership.');
    zone.worldRegion = validateWorldRegion(zone.worldRegion); zones.add(zone.zoneId);
  }
  const listener = value.listener;
  if (!keys(listener, ['mode', 'position', 'actorId', 'removedPolicy', 'panMode', 'panWidthPixels', 'referenceDistancePixels', 'rolloff', 'minimumGain01', 'coordinateScale']) || !['fixed-world', 'selected-actor', 'camera-follow'].includes(listener.mode) || !keys(listener.position, ['x', 'y']) || ![listener.position.x, listener.position.y].every(value => number(value, -10000000, 10000000)) || (listener.mode === 'selected-actor' ? !natural(listener.actorId) : listener.actorId != null) || !['hold-last', 'return-fixed'].includes(listener.removedPolicy) || !['equal-power-stereo', 'mono'].includes(listener.panMode) || !number(listener.panWidthPixels, 1, 1000000) || !number(listener.referenceDistancePixels, 1, 1000000) || !number(listener.rolloff, 0, 16) || !number(listener.minimumGain01, 0, 1) || listener.coordinateScale !== 'world-pixels') fail('The audio listener needs explicit coordinates, pixel curves and an independent follow policy.');
  if (!keys(value.controls, ['materialResponseId', 'absorb01', 'chamber01', 'borderPixels']) || value.controls.materialResponseId !== null && !responses.has(value.controls.materialResponseId) || !number(value.controls.absorb01, 0, 1) || !number(value.controls.chamber01, 0, 1) || value.controls.borderPixels !== null && !number(value.controls.borderPixels, 0, 4096)) fail('MATERIAL is a declared response choice; ABSORB/CHAMBER are normalized; BORDER is world pixels.');
  if (!keys(value.occlusion, ['enabled', 'maximumSamples', 'cellPixels', 'minimumGain01', 'closedLowpassHz']) || typeof value.occlusion.enabled !== 'boolean' || !Number.isSafeInteger(value.occlusion.maximumSamples) || value.occlusion.maximumSamples < 1 || value.occlusion.maximumSamples > 32 || !number(value.occlusion.cellPixels, 1, 256) || !number(value.occlusion.minimumGain01, 0, 1) || !number(value.occlusion.closedLowpassHz, 80, 16000)) fail('Coarse occlusion needs a bounded control-thread sampling profile.');
  const result = freezeData(value); validated.add(result); return result;
}
export function compileAcousticMap(raw) {
  const map = validateAcousticMap(raw), responses = new Map(map.materialResponses.map(response => [response.id, response])), zones = map.zones.filter(zone => zone.enabled).sort((a, b) => b.priority - a.priority || (a.zoneId < b.zoneId ? -1 : a.zoneId > b.zoneId ? 1 : 0));
  return Object.freeze({ map, responses, evaluate(position) {
    const members = [], sends = new Map(); let remaining = 1, selected = null;
    for (let i = 0; i < zones.length && remaining > 0;) {
      const priority = zones[i].priority, tier = []; let total = 0;
      while (i < zones.length && zones[i].priority === priority) {
        const zone = zones[i++], depth = worldRegionDepth(zone.worldRegion, position), width = map.controls.borderPixels ?? zone.transitionDistancePixels, weight = width ? Math.max(0, Math.min(1, 0.5 + depth / (2 * width))) : depth >= 0 ? 1 : 0;
        if (weight) { tier.push({ zone, weight, depth }); total += weight; }
      }
      const coverage = Math.min(1, total), scale = total ? remaining * coverage / total : 0;
      for (const { zone, weight, depth } of tier) {
        const blend01 = weight * scale, responseId = map.controls.materialResponseId || zone.materialResponseId;
        members.push({ zoneId: zone.zoneId, revision: zone.revision, priority, blend01, boundaryDistancePixels: depth, materialResponseId: responseId, receiverGroup: zone.receiverGroup });
        if (!selected || blend01 > selected.blend01) selected = members.at(-1);
        for (const send of zone.zoneSends) sends.set(send.returnId, (sends.get(send.returnId) || 0) + blend01 * send.amount01 * map.controls.chamber01);
      }
      remaining *= 1 - coverage;
    }
    return freezeData({ memberships: members, dryRemainder01: remaining, materialResponseId: selected?.materialResponseId || null, zoneSends: [...sends].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([returnId, amount01]) => ({ returnId, amount01: Math.min(1, amount01) })) });
  } });
}
