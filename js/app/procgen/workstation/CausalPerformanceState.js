import { validateMaterialPalette } from '../../../midi/content/MaterialPalette.js';
import { validateTimeTransform } from '../../../midi/content/TimeTransform.js';
import { validateActorTimbreLocks, actorTimbreControls } from '../../../midi/content/InstrumentActorLocks.js';
import { validateScoreContextPolicy } from '../../../midi/content/ScoreContext.js';
import { validateOrganRotaryPolicy, validateOrganRotaryControls } from '../../../midi/content/OrganRotaryIntent.js';
import { validatePianoPerformancePolicy, validatePianoPartControls } from '../../../midi/content/PianoPerformanceIntent.js';
import { validateOrchestralArticulationPolicy } from '../../../midi/content/OrchestralArticulationIntent.js';
import { validatePercussionIntentPolicy } from '../../../midi/content/PercussionRoleIntent.js';
import { procgenLane, procgenLaneIndex } from './ProcgenProjectIndex.js';
import { INSTRUMENT_PHYSICAL_SOURCE_KINDS, validateInstrumentControls } from '../../../midi/content/InstrumentPerformance.js';
import { getSupportedInstrumentDefinition } from '../../../midi/content/SoundContentReference.js';

export const causalLanePhysicalControlKinds = entry => [...new Set([...(getSupportedInstrumentDefinition(entry?.instrumentRef)?.causalBindings || []).filter(binding => binding.mode === 'continuous' && binding.enabled !== false).map(binding => binding.sourceKind),
  ...(entry?.organ?.profiles !== 'organ' && entry?.organ?.rotarySource === 'cohort-circulation' ? ['MotionCommitted'] : []), ...(entry?.deviceParameters || []).flatMap(mapping => ['positionYWorldPixels', 'displacementPixels'].includes(mapping.source) ? ['MotionCommitted'] : mapping.source === 'changedSolidCells' ? ['TerrainWorkCommitted'] : [])])];

