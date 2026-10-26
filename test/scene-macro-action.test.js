import { expect } from 'chai';
import { prepareSceneMacroAction, applySceneMacroAction, readSceneMacroControl, isSceneMacroAction } from '../js/app/procgen/workstation/SceneMacroAction.js';
import { createSwitchyardScores } from '../js/app/procgen/workstation/SwitchyardScore.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { createMidiProject, sanitizeMidiProject, reduceMidiProject, sameMidiRuntimeInputs } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { procgenLaneIndex, procgenProjectChange } from '../js/app/procgen/workstation/ProcgenProjectIndex.js';
import { createPerformanceStageSession } from '../js/app/procgen/workstation/PerformanceStageSession.js';

const h = value => value.repeat(64), copy = value => JSON.parse(JSON.stringify(value));
describe('atomic authored scene macro actions (fixtures unrun)', () => {
  let project;
  before(async () => {
    const descriptors = await describeNativeInstrumentEngines([{ engineId: 'native-fm', engineVersion: 1, artifactHash: h('a') }]), [item] = await createSwitchyardScores({ sourceHash: h('b'), descriptor: descriptors.find(value => value.engineId === 'native-fm') }), scene = item.scene;
    const sceneOrigin = { schema: 'lemmings-performance-scene-origin/v1', manifest: scene, sceneHash: await performanceSceneHash(scene), recipe: item.recipe, variants: [] };
    project = sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject(), { seed: scene.seed, sceneOrigin, physicalGraph: scene.causalMappings, lanes: scene.patchRefs.map(patch => ({ id: patch.laneId, mode: 'physical', instrumentRef: patch.reference, patterns: [] })) }));
  });
  const request = (base, value01 = 0.8) => prepareSceneMacroAction(base, { sceneHash: base.procgen.sceneOrigin.sceneHash, controlId: 'snap', value01 });
  it('publishes all exact authored lane controls in one project edit and preserves physical/runtime inputs', () => {
    const original = JSON.stringify(project), index = procgenLaneIndex(project.procgen.lanes), action = request(project), after = reduceMidiProject(project, action), change = procgenProjectChange(project, after);
    expect(Object.isFrozen(action)).to.equal(true); expect(isSceneMacroAction(action)).to.equal(true); expect(action.targets).to.have.length(2); expect(change.fields).to.deep.equal(['instrumentControls']); expect(change.laneIds).to.deep.equal(action.targets.map(target => target.laneId)); expect(change.structural).to.equal(false);
    expect(after.procgen.revision).to.equal(project.procgen.revision + 1); expect(procgenLaneIndex(after.procgen.lanes)).to.equal(index); expect(sameMidiRuntimeInputs(project, after)).to.equal(true); expect(after.procgen.physicalGraph).to.equal(project.procgen.physicalGraph); expect(after.procgen.sceneOrigin).to.equal(project.procgen.sceneOrigin); expect(after.procgen.releaseGesture).to.equal(project.procgen.releaseGesture);
    for (let lane = 0; lane < 2; lane++) { expect(after.procgen.lanes[lane].instrumentControls.macros.snap).to.equal(0.8); expect(after.procgen.lanes[lane].instrumentRef).to.equal(project.procgen.lanes[lane].instrumentRef); expect(after.procgen.lanes[lane].patterns).to.equal(project.procgen.lanes[lane].patterns); expect(after.procgen.lanes[lane].revision).to.equal(project.procgen.lanes[lane].revision + 1); }
    expect(JSON.stringify(project)).to.equal(original); expect(reduceMidiProject(after, request(after))).to.equal(after);
  });
  it('reports mixed values and leaves unrelated lanes and macro controls intact', () => {
    const lanes = project.procgen.lanes.map((lane, index) => ({ ...lane, instrumentControls: { macros: { snap: index ? 0.4 : 0.6, 'unrelated-control': 0.2 } } })), unrelated = { ...lanes[0], id: 'unrelated-lane' }, base = { ...project, procgen: { ...project.procgen, lanes: [...lanes, unrelated] } };
    expect(readSceneMacroControl(base, 'snap').value01).to.equal(null); const after = applySceneMacroAction(base, request(base)); expect(after.procgen.lanes[2]).to.equal(unrelated); expect(after.procgen.lanes[0].instrumentControls.macros['unrelated-control']).to.equal(0.2); expect(after.procgen.lanes[1].instrumentControls.macros.snap).to.equal(0.8);
  });
  it('refuses a stale second target or exhausted revision before publishing any first-target change', () => {
    const action = request(project), changed = copy(project); changed.procgen.lanes[1].instrumentControls = { macros: { snap: 0.3 } }; const original = JSON.stringify(changed); expect(() => applySceneMacroAction(changed, action)).to.throw('baseline'); expect(JSON.stringify(changed)).to.equal(original);
    const exhausted = copy(project); exhausted.procgen.lanes[1].revision = Number.MAX_SAFE_INTEGER; const before = JSON.stringify(exhausted); expect(() => applySceneMacroAction(exhausted, request(exhausted))).to.throw('revision'); expect(JSON.stringify(exhausted)).to.equal(before); expect(exhausted.procgen.lanes[0].instrumentControls).to.deep.equal(project.procgen.lanes[0].instrumentControls);
  });
  it('rejects omitted/duplicate targets, source replacement, nonmacro controls and undeclared action fields', () => {
    const action = copy(request(project)), omitted = { ...action, targets: action.targets.slice(1) }, duplicate = { ...action, targets: [action.targets[0], action.targets[0]] };
    expect(() => applySceneMacroAction(project, omitted)).to.throw('target'); expect(() => applySceneMacroAction(project, duplicate)).to.throw('target'); expect(isSceneMacroAction({ ...action, patch: { worldThemeId: 'dirt' } })).to.equal(false);
    const replaced = copy(project); replaced.procgen.lanes[1].instrumentRef.definitionHash = h('d'); expect(() => request(replaced)).to.throw('replaced'); replaced.procgen.lanes[1].instrumentRef = null; expect(() => request(replaced)).to.throw('replaced'); expect(() => prepareSceneMacroAction(project, { ...action, controlId: 'spacing' })).to.throw('normalized macro'); expect(() => prepareSceneMacroAction(project, { ...action, sceneHash: h('e') })).to.throw('scene revision');
    for (const value01 of [-0.1, 1.1, NaN, Infinity]) expect(() => request(project, value01)).to.throw('normalized');
  });
  it('admits only the typed macro transaction during Stage and preserves its restrictions on other edits', () => {
    const stage = createPerformanceStageSession({ canEnter: () => true, getIdentity: () => 'fixture', setPresentation: () => {}, getCandidate: () => null, cancelCandidate: async () => {}, applyCandidate: async () => ({ status: 'unavailable' }) }); stage.enter();
    expect(stage.permitsCommand('performSceneMacro')).to.equal(true); expect(stage.permitsEdit(request(project))).to.equal(true); expect(stage.permitsEdit({ ...request(project), world: { seed: 1 } })).to.equal(false); expect(stage.permitsEdit({ type: 'procgen/lane', patch: { worldThemeId: 'dirt' } })).to.equal(false); stage.dispose();
  });
});
