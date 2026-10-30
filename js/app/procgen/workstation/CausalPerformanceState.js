import { procgenLane, procgenLaneIndex } from './ProcgenProjectIndex.js';
import { INSTRUMENT_PHYSICAL_SOURCE_KINDS, validateInstrumentControls } from '../../../midi/content/InstrumentPerformance.js';
import { getSupportedInstrumentDefinition } from '../../../midi/content/SoundContentReference.js';

const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = () => { throw new TypeError('Invalid causal lane performance state.'); };
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const lane = value => {
  if (!keys(value, ['id', 'sourceIndex', 'controls', 'physicalSourceKinds', 'mix']) || !identifier(value.id) || !Number.isSafeInteger(value.sourceIndex) || value.sourceIndex < 0 || value.sourceIndex >= 1024 ||
      !Array.isArray(value.physicalSourceKinds) || value.physicalSourceKinds.length > INSTRUMENT_PHYSICAL_SOURCE_KINDS.length ||
      new Set(value.physicalSourceKinds).size !== value.physicalSourceKinds.length || value.physicalSourceKinds.some(kind => !INSTRUMENT_PHYSICAL_SOURCE_KINDS.includes(kind))) fail();
  if (value.mix != null && (!keys(value.mix, ['gain', 'pan', 'mute', 'solo']) || !Number.isFinite(value.mix.gain) || value.mix.gain < 0 || value.mix.gain > 2 || !Number.isFinite(value.mix.pan) || Math.abs(value.mix.pan) > 127 || typeof value.mix.mute !== 'boolean' || typeof value.mix.solo !== 'boolean')) fail();
  return Object.freeze({ id: value.id, sourceIndex: value.sourceIndex, ...(value.mix ? { mix: Object.freeze({ ...value.mix }) } : {}), controls: validateInstrumentControls(value.controls), physicalSourceKinds: Object.freeze([...value.physicalSourceKinds].sort()) });
};
export function validateCausalPerformanceState(value) {
  if (!keys(value, ['version', 'lanes']) || value.version !== 1 || !Array.isArray(value.lanes) || value.lanes.length > 1024) fail();
  const lanes = value.lanes.map(lane).sort((a, b) => a.sourceIndex - b.sourceIndex);
  if (new Set(lanes.map(entry => entry.id)).size !== lanes.length || lanes.some((entry, index) => entry.sourceIndex !== index)) fail();
  return Object.freeze({ version: 1, lanes: Object.freeze(lanes) });
}
export function captureCausalPerformanceState(lanes) {
  if (!Array.isArray(lanes) || lanes.length > 1024) fail();
  return validateCausalPerformanceState({ version: 1, lanes: lanes.map((entry, sourceIndex) => ({ id: entry.id, sourceIndex, controls: entry.instrumentControls || {}, mix: { gain: entry.gain ?? 1, pan: entry.pan ?? 0, mute: !!entry.mute, solo: !!entry.solo },
    physicalSourceKinds: [...new Set((getSupportedInstrumentDefinition(entry.instrumentRef)?.causalBindings || []).filter(binding => binding.mode === 'continuous').map(binding => binding.sourceKind))] })) });
}
export function diffCausalLanePerformance(before, after, ids) {
  const capture = (lanes, id) => {
    const entry = procgenLane(lanes, id); if (!entry) return null;
    return lane({ id, sourceIndex: procgenLaneIndex(lanes).get(id), controls: entry.instrumentControls || {}, mix: { gain: entry.gain ?? 1, pan: entry.pan ?? 0, mute: !!entry.mute, solo: !!entry.solo },
      physicalSourceKinds: [...new Set((getSupportedInstrumentDefinition(entry.instrumentRef)?.causalBindings || []).filter(binding => binding.mode === 'continuous').map(binding => binding.sourceKind))] });
  };
  const upserts = [], removed = [];
  for (const id of ids) {
    const previous = capture(before, id), next = capture(after, id);
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    if (next) upserts.push(next); else if (previous) removed.push(id);
  }
  return upserts.length || removed.length ? validateCausalPerformanceChange({ version: 1, upserts, removed }) : null;
}
export function diffCausalPerformanceState(previous, next) {
  const before = validateCausalPerformanceState(previous), after = validateCausalPerformanceState(next), old = new Map(before.lanes.map(entry => [entry.id, entry])), ids = new Set(after.lanes.map(entry => entry.id));
  const upserts = after.lanes.filter(entry => JSON.stringify(old.get(entry.id)) !== JSON.stringify(entry)), removed = before.lanes.filter(entry => !ids.has(entry.id)).map(entry => entry.id);
  return upserts.length || removed.length ? Object.freeze({ version: 1, upserts: Object.freeze(upserts), removed: Object.freeze(removed) }) : null;
}
export function validateCausalPerformanceChange(change) {
  if (!keys(change, ['version', 'upserts', 'removed']) || change.version !== 1 || !Array.isArray(change.upserts) || change.upserts.length > 1024 || !Array.isArray(change.removed) || change.removed.length > 1024 ||
      change.removed.some(id => !identifier(id)) || new Set(change.removed).size !== change.removed.length) fail();
  const upserts = change.upserts.map(lane), replacements = new Set(upserts.map(entry => entry.id));
  if (replacements.size !== upserts.length || change.removed.some(id => replacements.has(id))) fail();
  return Object.freeze({ version: 1, upserts: Object.freeze(upserts), removed: Object.freeze([...change.removed]) });
}
export function createCausalPerformanceState(initial = { version: 1, lanes: [] }) {
  let state, byId, byIndex;
  const replace = value => { const next = validateCausalPerformanceState(value); state = next; byId = new Map(next.lanes.map(entry => [entry.id, entry])); byIndex = next.lanes; };
  replace(initial);
  const get = source => typeof source === 'number' ? byIndex[source] : byId.get(source);
  return Object.freeze({ snapshot: () => state, getLaneState: source => { const target = get(source), solo = state.lanes.some(lane => lane.mix?.solo && !lane.mix?.mute); return { available: !!target && !target.mix?.mute && (!solo || !!target.mix?.solo) }; }, getMix: source => get(source)?.mix || null, getControls: source => get(source)?.controls, getPhysicalControlKinds: source => get(source)?.physicalSourceKinds || [],
    apply(change) {
      const validated = validateCausalPerformanceChange(change); if (validated.removed.some(id => !byId.has(id))) fail();
      const next = new Map(byId); for (const id of validated.removed) next.delete(id); for (const entry of validated.upserts) next.set(entry.id, entry);
      replace({ version: 1, lanes: [...next.values()] }); return state;
    }
  });
}
