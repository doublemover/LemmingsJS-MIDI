import { expect } from 'chai';
import { createMidiProject, sanitizeMidiProject, reduceMidiProject } from '../js/midi/project/MidiProject.js';
import { createProcgenWorkstationProject, createProcgenLane, sanitizeProcgenWorkstation,
  convertLegacyProcgenWorkstationProject } from '../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { createProcgenPatternEngine } from '../js/app/procgen/workstation/ProcgenPatternEngine.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

describe('physical-first project boundary', () => {
  it('creates four authored phrases on explicit mode entry and retains them only within the same mode', () => {
    let project = sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject(), { lanes: [createProcgenLane(0)] }));
    expect(project.procgen.lanes[0].patterns).to.have.length(0);
    expect(() => reduceMidiProject(project, { type: 'procgen/lane', laneId: 'lane-1', patch: { mode: 'pattern' } })).to.throw('explicit physical purpose');
    project = reduceMidiProject(project, { type: 'procgen/lane', laneId: 'lane-1', patch: { mode: 'pattern', patternPurpose: 'A complementary clocked response to committed physical events' } });
    const patterns = project.procgen.lanes[0].patterns;
    expect(patterns).to.have.length(4); expect(patterns.every(pattern => pattern.steps.length === 16)).to.equal(true);
    project = reduceMidiProject(project, { type: 'procgen/lane', laneId: 'lane-1', patch: { gain: 0.5 } });
    expect(project.procgen.lanes[0].patterns).to.equal(patterns);
    project = reduceMidiProject(project, { type: 'procgen/lane', laneId: 'lane-1', patch: { mode: 'physical', patterns: [], patternPurpose: null } });
    expect(project.procgen.lanes[0].patterns).to.have.length(0);
    expect(project.procgen.lanes[0].mode).to.equal('physical');
  });
  it('creates a declared graph with no required pattern cells and roundtrips its numeric precision', () => {
    let project = createProcgenWorkstationProject(createMidiProject(), { seed: 5 });
    expect(project.procgen).to.include({ version: 2, playModel: 'physical-v1', seed: 5 });
    expect(project.procgen.lanes.every(lane => lane.mode === 'physical' && lane.patterns.length === 0)).to.equal(true);
    const changedGraph = { ...project.procgen.physicalGraph, revision: 2,
      instruments: project.procgen.physicalGraph.instruments.map(item => ({ ...item, pitchCents: 6012.3456789, probability01: 0.3333333333333333 })) };
    project = reduceMidiProject(sanitizeMidiProject(project), { type: 'procgen/physicalGraph', graph: changedGraph });
    expect(sanitizeMidiProject(JSON.parse(JSON.stringify(project))).procgen.physicalGraph).to.deep.equal(project.procgen.physicalGraph);
    expect(project.procgen.physicalGraph.instruments[0].pitchCents).to.equal(6012.3456789);
    expect(() => reduceMidiProject(project, { type: 'procgen/physicalGraph', graph: { ...changedGraph, instruments: [] } })).to.throw('newer graph revision');
  });

  it('makes the golden startup crossing audible in the semantic stream without a transport pulse', async () => {
    const masks = await loadProcgenMasks(), project = createProcgenWorkstationProject(createMidiProject());
    const world = new ProcgenLaneWorld({ masks, assists: false }), intents = [];
    const engine = createCausalMusicEngine({ getGraph: () => project.procgen.physicalGraph,
      deliver: batch => intents.push(...batch) });
    world.soundEvents.onBatch.on(batch => engine.processBatch(batch));
    for (let tick = 0; tick < 50; tick++) world.step();
    expect(intents.some(intent => intent.kind === 'begin' && intent.mappingId === 'first-crossing')).to.equal(true);
    expect(project.procgen.lanes.flatMap(lane => lane.patterns)).to.have.length(0);
    const gridNotes = [], pattern = createProcgenPatternEngine({ getProject: () => project, emit: spec => gridNotes.push(spec) });
    pattern.onBeat({ beat: 0, bpm: 120, timestamp: 1000 });
    expect(pattern.onGameEvent({ laneIndex: 0, type: 'builder-step' })).to.equal(false);
    expect(gridNotes).to.have.length(0);
    world.dispose();
  });

  it('refuses legacy imports and exposes a reviewable conversion that leaves the original untouched', () => {
    const original = { ...createMidiProject(), procgen: { version: 1, seed: 9, lanes: [{ id: 'old', mode: 'game',
      patterns: [{ steps: [{ enabled: true }, { enabled: false }, { enabled: true }] }] }] } };
    const before = JSON.stringify(original);
    expect(() => sanitizeMidiProject(original)).to.throw('explicit physical conversion');
    expect(() => sanitizeProcgenWorkstation({ version: 9 })).to.throw('explicit physical conversion');
    expect(() => convertLegacyProcgenWorkstationProject(original)).to.throw('Choose the explicit');
    const result = convertLegacyProcgenWorkstationProject(original, { strategy: 'physical-default' });
    expect(result.report).to.include({ fromVersion: 1, toVersion: 2, discardedEnabledSteps: 2 });
    expect(result.report.laneChanges[0]).to.include({ laneId: 'old', sourceMode: 'game', targetMode: 'physical', removedEnabledSteps: 2, localSound: 'supported-native-alias', externalRouting: 'retained' });
    expect(result.report.laneChanges[0].replacedFields).to.deep.equal(['mode', 'patterns', 'patternPurpose']);
    expect(result.project.procgen.lanes[0]).to.include({ id: 'old', mode: 'physical' });
    expect(result.project.procgen.lanes[0].patterns).to.have.length(0);
    expect(JSON.stringify(original)).to.equal(before);
  });

  it('rejects custom inline definitions and unknown legacy aliases before defaulting any instrument data', () => {
    const custom = { id: 'original', family: 'user-foundry', role: 'lead', patch: 'my-body@7', patchDefinition: { schemaVersion: 2, id: 'my-body', revision: 7, parameters: { shape: 'original' } } };
    const original = JSON.stringify(custom);
    expect(() => createProcgenLane(0, custom)).to.throw('patchDefinition'); expect(JSON.stringify(custom)).to.equal(original);
    for (const lane of [custom, { family: 'user-foundry' }, { role: 'future-role' }, { family: 'crystal', role: 'lead', patch: 'unknown-revision' }, { channel: 17 }, { externalProgram: 128 }, { bankMSB: -1 }, { outputId: {} }]) {
      const project = { ...createMidiProject(), procgen: { version: 1, lanes: [lane] } }, before = JSON.stringify(project); let error;
      try { convertLegacyProcgenWorkstationProject(project, { strategy: 'physical-default' }); } catch (failure) { error = failure; }
      expect(error?.code).to.equal('legacy-instrument-review-required'); expect(error.fields.length).to.be.greaterThan(0); expect(JSON.stringify(project)).to.equal(before);
    }
  });

  it('retains explicit valid external routing through the declared local-sound conversion', () => {
    const lane = { id: 'routed', family: 'crystal', role: 'lead', patch: 'crystal-lead', externalProgram: 27, channel: 3, bankMSB: 4, bankLSB: 9, outputId: 'reviewed:route' };
    const converted = convertLegacyProcgenWorkstationProject({ ...createMidiProject(), procgen: { version: 1, lanes: [lane] } }, { strategy: 'physical-default' });
    expect(converted.project.procgen.lanes[0]).to.include({ externalProgram: 27, channel: 3, bankMSB: 4, bankLSB: 9, outputId: 'reviewed:route' });
    expect(converted.report.laneChanges[0].externalRouting).to.equal('retained');
  });

  it('requires an authored purpose for complementary patterns and rejects silent graph reconstruction', () => {
    expect(() => createProcgenLane(0, { mode: 'pattern' })).to.throw('explicit physical purpose');
    expect(() => createProcgenLane(0, { mode: 'game' })).to.throw('explicit physical conversion');
    const project = createProcgenWorkstationProject(createMidiProject(), { lanes: [createProcgenLane(0,
      { mode: 'pattern', patternPurpose: 'A clocked response underneath physical gate percussion.' })] });
    expect(project.procgen.lanes[0].patterns).to.have.length(4);
    expect(() => sanitizeProcgenWorkstation({ ...project.procgen, physicalGraph: null })).to.throw('requires its instrument graph');
  });
});
