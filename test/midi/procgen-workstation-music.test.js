import { expect } from 'chai';
import { createMidiProject, sanitizeMidiProject, reduceMidiProject } from '../../js/midi/project/MidiProject.js';
import { PROCGEN_SOUND_COLLECTIONS, PROCGEN_ROLES, resolveProcgenSound } from '../../js/app/procgen/workstation/ProcgenSoundCollections.js';
import { createProcgenWorkstationProject, createProcgenLane as createLane } from '../../js/app/procgen/workstation/ProcgenWorkstationProject.js';
import { createProcgenPatternEngine, procgenStepNotes } from '../../js/app/procgen/workstation/ProcgenPatternEngine.js';

const complementary = { mode: 'pattern', patternPurpose: 'Authored clocked accompaniment to physical gate and work instruments.' };
const createProcgenLane = (index = 0, overrides = {}) => createLane(index, { ...complementary, ...overrides });
const setup = (options = {}) => {
  const lanes = (options.lanes || Array.from({ length: 8 }, () => ({}))).map(lane => ({ ...complementary, ...lane }));
  let project = createProcgenWorkstationProject(createMidiProject({ enabled: true }), { ...options, lanes });
  const notes = [], launches = [];
  const engine = createProcgenPatternEngine({ getProject: () => project, emit: (spec, meta) => { notes.push({ spec, meta }); return { status: 'accepted', sinkId: 'test' }; }, onLaunch: value => launches.push(value), now: () => 1234 });
  const edit = action => { project = reduceMidiProject(project, action); };
  const beat = value => engine.onBeat({ beat: value, timestamp: value * 500, bpm: 120 });
  return { engine, notes, launches, edit, beat, get project() { return project; } };
};

