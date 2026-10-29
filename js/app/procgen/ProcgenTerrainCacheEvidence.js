import { hashSurveyValue } from './survey/ProcgenSurveyCanonical.js';

const owners = new WeakMap(), proofs = new WeakMap();
const fail = (code, kind, key) => { throw Object.assign(new Error('Generated terrain ' + kind + ' evidence is unverified at ' + String(key).slice(0, 96) + '.'),
  { name: 'SurveyStateProjectionError', code, cacheKind: kind, cacheKey: key }); };
const own = (value, key) => {
  const field = value && Object.getOwnPropertyDescriptor(value, key);
  if (field && !Object.hasOwn(field, 'value')) fail('accessor-terrain-evidence', 'data', key);
  return field?.value;
};
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const intrinsic = (prototype, key) => Function.prototype.call.bind(Object.getOwnPropertyDescriptor(prototype, key).get);
const viewType = intrinsic(typedPrototype, Symbol.toStringTag), typedBuffer = intrinsic(typedPrototype, 'buffer'), typedOffset = intrinsic(typedPrototype, 'byteOffset'), typedLength = intrinsic(typedPrototype, 'byteLength');
const dataBuffer = intrinsic(DataView.prototype, 'buffer'), dataOffset = intrinsic(DataView.prototype, 'byteOffset'), dataLength = intrinsic(DataView.prototype, 'byteLength');
const bufferLength = intrinsic(ArrayBuffer.prototype, 'byteLength');
const cacheHash = value => {
  let first = 0x811c9dc5, second = 0x9e3779b9, ordinal = 0; const seen = new WeakMap();
  const word = code => { first = Math.imul(first ^ code, 0x01000193); second = Math.imul(second ^ code, 0x85ebca6b); };
  const text = value => { const string = String(value); word(string.length); for (let index = 0; index < string.length; index++) word(string.charCodeAt(index)); };
  const bytes = (buffer, offset, length) => { const source = new Uint8Array(buffer, offset, length); word(length); for (let index = 0; index < length; index++) word(source[index]); };
  const visit = item => {
    text(typeof item);
    if (!item || typeof item !== 'object') { text(Object.is(item, -0) ? '-0' : item); return; }
    if (seen.has(item)) { text('reference'); word(seen.get(item)); return; } seen.set(item, ++ordinal);
    if (ArrayBuffer.isView(item)) {
      const type = viewType(item); text(type || 'DataView');
      if (type) bytes(typedBuffer(item), typedOffset(item), typedLength(item)); else bytes(dataBuffer(item), dataOffset(item), dataLength(item)); return;
    }
    if (item instanceof ArrayBuffer) { text('ArrayBuffer'); bytes(item, 0, bufferLength(item)); return; }
    if (item instanceof Map) { text('Map'); for (const [key, entry] of Map.prototype.entries.call(item)) { visit(key); visit(entry); } text('end'); return; }
    if (item instanceof Set) { text('Set'); for (const entry of Set.prototype.values.call(item)) visit(entry); text('end'); return; }
    if (Array.isArray(item)) { text('Array'); word(item.length); for (let index = 0; index < item.length; index++) visit(own(item, index)); return; }
    for (const key of Object.keys(item).sort()) {
      const entry = own(item, key); if (typeof entry === 'function') continue; text(key);
      if (key === 'piece' || key === 'image' || key === 'composite') for (const field of ['id', 'width', 'height']) visit(own(entry, field)); else visit(entry);
    }
    text('end');
  };
  visit(value); return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
};
const projection = value => {
  const seen = new WeakMap();
  const visit = (item, path) => {
    if (!item || typeof item !== 'object') return typeof item === 'function' ? undefined : item;
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return item;
    if (seen.has(item)) return { reference: seen.get(item) }; seen.set(item, path);
    if (item instanceof Map) return Array.from(Map.prototype.entries.call(item), ([key, entry], index) => [visit(key, path + '.key' + index), visit(entry, path + '.value' + index)]);
    if (item instanceof Set) return Array.from(Set.prototype.values.call(item), (entry, index) => visit(entry, path + '.' + index));
    if (Array.isArray(item)) return Array.from({ length: item.length }, (_, index) => visit(own(item, index), path + '.' + index));
    const result = {};
    for (const key of Object.keys(item).sort()) {
      const entry = own(item, key);
      if (key === 'piece' || key === 'image' || key === 'composite') result[key] = { id: own(entry, 'id'), width: own(entry, 'width'), height: own(entry, 'height') };
      else if (typeof entry !== 'function') result[key] = visit(entry, path + '.' + key);
    }
    return result;
  };
  return visit(value, 'root');
};
const context = terrain => {
  const recipe = own(terrain, 'recipe');
  return { recipeId: own(recipe, 'id'), assetSha256: own(recipe, 'assetSha256'), descriptorRevision: own(own(terrain, 'sourceDescriptor'), 'sourceRevision'),
    assemblyRevision: own(own(terrain, 'assemblyCatalog'), 'sourceRevision'), height: own(terrain, 'height'), chunkWidth: own(terrain, 'chunkWidth'),
    workstation: own(terrain, 'workstation'), hazardSpacing: own(terrain, 'hazardSpacing'), sharedSpanBudget: own(terrain, 'sharedSpanBudget') };
};
const tokenFor = owner => { let token = owners.get(owner); if (!token) { token = {}; owners.set(owner, token); } return token; };

