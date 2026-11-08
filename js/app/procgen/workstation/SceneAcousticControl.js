import { freezeData } from '../../../core/CanonicalData.js';
import { validateAcousticMap } from '../../../midi/content/AcousticMap.js';
import { validateCausalInstrumentGraph } from './CausalMusicEngine.js';

const fail = message => { throw new Error('Scene acoustic control: ' + message); };
export function readSceneAcousticControl(project, controlId) {
  const origin = project?.procgen?.sceneOrigin, control = origin?.manifest.physicalControls.find(control => control.id === controlId), map = project?.procgen?.physicalGraph?.acousticMap, field = control?.target.split(';')[0].slice('acoustic-map:'.length);
  if (!origin || !control?.target.startsWith('acoustic-map:') || control.scope !== 'sound' || !map || !['materialResponseId', 'absorb01', 'chamber01', 'borderPixels'].includes(field) || map.id !== origin.manifest.causalMappings.acousticMap?.id) fail('Choose a control from the current authored map.');
  const values = [null, ...origin.manifest.causalMappings.acousticMap.materialResponses.map(response => response.id)], value = field === 'materialResponseId' ? values.indexOf(map.controls.materialResponseId) : map.controls[field] ?? control.initial;
  if (field === 'materialResponseId' && value < 0) fail('This response is outside the authored scene choices.');
  return freezeData({ sceneHash: origin.sceneHash, controlId, mapId: map.id, mapRevision: map.revision, graphRevision: project.procgen.physicalGraph.revision, field, value, materialChoices: field === 'materialResponseId' ? values : null });
}
export function prepareSceneAcousticControl(project, input) {
  const state = readSceneAcousticControl(project, input?.controlId), control = project.procgen.sceneOrigin.manifest.physicalControls.find(control => control.id === input.controlId), value = input.value;
  if (input.sceneHash !== state.sceneHash || input.mapId !== state.mapId || input.mapRevision !== state.mapRevision || input.graphRevision !== state.graphRevision || !Number.isFinite(value) || value < control.minimum || value > control.maximum || Math.abs((value - control.minimum) / control.step - Math.round((value - control.minimum) / control.step)) > 1e-7) fail('The scene, source revision or authored value changed.');
  if (value === state.value) return null;
  const graph = project.procgen.physicalGraph, map = graph.acousticMap, next = state.field === 'materialResponseId' ? state.materialChoices[value] : value;
  if (state.field === 'materialResponseId' && next === undefined) fail('Choose a declared response index.');
  const acousticMap = validateAcousticMap({ ...map, revision: map.revision + 1, controls: { ...map.controls, [state.field]: next } });
  return freezeData({ type: 'procgen/physicalGraph', graph: validateCausalInstrumentGraph({ ...graph, revision: graph.revision + 1, acousticMap }) });
}