describe('Procgen workstation musical domain', function() {
  it('migrates family-only lanes to independent sound, world, recipe and external mapping identities', () => {
    const legacy = createProcgenLane(0, { family: 'dirt', role: 'bass' }), sound = resolveProcgenSound('dirt', 'bass');
    expect(legacy).to.include({ worldThemeId: 'dirt', instrumentPatchId: sound.id, performanceRecipeId: sound.id, linkedThemePresetId: 'dirt', soundChangePolicy: 'new-notes-only', externalProgram: sound.program });
    const run = setup({ lanes: [{ family: 'dirt', role: 'bass', externalProgram: 77, externalPercussion: false, channel: 3 }] });
    run.edit({ type: 'procgen/palette', laneId: 'lane-1', family: 'fire', role: 'drums' });
    expect(run.project.procgen.lanes[0]).to.include({ family: 'fire', role: 'drums', worldThemeId: 'dirt', linkedThemePresetId: 'fire', externalProgram: 77, externalPercussion: false, channel: 3 });
    run.edit({ type: 'procgen/worldTheme', laneId: 'lane-1', worldThemeId: 'snow' }); expect(run.project.procgen.lanes[0]).to.include({ worldThemeId: 'snow', family: 'fire', externalProgram: 77 });
    expect(() => run.edit({ type: 'procgen/worldTheme', laneId: 'lane-1' })).to.throw('explicit');
    expect(sanitizeMidiProject(JSON.parse(JSON.stringify(run.project))).procgen.lanes[0]).to.include({ worldThemeId: 'snow', family: 'fire', externalProgram: 77, channel: 3 });
  });
  it('reanchors a queued launch to the accepted meter without changing the current phrase origin', () => {
    const run = setup({ lanes: [{}] }); run.beat(0.25);
    run.edit({ type: 'procgen/launch', laneId: 'lane-1', slot: 1 }); run.beat(0.5);
    expect(run.engine.snapshot().lanes['lane-1'].launchBeat).to.equal(4);
    run.edit({ type: 'transport.set', transport: { timeSignature: { beats: 7, unit: 8 } } }); run.beat(0.75);
    expect(run.engine.getLanePosition('lane-1').origin).to.equal(0);
    expect(run.engine.snapshot().lanes['lane-1'].launchBeat).to.equal(3.5);
    run.beat(3.5); expect(run.engine.getLanePosition('lane-1')).to.include({ slot: 1, origin: 3.5 });
  });
  it('shares untouched lanes, patterns and steps for canonical single-cell edits', () => {
    const project = sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject(),
      { lanes: Array.from({ length: 128 }, (_, index) => createProcgenLane(index)) }));
    const changed = reduceMidiProject(project, { type: 'procgen/step', laneId: project.procgen.lanes[0].id,
      slot: 0, index: 3, patch: { note: 44 } });
    expect(changed.procgen.lanes[1]).to.equal(project.procgen.lanes[1]);
    expect(changed.procgen.lanes[0].patterns[1]).to.equal(project.procgen.lanes[0].patterns[1]);
    expect(changed.procgen.lanes[0].patterns[0].steps[2]).to.equal(project.procgen.lanes[0].patterns[0].steps[2]);
    expect(reduceMidiProject(changed, { type: 'procgen/step', laneId: project.procgen.lanes[0].id,
      slot: 0, index: 3, patch: { note: 44 } })).to.equal(changed);
  });
  it('restores legacy spatial curves at each lane physical position and uses actual game-event coordinates', function() {
    let project = createProcgenWorkstationProject(createMidiProject(), { lanes: [createProcgenLane(0), createProcgenLane(1)] });
    for (const lane of project.procgen.lanes) for (const step of lane.patterns[0].steps) step.enabled = true;
    project = reduceMidiProject(project, { type: 'automation.add', automation: { id: 'legacy-height', axis: 'y', target: 'velocity', min: 20, max: 100,
      points: [{ beat: 0, value: 20 }, { beat: 0.5, value: 60 }, { beat: 1, value: 100 }] } });
    project = sanitizeMidiProject(JSON.parse(JSON.stringify(project)));
    const coordinates = [{ x: 25, y: 25, levelWidth: 100, levelHeight: 100 }, { x: 75, y: 75, levelWidth: 100, levelHeight: 100 }];
    const notes = [], options = { getProject: () => project, getLaneSpatialPosition: index => coordinates[index], emit: (spec, meta) => { notes.push({ spec, meta }); return { status: 'accepted', sinkId: 'test' }; } };
    const engine = createProcgenPatternEngine(options);
    engine.onBeat({ beat: 0, timestamp: 0, bpm: 120 });
    expect(notes.map(item => [item.meta.laneIndex, item.spec.velocity])).to.deep.equal([[0, 40], [1, 80]]);
    const restored = createProcgenPatternEngine(options); restored.restore(JSON.parse(JSON.stringify(engine.snapshot()))); notes.length = 0;
    coordinates[0].y = 50; coordinates[1].y = 0;
    restored.onBeat({ beat: 0.25, timestamp: 125, bpm: 120 });
    expect(notes.map(item => [item.meta.laneIndex, item.spec.velocity])).to.deep.equal([[0, 60], [1, 20]]);
    notes.length = 0;
    restored.onGameEvent({ laneIndex: 0, type: 'walk', x: 25, y: 100 });
    expect(notes).to.have.length(0);
    expect(restored.snapshot().lanes['lane-1'].observed.action).to.equal('walk');
    expect(project.automation[0].points).to.have.length(3);
  });

  it('makes soft patches audible while preserving edited steps and the global key', function() {
    const run = setup();
    run.edit({ type: 'procgen/global', patch: { scale: { root: 9, degrees: [0, 2, 4, 7, 9] } } });
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 0, patch: { enabled: true, velocity: 100, duration: 0.5 } });
    const before = JSON.parse(JSON.stringify(run.project.procgen.lanes[0].patterns));
    run.beat(0);
    const base = run.notes.find(item => item.meta.laneId === 'lane-1').spec;
    run.edit({ type: 'procgen/palette', laneId: 'lane-1', patch: 'crystal-lead-soft' });
    run.engine.reset(); run.notes.length = 0; run.beat(0);
    const soft = run.notes.find(item => item.meta.laneId === 'lane-1').spec;
    expect(soft.velocity).to.equal(72);
    expect(base.velocity).to.equal(100);
    expect(soft.durationMs).to.equal(base.durationMs * 1.3);
    expect(soft.note).to.equal(base.note);
    expect(run.project.global.scale.root).to.equal(9);
    expect(run.project.procgen.lanes[0].patterns).to.deep.equal(before);
  });

  it('preserves lookahead causal state on resumed pulses and refreshes tempo on duplicate beats', function() {
    const run = setup();
    run.beat(7 / 24);
    for (let i = 0; i < 5; i++) run.engine.onGameEvent({ laneIndex: 0, type: 'builder-step' });
    const before = run.engine.snapshot();
    run.engine.onBeat({ beat: 0.25, timestamp: 4000, bpm: 120, preserveAhead: true });
    expect(run.engine.snapshot()).to.deep.equal(before);
    run.engine.onBeat({ beat: 7 / 24, timestamp: 4020, bpm: 90, preserveAhead: true });
    expect(run.engine.snapshot().bpm).to.equal(90);
    expect(run.engine.snapshot().lanes).to.deep.equal(before.lanes);
  });

  it('evaluates fresh physical observations without waiting for another sound event', function() {
    const project = createProcgenWorkstationProject(createMidiProject(), { lanes: [createProcgenLane(0)] });
    for (const step of project.procgen.lanes[0].patterns[0].steps) { step.enabled = true; step.condition = { kind: 'terrain', value: 'gap' }; }
    let observation = { action: 'walk', terrain: 'ground' };
    const notes = [], engine = createProcgenPatternEngine({ getProject: () => project, getLaneObservation: () => observation, emit: spec => { notes.push(spec); return { status: 'accepted', sinkId: 'test' }; } });
    engine.onBeat({ beat: 0, timestamp: 0, bpm: 120 });
    expect(notes).to.have.length(0);
    observation = { action: 'fall', terrain: 'gap' };
    engine.onBeat({ beat: 0.25, timestamp: 125, bpm: 120 });
    expect(notes).to.have.length(1);
    observation = { action: 'walk', terrain: 'ground' };
    engine.onBeat({ beat: 0.5, timestamp: 250, bpm: 120 });
    expect(notes).to.have.length(1);
  });

  it('offers all 80 family-role combinations with playable and differentiated instruments', function() {
    expect(PROCGEN_SOUND_COLLECTIONS).to.have.length(10);
    const combinations = new Set();
    for (const family of PROCGEN_SOUND_COLLECTIONS) {
      expect(family.roles.map(role => role.id)).to.deep.equal(PROCGEN_ROLES);
      for (const role of family.roles) {
        const patch = resolveProcgenSound(family.id, role.id);
        expect(patch.program).to.be.within(0, 127);
        expect(patch.duration).to.be.greaterThan(0);
        expect(patch.eventResponse.action).to.be.a('string');
        combinations.add(JSON.stringify([patch.program, patch.octave, patch.velocity, patch.duration, patch.rhythm]));
        const lane = createProcgenLane(0, { family: family.id, role: role.id });
        const run = setup({ lanes: [lane] });
        for (let beat = 0; beat < 4; beat += 0.25) run.beat(beat);
        expect(run.notes.length, patch.id).to.be.greaterThan(0);
        expect(run.notes.every(note => note.spec.channel === (role.id === 'drums' ? 10 : 1))).to.equal(true);
      }
    }
    expect(combinations.size).to.equal(80);
  });

  it('retains canonical workstation data through normal reducer edits and project round trips', function() {
    const run = setup();
    expect(run.project.procgen.lanes.map(lane => `${lane.family}/${lane.role}`)).to.deep.equal(['crystal/lead', 'bubble/arp', 'dirt/bass', 'rock/percussion', 'fire/drums', 'brick/chords', 'snow/melody', 'pillar/texture']);
    expect(run.project.procgen.lanes.every(lane => lane.mode === 'pattern' && lane.patternPurpose && lane.patterns.length === 4 && lane.patterns[0].steps.length === 16)).to.equal(true);
    const original = run.project.procgen;
    run.edit({ type: 'transport.set', transport: { bpmBase: 133 } });
    expect(run.project.procgen).to.deep.equal(original);
    expect(sanitizeMidiProject(JSON.parse(JSON.stringify(run.project))).procgen).to.deep.equal(original);
  });

  it('preserves global key, edited notes, routing and mix when changing the sound collection', function() {
    const run = setup();
    run.edit({ type: 'global.update', patch: { scale: { root: 9, name: 'major', degrees: [0, 2, 4, 5, 7, 9, 11] } } });
    run.edit({ type: 'procgen/lane', laneId: 'lane-1', patch: { outputId: 'synth-1', channel: 9, gain: 0.4, pan: -45 } });
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 3, patch: { note: 45, probability: 0.62 } });
    const before = run.project.procgen.lanes[0];
    run.edit({ type: 'procgen/palette', laneId: 'lane-1', family: 'dirt', role: 'bass' });
    const after = run.project.procgen.lanes[0];
    expect(run.project.global.scale.root).to.equal(9);
    expect(after.patterns).to.deep.equal(before.patterns);
    expect([after.outputId, after.channel, after.gain, after.pan]).to.deep.equal(['synth-1', 9, 0.4, -45]);
    expect(after.patch).to.equal('dirt-bass');
  });

  it('sanitizes invalid data, preserves explicit hardware channels and keeps lane identifiers unique', function() {
    const run = setup({ seed: -1, lanes: [{ id: 'x', role: 'drums', channel: 2 }, { id: 'x', role: 'lead', channel: 10, patterns: [{ length: 999, rate: 0, steps: [{ probability: 7, repeats: 99 }] }] }] });
    expect(run.project.procgen.seed).to.equal(0);
    expect(run.project.procgen.lanes.map(lane => lane.id)).to.deep.equal(['x', 'x-copy']);
    expect(run.project.procgen.lanes[0].channel).to.equal(2);
    expect(run.project.procgen.lanes[1].channel).to.equal(10);
    expect(run.project.procgen.lanes[1].patterns[0].length).to.equal(64);
    expect(run.project.procgen.lanes[1].patterns[0].steps[0].probability).to.equal(1);
  });

  it('applies inversions and chord spread in the global scale', function() {
    const sound = { octave: 4, percussion: false };
    const scale = { root: 2, degrees: [0, 2, 4, 5, 7, 9, 11] };
    const step = { degree: 0, note: null, chord: { degrees: [0, 2, 4], inversion: 1, spread: 1 } };
    expect(procgenStepNotes(step, sound, scale)).to.deep.equal([66, 81, 74]);
  });

  it('retains 1000 independently configured lanes on import', function() {
    this.timeout(10000);
    const project = createProcgenWorkstationProject(createMidiProject(), { lanes: Array.from({ length: 1000 }, (_, index) => ({ id: `voice-${index}`, family: 'bubble', role: 'arp' })) });
    const restored = sanitizeMidiProject(JSON.parse(JSON.stringify(project)));
    expect(restored.procgen.lanes).to.have.length(1000);
    expect(restored.procgen.lanes[999].id).to.equal('voice-999');
    expect(restored.procgen.lanes[999].mode).to.equal('physical');
  });

  it('adds and removes lanes through the reducer and keeps seeds and global edits canonical', function() {
    const run = setup();
    run.edit({ type: 'procgen/addLane', lane: { family: 'snow', role: 'chords' } });
    expect(run.project.procgen.lanes[8].mode).to.equal('physical');
    expect(run.project.procgen.lanes[8].family).to.equal('snow');
    run.edit({ type: 'procgen/removeLane', laneId: 'lane-9' });
    expect(run.project.procgen.lanes).to.have.length(8);
    run.edit({ type: 'procgen/seed', seed: 987 });
    expect(run.project.procgen.seed).to.equal(987);
    run.edit({ type: 'procgen/global', patch: { scale: { root: 5, name: 'minor', degrees: [0, 2, 3, 5, 7, 8, 10] } } });
    expect(run.project.global.scale.root).to.equal(5);
    run.edit({ type: 'procgen/launched', laneId: 'lane-1', slot: 3 });
    expect(run.project.procgen.lanes[0].activeSlot).to.equal(3);
  });
});