export function initializeTerrainCacheEvidence(owner) { tokenFor(owner); }

// Proofs follow cache objects weakly; no retained cache entry keeps its world alive.
export function registerTerrainCacheEvidence(owner, kind, key, value, source = context(owner)) {
  proofs.set(value, { owner: tokenFor(owner), kind, key, source: hashSurveyValue(source), hash: cacheHash(value) });
  return value;
}

export function verifyTerrainCacheEvidence(owner, kind, entries, source = context(owner)) {
  const token = owners.get(owner), sourceHash = hashSurveyValue(source);
  for (const [key, value] of entries) {
    const proof = value && proofs.get(value);
    if (!proof || proof.owner !== token || proof.kind !== kind || proof.key !== key) fail('unverified-generated-terrain-cache', kind, key);
    if (proof.source !== sourceHash || proof.hash !== cacheHash(value)) fail('changed-generated-terrain-cache', kind, key);
  }
}

export function captureGeneratedTerrainEvidence(terrain) {
  const themes = own(terrain, 'themes');
  if (Array.isArray(themes)) return { kind: 'generated-pack-v1', height: own(terrain, 'height'), chunkWidth: own(terrain, 'chunkWidth'),
    assignments: projection(own(terrain, 'assignments')), laneAssignments: own(terrain, 'laneAssignments'), laneThemes: own(terrain, 'laneThemes'),
    themes: themes.map(theme => ({ familyId: own(theme, 'familyId'), styleName: own(theme, 'styleName'), terrain: captureGeneratedTerrainEvidence(own(theme, 'terrain')) })) };
  const descriptions = own(terrain, 'descriptions'), collision = own(terrain, 'collision'), growthPlans = own(terrain, 'growthPlans');
  if (!owners.has(terrain) || !(descriptions instanceof Map) || !(collision instanceof Map) || !(growthPlans instanceof Map)) return null;
  for (const [kind, cache] of [['description', descriptions], ['collision', collision], ['growth-plan', growthPlans]]) verifyTerrainCacheEvidence(terrain, kind, Map.prototype.entries.call(cache));
  const last = own(terrain, '_lastChunk'), key = own(terrain, '_lastKey');
  if (last && Map.prototype.get.call(collision, key) !== last) fail('unverified-generated-terrain-cache', 'last-collision', key);
  for (const field of ['zonePlanner', 'wideZonePlanner']) {
    const planner = own(terrain, field); if (!planner) continue;
    verifyTerrainCacheEvidence(planner, 'zone', Map.prototype.entries.call(own(planner, 'cache')), own(planner, 'revisionCode'));
  }
  return { kind: 'generated-recipe-v1', ...context(terrain), routeContracts: projection(own(terrain, 'routeContracts')) };
}
