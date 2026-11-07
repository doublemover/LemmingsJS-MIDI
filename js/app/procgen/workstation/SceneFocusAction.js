import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { procgenLane, inheritProcgenLaneIndex } from './ProcgenProjectIndex.js';

const fail = message => { throw new Error('Scene focus: ' + message); }, finite = value => Number.isFinite(value) && value >= 0 && value <= 2;
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const gainsFor = (mix, value) => {
  if (value === 0.5) return mix.map(row => row.gain);
  const power = mix.reduce((sum, row) => sum + row.gain ** 2, 0), others = power - mix[0].gain ** 2, center = Math.atan2(Math.sqrt(others), mix[0].gain), angle = value <= 0.5 ? value * 2 * center : center + (value - 0.5) * 2 * (Math.PI / 2 - center);
  return mix.map((row, index) => index === 0 ? value === 1 ? 0 : Math.sqrt(power) * Math.cos(angle) : value === 0 ? 0 : row.gain / Math.sqrt(others) * Math.sqrt(power) * Math.sin(angle));
};
export function readSceneFocusControl(project, controlId) {
  const origin = project?.procgen?.sceneOrigin, control = origin?.manifest.physicalControls.find(control => control.id === controlId), mix = origin?.manifest.mix;
  if (!control?.target.startsWith('lane-focus:') || control.scope !== 'sound' || control.unit !== 'normalized' || control.minimum !== 0 || control.maximum !== 1 || !Array.isArray(mix) || mix.length < 2 || mix.length > 8 || mix.some(row => !finite(row.gain) || row.gain === 0) || control.target.split(';')[0].slice('lane-focus:'.length) !== mix[0].laneId) fail('Use the exact authored positive-gain scene lanes and normalized focus control.');
  const targets = mix.map(row => { const lane = procgenLane(project.procgen.lanes, row.laneId); if (!lane || !finite(lane.gain) || !Number.isSafeInteger(lane.revision || 0)) fail('An authored scene lane is missing or has an invalid level.'); return { laneId: row.laneId, revision: lane.revision || 0, baselineGain: lane.gain }; }), power = mix.reduce((sum, row) => sum + row.gain ** 2, 0), others = targets.slice(1).reduce((sum, row) => sum + row.baselineGain ** 2, 0), center = Math.atan2(Math.sqrt(power - mix[0].gain ** 2), mix[0].gain), angle = Math.atan2(Math.sqrt(others), targets[0].baselineGain), candidate = angle <= center ? angle / center / 2 : 0.5 + (angle - center) / (Math.PI / 2 - center) / 2, expected = gainsFor(mix, candidate), value01 = targets.every((row, index) => Math.abs(row.baselineGain - expected[index]) <= 1e-9) ? candidate : null;
  return freezeData({ sceneHash: origin.sceneHash, controlId, targets, value01, meaning: 'authored-lane-gain-power-preserved;not-measured-loudness;mute-solo-independent' });
}
export function prepareSceneFocusAction(project, { sceneHash, controlId, value01 } = {}) {
  const binding = readSceneFocusControl(project, controlId); if (binding.sceneHash !== sceneHash || !Number.isFinite(value01) || value01 < 0 || value01 > 1) fail('The scene or normalized value changed.');
  const gains = gainsFor(project.procgen.sceneOrigin.manifest.mix, value01); if (gains.some(gain => !finite(gain))) fail('The focus range exceeds the lane mixer.');
  return freezeData({ type: 'procgen/sceneFocus', sceneHash, controlId, value01, targets: binding.targets.map((target, index) => ({ ...target, gain: gains[index] })) });
}
export function applySceneFocusAction(project, action) {
  if (!keys(action, ['type', 'sceneHash', 'controlId', 'value01', 'targets']) || action.type !== 'procgen/sceneFocus' || !Array.isArray(action.targets) || action.targets.length < 2 || action.targets.length > 8 || action.targets.some(row => !keys(row, ['laneId', 'revision', 'baselineGain', 'gain']) || !finite(row.baselineGain) || !finite(row.gain))) fail('Keep the bounded complete focus command.');
  const expected = prepareSceneFocusAction(project, action); if (canonicalDataText(action, { maxBytes: 16384, maxNodes: 512 }).text !== canonicalDataText(expected, { maxBytes: 16384, maxNodes: 512 }).text) fail('An authored lane, level or revision changed.');
  const replacements = new Map();
  for (const target of action.targets) { if (target.gain === target.baselineGain) continue; const lane = procgenLane(project.procgen.lanes, target.laneId), revision = (lane.revision || 0) + 1; if (!Number.isSafeInteger(revision)) fail('A lane revision is exhausted.'); replacements.set(lane.id, { ...lane, gain: target.gain, revision }); }
  if (!replacements.size) return project; const lanes = project.procgen.lanes.map(lane => replacements.get(lane.id) || lane); inheritProcgenLaneIndex(project.procgen.lanes, lanes); return { ...project, procgen: { ...project.procgen, lanes } };
}