describe('Procgen workstation authoritative pattern clock', function() {
  const lane = (mode = 'pattern') => createProcgenLane(0, { mode, family: 'crystal', role: 'lead', patterns: [{ length: 4, steps: Array.from({ length: 4 }, (_, degree) => ({ enabled: true, degree })) }] });

  it('advances only on beat callbacks, honors lane rates, and suppresses duplicate pulses', function() {
    const run = setup({ lanes: [lane(), { ...lane(), id: 'fast', patterns: [{ ...lane().patterns[0], rate: 2 }] }] });
    run.beat(0);
    expect(run.notes).to.have.length(2);
    for (let i = 0; i < 50; i++) run.engine.getState();
    run.beat(0); run.beat(1 / 24); run.beat(2 / 24);
    expect(run.notes).to.have.length(2);
    run.beat(3 / 24);
    expect(run.notes).to.have.length(3);
    run.beat(0.25);
    expect(run.notes).to.have.length(5);
  });

  it('skips missed cells without a burst and launches phrases only at bar boundaries', function() {
    const run = setup({ lanes: [lane()] });
    run.beat(0); run.beat(1);
    expect(run.notes).to.have.length(2);
    run.edit({ type: 'procgen/launch', laneId: 'lane-1', slot: 2 });
    run.beat(1.25); run.beat(3.75);
    expect(run.launches).to.have.length(0);
    run.beat(4);
    expect(run.launches).to.deep.equal([{ laneId: 'lane-1', slot: 2 }]);
    run.beat(8);
    expect(run.launches).to.have.length(1);
  });

  it('acknowledges simultaneous phrase launches in one project update', () => {
    let project = sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject(), {
      lanes: Array.from({ length: 128 }, (_, index) => createProcgenLane(index, { queuedSlot: 1, launchSerial: 1 }))
    }));
    const previous = project, batches = [];
    const engine = createProcgenPatternEngine({ getProject: () => project, onLaunchBatch: launches => {
      batches.push(launches);
      project = reduceMidiProject(project, { type: 'procgen/launchedBatch', launches });
    } });
    engine.onBeat({ beat: 0, timestamp: 0, bpm: 120 });
    expect(batches).to.have.length(1);
    expect(batches[0]).to.have.length(128);
    expect(project).not.to.equal(previous);
    expect(project.procgen.lanes.every(lane => lane.activeSlot === 1 && lane.queuedSlot == null)).to.equal(true);
    expect(reduceMidiProject(project, { type: 'procgen/launchedBatch', launches: batches[0] })).to.equal(project);
  });
  it('keeps sparse launch acknowledgments exact with duplicate, unknown, invalid and no-op targets', () => {
    const project = sanitizeMidiProject(createProcgenWorkstationProject(createMidiProject(), { lanes: Array.from({ length: 128 }, (_, index) => createProcgenLane(index)) }));
    const next = reduceMidiProject(project, { type: 'procgen/launchedBatch', launches: [{ laneId: 'foreign', slot: 1 }, { laneId: 'lane-1', slot: 1 }, { laneId: 'lane-1', slot: 2 }, { laneId: 'lane-2', slot: .5 }] });
    expect(next.procgen.lanes[0].activeSlot).to.equal(2); expect(next.procgen.lanes[1]).to.equal(project.procgen.lanes[1]); expect(next.procgen.lanes.at(-1)).to.equal(project.procgen.lanes.at(-1));
    expect(reduceMidiProject(next, { type: 'procgen/launchedBatch', launches: [{ laneId: 'lane-1', slot: 2 }, { laneId: 'lane-2', slot: -1 }, { laneId: 'foreign', slot: 0 }] })).to.equal(next);
  });

  it('keeps physical play outside the complementary pattern clock and never event-advances cells', function() {
    for (const mode of ['physical', 'pattern']) {
      const instrument = mode === 'physical' ? createLane(0) : lane();
      const run = setup({ lanes: [instrument] });
      run.beat(0);
      expect(run.notes.length).to.equal(mode === 'physical' ? 0 : 1);
      expect(run.engine.onGameEvent({ laneIndex: 0, type: 'build' })).to.equal(mode === 'pattern');
      expect(run.notes.filter(note => note.meta.source === 'game')).to.have.length(0);
    }
  });

  it('uses only observed terrain and action for conditions', function() {
    const run = setup({ lanes: [lane()] });
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 0, patch: { condition: { kind: 'action', value: 'dig' } } });
    run.beat(0);
    expect(run.notes).to.have.length(0);
    run.engine.onGameEvent({ laneIndex: 0, action: 'dig', terrainFamily: 'rock' });
    run.beat(1);
    expect(run.notes).to.have.length(1);
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 0, patch: { condition: { kind: 'terrain', value: 'snow' } } });
    run.beat(2);
    expect(run.notes).to.have.length(1);
  });

  it('keeps seeded probability deterministic across redraw reads and checkpoint restore', function() {
    const first = setup({ lanes: [lane()], seed: 9123 });
    const second = setup({ lanes: [lane()], seed: 9123 });
    for (const run of [first, second]) for (let index = 0; index < 4; index++) run.edit({ type: 'procgen/step', laneId: 'lane-1', index, patch: { probability: 0.5, repeats: 3 } });
    for (let pulse = 0; pulse <= 16; pulse++) {
      first.beat(pulse / 24); second.engine.getState(); second.beat(pulse / 24);
    }
    const checkpoint = first.engine.snapshot();
    expect(first.notes).to.deep.equal(second.notes);
    const restored = setup({ lanes: first.project.procgen.lanes, seed: 9123 });
    restored.engine.restore(checkpoint);
    first.notes.length = 0;
    for (let pulse = 17; pulse < 192; pulse++) { first.beat(pulse / 24); restored.beat(pulse / 24); }
    expect(restored.notes).to.deep.equal(first.notes);
    expect(restored.engine.snapshot()).to.deep.equal(first.engine.snapshot());
  });

  it('extends tied and held cells without retriggers and respects zero probability and bar conditions', function() {
    const run = setup({ lanes: [lane()] });
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 0, patch: { duration: 0.2, hold: true } });
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 1, patch: { tie: true, duration: 0.25 } });
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 2, patch: { enabled: false } });
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 3, patch: { probability: 0 } });
    for (let step = 0; step < 4; step++) run.beat(step * 0.25);
    expect(run.notes).to.have.length(1);
    expect(run.notes[0].spec.durationMs).to.equal(375);
    run.edit({ type: 'procgen/step', laneId: 'lane-1', index: 0, patch: { condition: { kind: 'bar', every: 2, offset: 1 } } });
    run.beat(1); expect(run.notes).to.have.length(1);
    run.beat(4); expect(run.notes).to.have.length(2);
  });

  it('honors solo, mute and zero gain and clears pending repeats on flush', function() {
    const run = setup({ lanes: [lane(), { ...lane(), id: 'muted', mute: true }, { ...lane(), id: 'solo', solo: true }] });
    run.edit({ type: 'procgen/step', laneId: 'solo', index: 0, patch: { repeats: 8 } });
    run.beat(0);
    expect(run.notes.map(note => note.meta.laneId)).to.deep.equal(['solo']);
    expect(run.engine.snapshot().pending).to.have.length(7);
    run.engine.flush(); run.beat(0.125);
    expect(run.notes).to.have.length(1);
    run.edit({ type: 'procgen/lane', laneId: 'solo', patch: { gain: 0 } });
    run.beat(0.25);
    expect(run.notes).to.have.length(1);
  });

  it('maintains every cell at the fastest rate on a 24 PPQN clock', function() {
    const run = setup({ lanes: [lane()] });
    run.edit({ type: 'procgen/pattern', laneId: 'lane-1', slot: 0, patch: { rate: 8 } });
    for (let pulse = 0; pulse < 25; pulse++) run.beat(pulse / 24);
    expect(run.notes).to.have.length(33);
    expect(run.notes[1].meta.beat).to.equal(1 / 32);
    expect(run.notes[1].spec.timeMs).to.equal(500 / 32);
  });

  it('bounds dense output and rotates fairly through 1024 lanes', function() {
    const run = setup({ lanes: Array.from({ length: 1024 }, (_, index) => ({ ...lane(), id: `voice-${index}` })) });
    for (let pulse = 0; pulse < 48; pulse++) {
      const before = run.notes.length;
      run.beat(pulse / 24);
      expect(run.notes.length - before).to.be.at.most(128);
    }
    expect(new Set(run.notes.map(note => note.meta.laneId)).size).to.equal(1024);
  });

  it('restores long note intent and resumes its remaining duration without advancing a cell', function() {
    const first = setup({ lanes: [lane()] });
    first.edit({ type: 'procgen/step', laneId: 'lane-1', index: 0, patch: { duration: 4 } });
    first.beat(0); first.beat(0.125);
    const restored = setup({ lanes: first.project.procgen.lanes });
    restored.engine.restore(first.engine.snapshot());
    restored.engine.resume({ beat: 0.125, timestamp: 5000, bpm: 120 });
    expect(restored.notes).to.have.length(1);
    expect(restored.notes[0].spec.durationMs).to.equal(1937.5);
    expect(restored.notes[0].spec.timeMs).to.equal(5000);
    expect(restored.notes[0].spec).to.include({ resumed: true });
    expect(restored.notes[0].spec.envelope).to.include({ attack: 0, decay: 0 });
    expect(restored.engine.snapshot()).to.deep.equal(first.engine.snapshot());
  });

  it('does not replay prior drum attacks and preserves attacks of future scheduled notes on resume', function() {
    const run = setup({ lanes: [createProcgenLane(0, { role: 'texture' }), createProcgenLane(1, { role: 'drums' })] });
    const activeNotes = [
      { spec: { note: 60, envelope: { attack: 0.7, decay: 0.2, sustain: 0.8 }, durationMs: 1000 }, meta: { laneId: 'lane-1', beat: 0.5 }, endBeat: 2 },
      { spec: { note: 36, percussion: true, durationMs: 1000 }, meta: { laneId: 'lane-2', beat: 0 }, endBeat: 2 },
      { spec: { note: 38, percussion: true, durationMs: 1000 }, meta: { laneId: 'lane-2', beat: 0.5 }, endBeat: 2 }
    ];
    run.engine.resume({ beat: 0.25, timestamp: 5000, bpm: 120, activeNotes });
    expect(run.notes.map(item => item.spec.note)).to.deep.equal([60, 38]);
    expect(run.notes[0].spec).to.include({ resumed: false, timeMs: 5125 });
    expect(run.notes[0].spec.envelope.attack).to.equal(0.7);
    expect(run.notes[1].spec.resumed).to.equal(false);
  });

  it('persists bank selection and suppresses disabled action families while observing them', function() {
    const run = setup({ lanes: [lane()] });
    run.edit({ type: 'procgen/lane', laneId: 'lane-1', patch: { bankMSB: 4, bankLSB: 32, eventMask: { build: false, mine: true } } });
    run.engine.onGameEvent({ laneIndex: 0, type: 'lemming-build' });
    expect(run.notes).to.have.length(0);
    expect(run.engine.snapshot().lanes['lane-1'].observed.action).to.equal('lemming-build');
    run.engine.onGameEvent({ laneIndex: 0, type: 'lemming-mine' });
    run.beat(0);
    expect(run.notes).to.have.length(1);
    expect([run.notes[0].spec.bankMSB, run.notes[0].spec.bankLSB]).to.deep.equal([4, 32]);
  });

  it('plays and checkpoints deduplicated beat and observed-distance CC curves', function() {
    const project = createProcgenWorkstationProject(createMidiProject(), { lanes: [{ ...lane(), ccAutomation: [
      { id: 'beat', controller: 74, length: 4, points: [{ beat: 0, value: 0 }, { beat: 4, value: 100 }] },
      { id: 'distance', controller: 1, axis: 'distance', length: 100, points: [{ beat: 0, value: 10 }, { beat: 100, value: 110 }] }
    ] }] });
    const events = []; let distance = 0;
    const engine = createProcgenPatternEngine({ getProject: () => project, emitCC: event => { events.push(event); return { status: 'accepted', sinkId: 'test' }; }, getLaneDistance: () => distance });
    engine.onBeat({ beat: 0, timestamp: 100, bpm: 120 });
    expect(events.map(event => [event.controller, event.value])).to.deep.equal([[74, 0], [1, 10]]);
    distance = 50; engine.onBeat({ beat: 2, timestamp: 1100, bpm: 120 });
    expect(events.slice(2).map(event => [event.controller, event.value])).to.deep.equal([[74, 50], [1, 60]]);
    const restored = createProcgenPatternEngine({ getProject: () => project, emitCC: event => { events.push(event); return { status: 'accepted', sinkId: 'test' }; }, getLaneDistance: () => distance });
    restored.restore(engine.snapshot());
    restored.onBeat({ beat: 2.001, timestamp: 1100.5, bpm: 120 });
    expect(events).to.have.length(4);
  });

  it('retries rejected constant CC values and never resumes rejected notes', function() {
    const project = createProcgenWorkstationProject(createMidiProject(), { lanes: [{ ...lane(), ccAutomation: [
      { id: 'constant', controller: 74, length: 4, points: [{ beat: 0, value: 64 }] }
    ] }] });
    let admit = false, noteAttempts = 0, ccAttempts = 0, route = 'one';
    const engine = createProcgenPatternEngine({ getProject: () => project,
      getSinkKey: () => route,
      emit: () => { noteAttempts++; return { status: admit ? 'accepted' : 'rejected', sinkId: 'test' }; },
      emitCC: () => { ccAttempts++; return { status: admit ? 'accepted' : 'rejected', sinkId: 'test' }; }
    });
    engine.onBeat({ beat: 0, timestamp: 0, bpm: 120 });
    engine.onGameEvent({ laneIndex: 0, type: 'builder-step' });
    expect(noteAttempts).to.equal(1);
    expect(engine.snapshot().active).to.have.length(0);
    expect(engine.snapshot().lanes['lane-1'].cc).to.deep.equal({});
    engine.resume({ beat: 0, timestamp: 10, bpm: 120 });
    expect(noteAttempts).to.equal(1);
    admit = true;
    engine.onBeat({ beat: 1 / 24, timestamp: 20, bpm: 120 });
    expect(ccAttempts).to.equal(2);
    expect(engine.snapshot().lanes['lane-1'].cc['constant:null:1:74']).to.equal(64);
    engine.onGameEvent({ laneIndex: 0, type: 'builder-step' });
    engine.onBeat({ beat: 0.25, timestamp: 30, bpm: 120 });
    expect(engine.snapshot().active).to.have.length(1);
    route = 'two';
    engine.onBeat({ beat: 7 / 24, timestamp: 40, bpm: 120 });
    expect(ccAttempts).to.equal(3);
  });

  it('treats missing, untyped, and throwing sink responses as rejected', function() {
    const project = createProcgenWorkstationProject(createMidiProject(), { lanes: [lane()] });
    for (const emit of [undefined, () => 1, () => { throw new Error('sink gone'); }]) {
      const engine = createProcgenPatternEngine({ getProject: () => project, emit });
      engine.onBeat({ beat: 0, timestamp: 0, bpm: 120 });
      engine.onGameEvent({ laneIndex: 0, type: 'builder-step' });
      expect(engine.snapshot().active).to.have.length(0);
    }
  });

  it('applies legacy beat spans to clocked notes using shared lane priority and duration semantics', function() {
    const run = setup({ lanes: [lane(), { ...lane(), id: 'other' }] });
    for (const [id, target, min] of [['quiet', 'velocity', 30], ['transpose', 'note', -12], ['length', 'duration', 10]]) run.edit({ type: 'automation.add', automation: {
      id, target, min, max: min, span: { domain: 'beats', start: 0, duration: 4, laneScope: 'lane', laneStart: 0 }
    } });
    run.beat(0);
    const transformed = run.notes.find(note => note.meta.laneId === 'lane-1').spec;
    const unchanged = run.notes.find(note => note.meta.laneId === 'other').spec;
    expect(transformed.velocity).to.equal(30);
    expect(transformed.note).to.equal(unchanged.note - 12);
    expect(transformed.durationMs).to.equal(600);
    expect(run.engine.getAutomationSpanState('quiet', 0).resolution.won).to.equal(true);
  });

  it('preserves legacy span source/event counters and actual event distances through a checkpoint', function() {
    const run = setup({ lanes: [{ ...lane(), eventAccent: 1 }] });
    run.edit({ type: 'automation.add', automation: { id: 'distance-events', target: 'velocity', min: 30, max: 30,
      span: { domain: 'distance', start: 100, duration: 50, condition: { sfxId: 42, unit: 'event', every: 2, phase: 0 } } } });
    run.engine.onGameEvent({ laneIndex: 0, type: 'walk', sfxId: 42, x: 120 });
    expect(run.engine.getAutomationSpanState('distance-events', 0).active).to.equal(false);
    const emitted = [], restored = createProcgenPatternEngine({ getProject: () => run.project, emit: (spec, meta) => { emitted.push({ spec, meta }); return { status: 'accepted', sinkId: 'test' }; }, now: () => 1234 });
    restored.restore(run.engine.snapshot()); run.notes.length = 0;
    for (const engine of [run.engine, restored]) engine.onGameEvent({ laneIndex: 0, type: 'walk', sfxId: 42, x: 120 });
    expect(emitted).to.deep.equal(run.notes);
    expect(restored.getAutomationSpanState('distance-events', 0)).to.include({ active: true, eventCount: 2, distance: 120 });
    restored.onGameEvent({ laneIndex: 0, type: 'walk', sfxId: 42, x: 180 });
    expect(restored.getAutomationSpanState('distance-events', 0).active).to.equal(false);
  });
});
