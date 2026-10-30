import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { validateInstrumentControls } from '../../../midi/content/InstrumentPerformance.js';
import { getSupportedInstrumentDefinition } from '../../../midi/content/SoundContentReference.js';
import { procgenLane, inheritProcgenLaneIndex } from './ProcgenProjectIndex.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key));
const fail = message => { throw new Error('Scene macro: ' + message); };

export function readSceneMacroControl(project, controlId) {
  const origin = project?.procgen?.sceneOrigin, scene = origin?.manifest, control = scene?.physicalControls.find(item => item.id === controlId), binding = control?.target.split(';')[0];
  if (!hash(origin?.sceneHash) || !binding?.startsWith('patch-macro:') || control.unit !== 'normalized' || control.minimum !== 0 || control.maximum !== 1) fail('Choose a normalized macro control declared by the current exact scene.');
  const macroId = binding.slice('patch-macro:'.length), targets = [];
  for (const patch of scene.patchRefs) {
    const authored = getSupportedInstrumentDefinition(patch.reference)?.macros?.find(macro => macro.id === macroId); if (!authored) continue;
    const lane = procgenLane(project.procgen.lanes, patch.laneId), reference = lane?.instrumentRef, macro = getSupportedInstrumentDefinition(reference)?.macros?.find(item => item.id === macroId);
    if (!lane || !reference || reference.packHash !== patch.reference.packHash || reference.definitionHash !== patch.reference.definitionHash || !macro || macro.mode !== 'onset-only') fail('An authored macro lane was replaced or no longer supports this control. Use its individual lane editor.');
    const baseline01 = lane.instrumentControls?.macros?.[macroId] ?? macro.default01;
    if (!Number.isFinite(baseline01) || baseline01 < 0 || baseline01 > 1) fail('A lane macro baseline is invalid.');
    targets.push({ laneId: lane.id, packHash: reference.packHash, definitionHash: reference.definitionHash, baseline01 });
  }
  if (!targets.length || targets.length > 8 || new Set(targets.map(target => target.laneId)).size !== targets.length) fail('This control requires one to eight unique exact authored lane targets.');
  return freezeData({ sceneHash: origin.sceneHash, controlId, macroId, targets, value01: targets.every(target => target.baseline01 === targets[0].baseline01) ? targets[0].baseline01 : null });
}

export function isSceneMacroAction(action) {
  return keys(action, ['type', 'sceneHash', 'controlId', 'value01', 'targets']) && action.type === 'procgen/sceneMacro' && hash(action.sceneHash) && typeof action.controlId === 'string' && action.controlId.length > 0 && action.controlId.length <= 128 && Number.isFinite(action.value01) && action.value01 >= 0 && action.value01 <= 1 && Array.isArray(action.targets) && action.targets.length > 0 && action.targets.length <= 8 && action.targets.every(target => keys(target, ['laneId', 'packHash', 'definitionHash', 'baseline01']) && typeof target.laneId === 'string' && target.laneId.length > 0 && target.laneId.length <= 128 && hash(target.packHash) && hash(target.definitionHash) && Number.isFinite(target.baseline01) && target.baseline01 >= 0 && target.baseline01 <= 1);
}

export function prepareSceneMacroAction(project, { sceneHash, controlId, value01 } = {}) {
  const binding = readSceneMacroControl(project, controlId);
  if (binding.sceneHash !== sceneHash || !Number.isFinite(value01) || value01 < 0 || value01 > 1) fail('The scene revision or normalized value changed.');
  return freezeData({ type: 'procgen/sceneMacro', sceneHash, controlId, value01, targets: binding.targets });
}

export function applySceneMacroAction(project, action) {
  if (!isSceneMacroAction(action)) fail('The bounded macro action is malformed.');
  const expected = prepareSceneMacroAction(project, action), limits = { maxBytes: 16384, maxNodes: 512 };
  if (canonicalDataText(action, limits).text !== canonicalDataText(expected, limits).text) fail('An exact target, baseline or source instrument changed.');
  const macroId = readSceneMacroControl(project, action.controlId).macroId, replacements = new Map();
  for (const target of action.targets) {
    const lane = procgenLane(project.procgen.lanes, target.laneId); if (target.baseline01 === action.value01) continue;
    if (!Number.isSafeInteger((lane.revision || 0) + 1)) fail('A lane revision is exhausted.');
    const instrumentControls = validateInstrumentControls({ ...lane.instrumentControls, macros: { ...lane.instrumentControls?.macros, [macroId]: action.value01 } });
    replacements.set(lane.id, { ...lane, instrumentControls, revision: (lane.revision || 0) + 1 });
  }
  if (!replacements.size) return project;
  const lanes = project.procgen.lanes.map(lane => replacements.get(lane.id) || lane); inheritProcgenLaneIndex(project.procgen.lanes, lanes);
  return { ...project, procgen: { ...project.procgen, lanes } };
}
