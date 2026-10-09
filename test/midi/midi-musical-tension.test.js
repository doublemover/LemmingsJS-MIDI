import { expect } from 'chai';
import { MidiLaneMusicTension } from '../../js/midi/router/MidiLaneMusicTension.js';
import { DEFAULT_MIDI_ENSEMBLE_TENSION, sanitizeMidiEnsembleTension } from '../../js/midi/project/MidiEnsembleTension.js';
import { createMidiProject, reduceMidiProject, projectToMidiConfig, importMidiProjectPayload, stringifyMidiProjectExport } from '../../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
const settings = { ...DEFAULT_MIDI_ENSEMBLE_TENSION, healthyTicks: 2, fadeTicks: 10 };
const signal = (alive = 10, extra = {}) => ({ alive, peakAlive: 10, spawned: 10, lowestSurvivingActorId: 0,
  maxX: 100, bestDistance: 64, previousDistance: 0, ...extra });
const healthy = model => { model.synchronize(1, 0); model.updateLane(0, signal(), 0); model.updateLane(0, signal(), 2); };
const note = { ensembleRole: 'bass', note: 45, channel: 2, program: 38, velocity: 90, durationTicks: 4 };
const meta = (actor = 1) => ({ laneIndex: 0, lemmingId: actor, sfxId: 4 });
const fresh = () => applyGameEventMidiPreset(createMidiProject(), 'game-iron-ensemble');
const withRuntime = (run, local = true) => withFakeClockAndPerformance(clock => {
  let project = reduceMidiProject(fresh(), { type: 'enabled.set', enabled: true });
  project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: { healthyTicks: 1, fadeTicks: 2 } });
  const calls = [], output = makeOutput([1, 2, 3, 4, 10], calls, local ? 'fake-local' : 'fake-external');
  if (local) { output.supportsPerNoteInstrument = true; output.supportsPerNotePan = true; }
  for (const channel of Object.values(output.channels)) channel.sendProgramChange = value => calls.push({ type: 'program', value });
  let tick = 0; const listeners = new Set();
  const timer = { TIME_PER_FRAME_MS: 60, frameTime: 60, tps: 1000 / 60, speedFactor: 1, getGameTicks: () => tick,
    onGameTick: { on: fn => listeners.add(fn), off: fn => listeners.delete(fn) } };
  const world = { laneCount: 1, generation: 1, signal: signal(8), getGameTimer: () => timer, getLaneMusicSignals() { return this.signal; } };
  const router = new MidiEventRouter(projectToMidiConfig(project)); router.setOutput(output); router.attach(null, { game: world });
  const advance = at => { tick = at; for (const fn of listeners) fn(); };
  try { advance(0); advance(1); run({ router, world, project, timer, calls, clock, advance }); }
  finally { router.dispose(); }
});
describe('population musical tension', function() {
  it('persists editable policy and bypasses legacy saved ensembles without changing chosen music', function() {
    let project = fresh(); expect(project.ensemble.tension).to.deep.equal(DEFAULT_MIDI_ENSEMBLE_TENSION);
    project = reduceMidiProject(project, { type: 'track.update', trackId: 'ensemble-bass', patch: { program: 34, channel: 6 } });
    project = reduceMidiProject(project, { type: 'ensemble.assignment.set', lemmingId: 0, laneIndex: 0, trackId: 'ensemble-bass' });
    const tracks = structuredClone(project.tracks), scale = structuredClone(project.global.scale), roles = structuredClone(project.ensemble.roles);
    project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: { amount: 0.7, healthyPopulation: 12, fadeTicks: 45 } });
    project = importMidiProjectPayload(stringifyMidiProjectExport(project));
    expect(project.ensemble.tension).to.include({ enabled: true, amount: 0.7, healthyPopulation: 12, fadeTicks: 45 });
    expect(project.tracks).to.deep.equal(tracks); expect(project.global.scale).to.deep.equal(scale); expect(project.ensemble.roles).to.deep.equal(roles);
    const legacy = structuredClone(project); delete legacy.ensemble.tension;
    expect(projectToMidiConfig(legacy).ensemble.tension.enabled).to.equal(false);
    const bounded = sanitizeMidiEnsembleTension({ healthyPopulation: Infinity, fadeTicks: 0, amount: 3, collapseRatio: 0.8, recoveryRatio: 0.2 });
    expect(bounded).to.include({ healthyPopulation: 8, fadeTicks: 1, amount: 1 });
    expect(bounded.recoveryRatio).to.be.closeTo(0.85, 1e-12);
  });
  it('does not confuse a small startup crew or wall-time pause with established population decline', function() {
    const model = new MidiLaneMusicTension(settings);
    for (let tick = 0; tick < 500; tick += 1) model.updateLane(0, signal(1, { peakAlive: 1, spawned: 1 }), tick);
    expect(model.snapshot(0)).to.include({ established: false, strength: 0, reason: 'startup' });
    const before = model.snapshot(0); expect(model.decision(note, meta(), 499).spec).to.equal(note);
    expect(model.snapshot(0)).to.deep.equal(before);
  });
  it('smoothly thins nonleader events to the real survivor and restores genuine population recovery', function() {
    const model = new MidiLaneMusicTension(settings); healthy(model);
    model.updateLane(0, signal(2), 3); expect(model.snapshot(0).strength).to.equal(0.1);
    model.updateLane(0, signal(2), 13); expect(model.snapshot(0)).to.include({ strength: 1, baseline: 10, soloActorId: 0 });
    expect(model.decision(note, meta(0), 13).spec).to.equal(note);
    expect(model.decision(note, meta(1), 13).spec).to.equal(null);
    model.updateLane(0, signal(7), 18); expect(model.snapshot(0).strength).to.equal(0.5);
    model.updateLane(0, signal(7), 23); expect(model.snapshot(0)).to.include({ strength: 0, reason: 'population-recovery' });
    expect(model.decision(note, meta(1), 23).spec).to.equal(note);
  });
  it('adjusts the healthy baseline for actual transfers while retaining real death and recovery response', function() {
    const model = new MidiLaneMusicTension(settings); healthy(model);
    model.updateLane(0, signal(2, { transferredIn: 0, transferredOut: 8, admitted: 2 }), 3);
    expect(model.snapshot(0)).to.include({ baseline: 2, strength: 0, survival: 1, established: true });
    model.updateLane(0, signal(2, { transferredIn: 0, transferredOut: 8, admitted: 2 }), 13);
    expect(model.snapshot(0)).to.include({ baseline: 2, strength: 0 });
    model.updateLane(1, signal(8, { spawned: 0, transferredIn: 8, transferredOut: 0, admitted: 8 }), 13);
    expect(model.snapshot(1).survival).to.equal(1);
    model.updateLane(0, signal(0, { transferredIn: 0, transferredOut: 8, admitted: 2, lowestSurvivingActorId: null }), 23);
    expect(model.snapshot(0)).to.include({ baseline: 2, strength: 1, survival: 0, reason: 'population-decline' });
    model.updateLane(0, signal(8, { transferredIn: 8, transferredOut: 8, admitted: 10 }), 33);
    expect(model.snapshot(0)).to.include({ baseline: 10, strength: 0, survival: 0.8, reason: 'population-recovery' });
    model.synchronize(2, 0);
    expect(model.snapshot(0)).to.equal(null);
    model.updateLane(0, signal(1, { transferredIn: 20, transferredOut: 19, admitted: 1 }), 0);
    expect(model.snapshot(0)).to.include({ established: false, strength: 0, survival: 1 });
  });
  it('restores progress or a newly crossed previous best but ignores planned terrain work', function() {
    const model = new MidiLaneMusicTension(settings); healthy(model);
    model.updateLane(0, signal(2), 13);
    model.updateLane(0, signal(2, { pendingTerrainWork: 10, activeWork: true }), 14);
    expect(model.snapshot(0).strength).to.equal(1);
    model.updateLane(0, signal(2, { maxX: 149, bestDistance: 113 }), 24);
    expect(model.snapshot(0)).to.include({ strength: 0, reason: 'progress-breakthrough' });
    const race = new MidiLaneMusicTension(settings); healthy(race);
    race.updateLane(0, signal(2, { maxX: 126, bestDistance: 90, previousDistance: 100 }), 13);
    race.updateLane(0, signal(2, { maxX: 137, bestDistance: 101, previousDistance: 100 }), 23);
    expect(race.snapshot(0)).to.include({ strength: 0, reason: 'previous-best' });
  });
  it('keeps deterministic admission and original pitch/program/timing while lowering supporting velocity', function() {
    const models = [new MidiLaneMusicTension(settings), new MidiLaneMusicTension(settings)];
    for (const model of models) { healthy(model); model.updateLane(0, signal(2), 7); }
    const results = models.map(model => Array.from({ length: 100 }, (_, tick) => model.decision(note, meta(), tick).spec));
    expect(results[0]).to.deep.equal(results[1]); expect(results[0].filter(Boolean).length).to.be.within(1, 99);
    for (const result of results[0].filter(Boolean)) expect(result).to.include({ note: 45, channel: 2, program: 38, durationTicks: 4, velocity: 68 });
    expect(models[0].decision({ ...note, ensembleRole: null }, meta(), 7).spec.velocity).to.equal(90);
  });
  it('bounds lanes and clears baseline on generation reset or rewind', function() {
    const model = new MidiLaneMusicTension(settings); healthy(model);
    model.updateLane(1023, signal(), 2); expect(model.snapshot(1023)).not.to.equal(null);
    expect(model.updateLane(1024, signal(), 2)).to.equal(null);
    model.synchronize(1, 100); expect(model.synchronize(1, 20)).to.equal(true); expect(model.snapshot(0)).to.equal(null);
    healthy(model); expect(model.synchronize(2, 21)).to.equal(true); expect(model.snapshot(0)).to.equal(null);
    expect(model.lanes).to.have.length(1024);
  });
  it('samples only completed ticks, releases only owned supporting held gates, and restores unchanged role output', function() {
    withFakeClockAndPerformance(clock => {
      let project = fresh();
      project = reduceMidiProject(project, { type: 'enabled.set', enabled: true });
      project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: { healthyTicks: 1, fadeTicks: 2 } });
      const config = projectToMidiConfig(project), calls = [], output = makeOutput([1, 2, 3, 4, 10], calls, 'fake-local');
      output.supportsPerNoteInstrument = true; output.supportsPerNotePan = true;
      let tick = 0, reads = 0, current = signal(8); const listeners = new Set();
      const timer = { TIME_PER_FRAME_MS: 60, frameTime: 60, tps: 1000 / 60, speedFactor: 1, getGameTicks: () => tick,
        onGameTick: { on: fn => listeners.add(fn), off: fn => listeners.delete(fn) } };
      const world = { laneCount: 1, generation: 1, getGameTimer: () => timer, getLaneMusicSignals() { reads++; return current; } };
      const router = new MidiEventRouter(config); router.setOutput(output); router.attach(null, { game: world });
      const advance = at => { tick = at; for (const fn of listeners) fn(); };
      advance(0); advance(1); expect(router.getLaneMusicTension(0).established).to.equal(true);
      router.scheduler.sendNote({ ...note, durationTicks: 0 }, meta(0));
      router.scheduler.sendNote({ ...note, note: 57, channel: 3, ensembleRole: 'rhythm', durationTicks: 0 }, meta(1));
      router.scheduler.sendNote({ note: 72, channel: 1, durationTicks: 0 }, meta(2));
      current = signal(2); const readBefore = reads;
      router._onEvent({ sfxId: SoundEffectIds.BUILDER_STEP, tick: 1, lemmingId: 1, laneIndex: 0, laneCount: 1 });
      expect(reads).to.equal(readBefore);
      advance(2); advance(3); expect(router.getLaneMusicTension(0).strength).to.equal(1);
      expect([...router.scheduler._activeNotes.values()].filter(voice => voice.lemmingId === 1)).to.have.length(0);
      expect([...router.scheduler._activeNotes.values()].some(voice => voice.lemmingId === 0)).to.equal(true);
      expect([...router.scheduler._activeNotes.values()].some(voice => !voice.ensembleRole && voice.note === 72)).to.equal(true);
      const before = calls.filter(call => call.type === 'noteOn').length;
      router._onEvent({ sfxId: SoundEffectIds.BUILDER_STEP, tick: 3, lemmingId: 1, laneIndex: 0, laneCount: 1 });
      expect(calls.filter(call => call.type === 'noteOn')).to.have.length(before);
      clock.tick(5000); expect(router.getLaneMusicTension(0).strength).to.equal(1);
      current = signal(8); advance(5);
      expect(router.getLaneMusicTension(0).strength).to.equal(0);
      router._onEvent({ sfxId: SoundEffectIds.BUILDER_STEP, tick: 5, lemmingId: 1, laneIndex: 0, laneCount: 1 });
      expect(calls.filter(call => call.type === 'noteOn')).to.have.length(before + 1);
      world.generation = 2; advance(6); expect(router.getLaneMusicTension(0).established).to.equal(false);
      expect([...router.scheduler._activeNotes.values()].filter(voice => voice.ensembleRole)).to.have.length(0);
      router.scheduler.allNotesOff(); expect(router.scheduler._activeNotes.size).to.equal(0); router.dispose();
    });
  });
  it('requires sustained startup health and never treats an already crossed race best as new recovery', function() {
    const model = new MidiLaneMusicTension(settings);
    model.updateLane(0, signal(), 0); model.updateLane(0, signal(2), 1); model.updateLane(0, signal(), 2);
    expect(model.snapshot(0).established).to.equal(false);
    model.updateLane(0, signal(10, { bestDistance: 101, previousDistance: 100 }), 4);
    expect(model.snapshot(0)).to.include({ established: true, reason: 'steady' });
    model.updateLane(0, signal(2, { bestDistance: 110, previousDistance: 100 }), 14);
    expect(model.snapshot(0)).to.include({ strength: 1, reason: 'population-decline' });
    model.updateLane(0, signal(0, { lowestSurvivingActorId: null }), 15);
    expect(model.decision(note, meta(0), 15).spec).to.equal(null);
  });
  it('preserves completed population history through pause and clock resync, and bypasses policy without editing tracks', function() {
    withRuntime(({ router, world, project, calls, clock, advance }) => {
      world.signal = signal(2); advance(2); advance(3);
      const state = router.getLaneMusicTension(0);
      router.resetClock(); clock.tick(5000); expect(router.getLaneMusicTension(0)).to.deep.equal(state);
      project = reduceMidiProject(project, { type: 'track.update', trackId: 'ensemble-bass', patch: { program: 34 } });
      router.setMapping(projectToMidiConfig(project)); expect(router.getLaneMusicTension(0)).to.deep.equal(state);
      project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: { enabled: false } });
      router.setMapping(projectToMidiConfig(project)); expect(router.getLaneMusicTension(0)).to.equal(null);
      router._onEvent({ sfxId: SoundEffectIds.BUILDER_STEP, tick: 3, lemmingId: 1, laneIndex: 0, laneCount: 1 });
      expect(calls.filter(call => call.type === 'noteOn')).to.have.length(1);
      expect(router.mapping.config.ensemble.roles.find(role => role.id === 'bass').track.program).to.equal(34);
    });
  });
  it('clears owned ensemble gates and queued tails on rewind without requiring an actor event', function() {
    withRuntime(({ router, world, advance }) => {
      router.scheduler.sendNote({ ...note, durationTicks: 0 }, meta(0));
      router.scheduler.sendNote({ note: 72, channel: 1, durationTicks: 0 }, meta(2));
      router.scheduler.gamePhrases.replaceSteps('support', [{ ...note, note: 58, channel: 3 }], meta(1), 1, 1);
      world.timeTravel = { isReversing: true }; advance(0);
      expect(router.getLaneMusicTension(0)).to.equal(null);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      expect([...router.scheduler._activeNotes.values()].filter(voice => voice.ensembleRole)).to.have.length(0);
      expect([...router.scheduler._activeNotes.values()].some(voice => voice.note === 72)).to.equal(true);
      world.timeTravel.isReversing = false; advance(1);
      expect(router.getLaneMusicTension(0).established).to.equal(false);
    });
  });
  for (const local of [true, false]) it('thins clip tails and cancels pending/held supporting gates safely at the ' + (local ? 'local' : 'external') + ' API boundary', function() {
    withRuntime(({ router, world, calls, clock, advance }) => {
      const capture = new MidiOutputCapture(); capture.start({ backend: local ? 'fake-local' : 'fake-external' }); router.setCapture(capture);
      router.scheduler.sendNote({ ...note, durationTicks: 0 }, meta(0));
      router.scheduler.sendNote({ ...note, channel: 3, note: 57, ensembleRole: 'rhythm', durationTicks: 0 }, meta(1));
      router.scheduler.sendNote({ ...note, channel: 4, note: 69, ensembleRole: 'melody', durationTicks: 0, timeMs: 1000 }, meta(2));
      expect(router.scheduler._pendingNoteOns.size).to.equal(1);
      world.signal = signal(2); advance(2); advance(3);
      expect(router.scheduler._pendingNoteOns.size).to.equal(0);
      expect([...router.scheduler._activeNotes.values()].map(voice => voice.lemmingId)).to.deep.equal([0]);
      const before = calls.filter(call => call.type === 'noteOn').length;
      router.scheduler.gamePhrases.replaceSteps('support', [{ ...note, note: 58, channel: 3 }, { ...note, note: 59, channel: 3 }], meta(1), 3, 1);
      router.scheduler.gamePhrases.replaceSteps('leader', [{ ...note, note: 46 }, { ...note, note: 47 }], meta(0), 3, 1);
      advance(3); advance(4); clock.tick(1500);
      expect(calls.filter(call => call.type === 'noteOn').slice(before).map(call => call.note)).to.deep.equal([46, 47]);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      expect(capture.snapshot().records.filter(record => record.stage === 'drop' && record.reason === 'musical-tension')).to.have.length(2);
      expect(router.scheduler.getOutputPressure().reasons?.['musical-tension']).to.equal(undefined);
      world.signal = signal(0, { lowestSurvivingActorId: null }); advance(5);
      expect([...router.scheduler._activeNotes.values()].filter(voice => voice.ensembleRole)).to.have.length(0);
      router.scheduler.allNotesOff(); expect(router.scheduler._activeNotes.size).to.equal(0);
    }, local);
  });

  it('scans active gates only when entering solo or the real survivor identity changes', function() {
    withRuntime(({ router, world, advance }) => {
      let scans = 0; const release = router._releaseTensionVoices.bind(router);
      router._releaseTensionVoices = (...args) => { scans++; return release(...args); };
      world.signal = signal(2); advance(2); advance(3); expect(scans).to.equal(1);
      for (let tick = 4; tick < 104; tick++) advance(tick);
      expect(scans).to.equal(1);
      world.signal = signal(1, { lowestSurvivingActorId: 1 }); advance(104); expect(scans).to.equal(2);
      world.signal = signal(0, { lowestSurvivingActorId: null }); advance(105); expect(scans).to.equal(3);
    });
  });

});