const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const validatedPerformance = new WeakSet();
const fail = () => { throw new TypeError('Invalid causal lane performance state.'); };
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const lane = value => {
  if (!keys(value, ['id', 'sourceIndex', 'materialPalette', 'controls', 'physicalSourceKinds', 'mix', 'percussion', 'orchestral', 'piano', 'pianoControls', 'organ', 'organControls', 'scoreContext', 'timeTransform']) || !identifier(value.id) || !Number.isSafeInteger(value.sourceIndex) || value.sourceIndex < 0 || value.sourceIndex >= 1024 ||
      !Array.isArray(value.physicalSourceKinds) || value.physicalSourceKinds.length > INSTRUMENT_PHYSICAL_SOURCE_KINDS.length ||
      new Set(value.physicalSourceKinds).size !== value.physicalSourceKinds.length || value.physicalSourceKinds.some(kind => !INSTRUMENT_PHYSICAL_SOURCE_KINDS.includes(kind))) fail();
  if (value.controls?.actorTimbreLocks != null) fail();
  if (value.mix != null && (!keys(value.mix, ['gain', 'pan', 'mute', 'solo']) || !Number.isFinite(value.mix.gain) || value.mix.gain < 0 || value.mix.gain > 2 || !Number.isFinite(value.mix.pan) || Math.abs(value.mix.pan) > 127 || typeof value.mix.mute !== 'boolean' || typeof value.mix.solo !== 'boolean')) fail();
  return Object.freeze({ id: value.id, sourceIndex: value.sourceIndex, ...(value.materialPalette ? { materialPalette: validateMaterialPalette(value.materialPalette) } : {}), ...(value.mix ? { mix: Object.freeze({ ...value.mix }) } : {}), ...(value.timeTransform ? { timeTransform: validateTimeTransform(value.timeTransform) } : {}), ...(value.scoreContext ? { scoreContext: validateScoreContextPolicy(value.scoreContext) } : {}), ...(value.organ ? { organ: validateOrganRotaryPolicy(value.organ) } : {}), ...(value.organControls ? { organControls: validateOrganRotaryControls(value.organControls) } : {}), ...(value.piano ? { piano: validatePianoPerformancePolicy(value.piano) } : {}), ...(value.pianoControls ? { pianoControls: validatePianoPartControls(value.pianoControls) } : {}), ...(value.orchestral ? { orchestral: validateOrchestralArticulationPolicy(value.orchestral) } : {}), ...(value.percussion ? { percussion: validatePercussionIntentPolicy(value.percussion) } : {}), controls: validateInstrumentControls(value.controls), physicalSourceKinds: Object.freeze([...value.physicalSourceKinds].sort()) });
};
export function validateCausalPerformanceState(value) {
  if (validatedPerformance.has(value)) return value;
  if (!keys(value, ['version', 'lanes', 'actorTimbreLocks']) || value.version !== 1 || !Array.isArray(value.lanes) || value.lanes.length > 1024) fail();
  const lanes = value.lanes.map(lane).sort((a, b) => a.sourceIndex - b.sourceIndex);
  if (new Set(lanes.map(entry => entry.id)).size !== lanes.length || lanes.some((entry, index) => entry.sourceIndex !== index)) fail();
  const actorTimbreLocks = validateActorTimbreLocks(value.actorTimbreLocks);
  const result = Object.freeze({ version: 1, lanes: Object.freeze(lanes), ...(actorTimbreLocks.length ? { actorTimbreLocks } : {}) }); validatedPerformance.add(result); return result;
}
export function captureCausalPerformanceState(lanes, actorTimbreLocks) {
  if (!Array.isArray(lanes) || lanes.length > 1024) fail();
  return validateCausalPerformanceState({ version: 1, actorTimbreLocks, lanes: lanes.map((entry, sourceIndex) => ({ id: entry.id, sourceIndex, ...(entry.materialPalette ? { materialPalette: entry.materialPalette } : {}), controls: entry.instrumentControls || {}, mix: { gain: entry.gain ?? 1, pan: entry.pan ?? 0, mute: !!entry.mute, solo: !!entry.solo },
    ...(entry.timeTransform ? { timeTransform: entry.timeTransform } : {}), ...(entry.scoreContext ? { scoreContext: entry.scoreContext } : {}), ...(entry.organ ? { organ: entry.organ } : {}), ...(entry.organControls ? { organControls: entry.organControls } : {}), ...(entry.piano ? { piano: entry.piano } : {}), ...(entry.pianoControls ? { pianoControls: entry.pianoControls } : {}), ...(entry.orchestral ? { orchestral: entry.orchestral } : {}), ...(entry.percussion ? { percussion: entry.percussion } : {}), physicalSourceKinds: causalLanePhysicalControlKinds(entry) })) });
}
export function diffCausalLanePerformance(before, after, ids) {
  const capture = (lanes, id) => {
    const entry = procgenLane(lanes, id); if (!entry) return null;
    return lane({ id, sourceIndex: procgenLaneIndex(lanes).get(id), ...(entry.materialPalette ? { materialPalette: entry.materialPalette } : {}), controls: entry.instrumentControls || {}, mix: { gain: entry.gain ?? 1, pan: entry.pan ?? 0, mute: !!entry.mute, solo: !!entry.solo },
      ...(entry.timeTransform ? { timeTransform: entry.timeTransform } : {}), ...(entry.scoreContext ? { scoreContext: entry.scoreContext } : {}), ...(entry.organ ? { organ: entry.organ } : {}), ...(entry.organControls ? { organControls: entry.organControls } : {}), ...(entry.piano ? { piano: entry.piano } : {}), ...(entry.pianoControls ? { pianoControls: entry.pianoControls } : {}), ...(entry.orchestral ? { orchestral: entry.orchestral } : {}), ...(entry.percussion ? { percussion: entry.percussion } : {}), physicalSourceKinds: causalLanePhysicalControlKinds(entry) });
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
  const locksChanged = JSON.stringify(before.actorTimbreLocks || []) !== JSON.stringify(after.actorTimbreLocks || []);
  return upserts.length || removed.length || locksChanged ? Object.freeze({ version: 1, upserts: Object.freeze(upserts), removed: Object.freeze(removed), ...(locksChanged ? { actorTimbreLocks: after.actorTimbreLocks || Object.freeze([]) } : {}) }) : null;
}
export function validateCausalPerformanceChange(change) {
  if (!keys(change, ['version', 'upserts', 'removed', 'actorTimbreLocks']) || change.version !== 1 || !Array.isArray(change.upserts) || change.upserts.length > 1024 || !Array.isArray(change.removed) || change.removed.length > 1024 ||
      change.removed.some(id => !identifier(id)) || new Set(change.removed).size !== change.removed.length) fail();
  const upserts = change.upserts.map(lane), replacements = new Set(upserts.map(entry => entry.id));
  if (replacements.size !== upserts.length || change.removed.some(id => replacements.has(id))) fail();
  return Object.freeze({ version: 1, upserts: Object.freeze(upserts), removed: Object.freeze([...change.removed]),
    ...(Object.hasOwn(change, 'actorTimbreLocks') ? { actorTimbreLocks: validateActorTimbreLocks(change.actorTimbreLocks) } : {}) });
}
export function createCausalPerformanceState(initial = { version: 1, lanes: [] }) {
  let state, byId, byIndex;
  const replace = value => { const next = validateCausalPerformanceState(value); state = next; byId = new Map(next.lanes.map(entry => [entry.id, entry])); byIndex = next.lanes; };
  replace(initial);
  const get = source => typeof source === 'number' ? byIndex[source] : byId.get(source);
  return Object.freeze({ snapshot: () => state, getLaneState: source => { const target = get(source), solo = state.lanes.some(lane => lane.mix?.solo && !lane.mix?.mute); return { available: !!target && !target.mix?.mute && (!solo || !!target.mix?.solo) }; }, getMix: source => get(source)?.mix || null, getControls: (source, identity) => actorTimbreControls(get(source)?.controls, state.actorTimbreLocks, identity), getTimeTransformPolicy: source => get(source)?.timeTransform || null, getScoreContextPolicy: source => get(source)?.scoreContext || null, getPianoPolicy: source => get(source)?.piano || null, getPianoControls: source => get(source)?.pianoControls || null, getOrchestralPolicy: source => get(source)?.orchestral || null, getPercussionPolicy: source => get(source)?.percussion || null, getPhysicalControlKinds: source => get(source)?.physicalSourceKinds || [],
    apply(change) {
      const validated = validateCausalPerformanceChange(change); if (validated.removed.some(id => !byId.has(id))) fail();
      const next = new Map(byId); for (const id of validated.removed) next.delete(id); for (const entry of validated.upserts) next.set(entry.id, entry);
      replace({ version: 1, lanes: [...next.values()], actorTimbreLocks: validated.actorTimbreLocks ?? state.actorTimbreLocks }); return state;
    }
  });
}
