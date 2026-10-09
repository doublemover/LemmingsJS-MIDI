import { expect } from 'chai';
import { MidiMusicDirector, MAX_PENDING_CUES } from '../../js/midi/router/MidiMusicDirector.js';
import { getMidiMusicalPosition, getNextMidiBoundaryTick } from '../../js/midi/project/MidiMusicalPosition.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { createMidiProject, reduceMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { applyProcgenGameEventMidiPreset } from '../../js/midi/project/ProcgenMidiDefaults.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
const at = beat => ({ beat, bar: Math.floor(beat / 4) + 1, quartersPerBar: 4, ticksPerQuarter: 25 / 3 });
const event = (tick = 0, lane = 0, id = 'scene') => ({ sfxId: SoundEffectIds.PROCGEN_ROUTE_COMPLETE, tick,
  generation: 1, laneIndex: lane, laneCount: 1, lemmingId: 0, crewProjectId: id, ordinaryCrossings: 2, routeRevisionsUnchanged: true });
const withDirection = (run, { recipe = 'scenes', output = true, edit = p => p } = {}) => withFakeClockAndPerformance(clock => {
  let project = applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true,
    global: { mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 }, musicDirector: { recipe } } }), 'game-iron-ensemble');
  project = reduceMidiProject(project, { type: 'ensemble.tension.update', patch: { enabled: false } }); project = edit(project);
  const calls = [], device = makeOutput([1, 2, 3, 4, 10], calls, 'local');
  device.supportsPerNoteInstrument = true; device.supportsPerNotePan = true;
  const timer = { tick: 0, TIME_PER_FRAME_MS: 60, frameTime: 60, speedFactor: 1, tps: 1000 / 60,
    getGameTicks() { return this.tick; }, onGameTick: new EventHandler() };
  const scene = { id: 'scene', phase: 'complete', generation: 1, tiles: [] };
  const world = { generation: 1, generationStartTick: 0, laneCount: 1, signalReads: 0, working: false,
    lanePolicy: { projects: { lanes: [{ projects: [scene] }] } }, getTerrainTileRevision: () => 0,
    getGameTimer: () => timer, getLaneMusicSignals() { this.signalReads++; return { buildingCount: Number(this.working) }; } };
  const router = new MidiEventRouter(projectToMidiConfig(project)); if (output) router.setOutput(device); router.attach(null, { game: world });
  const advance = count => { for (let n = 0; n < count; n++) { clock.tick(timer.frameTime); timer.tick++; timer.onGameTick.trigger(); } };
  const notes = () => calls.filter(call => call.type === 'noteOn');
  try { router._advanceGamePhrases(); run({ router, world, timer, scene, calls, notes, advance, clock, device }); }
  finally { router.dispose(); }
});
describe('shared simulation musical clock', function() {
  it('places fractional tempo and meter boundaries without cumulative rounding or speed drift', function() {
    const timing = { bpmBase: 137, timeSignature: { beats: 5, unit: 8 } }, origin = 113;
    for (let bar = 0; bar < 200; bar++) {
      const tick = Math.ceil(origin + bar * 2.5 * 60000 / 137 / 60 - 1e-9);
      const position = getMidiMusicalPosition(timing, tick, 60, origin);
      expect(position.bar).to.equal(bar + 1);
      const boundary = getNextMidiBoundaryTick(timing, tick, 60, origin, 'bar');
      expect(boundary.tick).to.equal(Math.ceil(origin + (bar + 1) * 2.5 * 60000 / 137 / 60 - 1e-9));
    }
  });
  it('requests the strictly next boundary at an exact beat and handles absent timing safely', function() {
    expect(getNextMidiBoundaryTick({ bpmBase: 120 }, 25, 60, 0).tick).to.equal(34);
    expect(getNextMidiBoundaryTick(null, NaN, Infinity, NaN).tick).to.equal(9);
    expect(getMidiMusicalPosition(null, NaN, Infinity, NaN)).to.include({ beat: 0, bar: 1 });
  });
});
describe('bounded scene music director', function() {
  it('debounces a completed work summary then commits on the next shared bar', function() {
    const model = new MidiMusicDirector(); model.bind({ generation: 1 }, 0, 0, 'clock');
    model.observe(at(0), true); model.observe(at(0.5), false); model.observe(at(1), true); model.observe(at(2), true);
    expect(model.snapshot(at(2))).to.include({ current: 'exploration', pending: 'construction', nextBar: 2 });
    model.observe(at(3.99), true); expect(model.current).to.equal('exploration');
    model.observe(at(4), true); expect(model.current).to.equal('construction');
    expect(model.apply({ ensembleRole: 'rhythm', velocity: 100 }, at(4))).to.equal(null);
    expect(model.apply({ ensembleRole: 'percussion', velocity: 100 }, at(0))).to.equal(null);
    expect(model.apply({ ensembleRole: 'rhythm', velocity: 100 }, at(4.5)).velocity).to.equal(39);
    expect(model.apply({ ensembleRole: 'rhythm', velocity: 100 }, at(5)).velocity).to.equal(78);
  });
  it('keeps authored sources and cue attacks outside arrangement gains', function() {
    const model = new MidiMusicDirector(), plain = { velocity: 91 }, cue = { ...plain, ensembleRole: 'rhythm', musicDirectionCue: true };
    expect(model.apply(plain, at(0))).to.equal(plain); expect(model.apply(cue, at(0))).to.equal(cue);
  });
  it('deduplicates recent projects per lane and bounds simultaneous pending work', function() {
    const model = new MidiMusicDirector(); model.bind({ generation: 1 }, 0, 0, 'clock');
    expect(model.request(event(), {}, {}, at(0))).to.equal(true);
    for (let tick = 1; tick <= 100; tick++) expect(model.request(event(tick), {}, {}, at(0))).to.equal(false);
    expect(model.request(event(101, 0, 'next'), {}, {}, at(0))).to.equal(true);
    expect(model.request(event(102), {}, {}, at(0))).to.equal(false);
    for (let lane = 1; lane < 1024; lane++) model.request(event(103, lane), {}, {}, at(0));
    expect(model.cues.size).to.equal(MAX_PENDING_CUES); expect(model.seen.size).to.equal(1024);
    expect(model.request(event(104, 1024), {}, {}, at(0))).to.equal(false);
    expect(model.request({ ...event(104), ordinaryCrossings: 0 }, {}, {}, at(0))).to.equal(false);
  });
  it('never answers a thinned lead and expires stale pending scenes', function() {
    const model = new MidiMusicDirector(); model.bind({ generation: 1 }, 0, 0, 'clock'); model.request(event(), {}, {}, at(0));
    const ready = model.ready(at(1), () => true, () => true); model.started(ready.cue, 'lead', 'lead', at(1)); model.completed('lead');
    expect(model.ready(at(5), () => true, () => false)).to.equal(null); expect(model.cueStatus).to.equal('thinned');
    model.request(event(1, 1), {}, {}, at(5)); model.ready(at(38), () => true, () => false); expect(model.cues.size).to.equal(0);
  });
});
describe('scene music uses the existing router and phrase queue', function() {
  it('does no new director or signal work with Event music or no MIDI output', function() {
    for (const settings of [{ recipe: 'events' }, { output: false }]) withDirection(({ router, world, advance }) => {
      advance(60); expect(router.musicDirector).to.equal(undefined); expect(world.signalReads).to.equal(0);
      expect(router.getMusicDirection().enabled).to.equal(false);
    }, settings);
  });
  it('admits one next-quarter lead and one different-role answer a musical bar later', function() {
    withDirection(({ router, notes, advance, timer }) => {
      for (let n = 0; n < 100; n++) router._onEvent(event());
      expect(notes()).to.have.length(0); advance(8); expect(notes()).to.have.length(0); advance(1);
      expect(notes()).to.have.length(1); expect(notes()[0].id).to.equal(4); expect(timer.tick).to.equal(9);
      advance(32); expect(notes()).to.have.length(4); advance(1); expect(notes()).to.have.length(5);
      expect(notes()[4].id).to.equal(2); advance(20); expect(notes()).to.have.length(6);
      expect(notes().every(note => note.note >= 38 && note.note <= 81)).to.equal(true);
    });
  });
  it('keeps a pending cue through identical project and output refreshes', function() {
    withDirection(({ router, device, notes, advance }) => {
      router._onEvent(event()); const director = router.musicDirector;
      router.setMapping(router.mapping.config); router.setOutputs([device]); router.setOutput(device);
      expect(router.musicDirector).to.equal(director); advance(9); expect(notes()).to.have.length(1);
    });
  });
  it('preserves paused pending music and musical position while future dispatch follows speed', function() {
    withDirection(({ router, notes, advance, clock, timer }) => {
      router._onEvent(event()); router.resetClock({ preserveGamePhrases: true }); clock.tick(3000); expect(notes()).to.have.length(0);
      timer.speedFactor = 2; timer.frameTime = 30; advance(9); expect(notes()).to.have.length(1);
      expect(router._directionPosition(9).beat).to.be.closeTo(1.08, 1e-12);
    });
  });
  it('cancels pending and active owned cues on Panic, output retirement, generation or tick discontinuity', function() {
    for (const change of [({ router }) => router.scheduler.allNotesOff(), ({ router }) => router.setOutput(null),
      ({ world }) => world.generation++, ({ timer }) => { timer.tick += 100; }]) withDirection(state => {
      state.router._onEvent(event()); state.advance(9); expect(state.notes()).to.have.length(1); change(state); state.advance(60);
      expect(state.notes()).to.have.length(1); expect(state.router.scheduler._activeNotes.size).to.equal(0);
    });
  });
  it('rechecks completed route revisions and manual lane shutdown before a reply', function() {
    for (const change of [({ scene }) => { scene.tiles = [{ key: 1, revision: 2 }]; },
      ({ world }) => { world._manualNukeLanes = [true]; }, ({ scene }) => { scene.phase = 'failed'; }]) withDirection(state => {
      state.router._onEvent(event()); state.advance(25); expect(state.notes()).to.have.length(4); change(state); state.advance(60);
      expect(state.notes()).to.have.length(4);
    });
  });
  it('respects a manually muted melody and does not manufacture a second permitted role', function() {
    withDirection(({ router, notes, advance }) => {
      router._onEvent(event()); advance(70); expect(notes()).to.have.length(4); expect(notes().every(note => note.id === 2)).to.equal(true);
    }, { edit: p => p.tracks.reduce((next, track) => track.id.startsWith('ensemble-') && track.id !== 'ensemble-bass' ? reduceMidiProject(next, { type: 'track.update', trackId: track.id, patch: { mute: true } }) : next, p) });
  });
  it('keeps authored overlapping clip onsets, dynamics and transformed pitches for the rare cue', function() {
    withDirection(({ router, notes, advance }) => {
      const source = router.mapping.config.sfx[SoundEffectIds.PROCGEN_ROUTE_COMPLETE];
      source.clipSequence = { id: 'cue-clip', advance: 'game-tick', spacingTicks: 3, steps: [
        { voices: [{ note: 60, velocity: 50, durationTicks: 1 }, { note: 64, velocity: 90, durationTicks: 2 }] },
        { note: null }, { note: 67, velocity: 70, durationTicks: 1, transformLayers: [{ type: 'pitch', transpose: 2 }] } ] };
      router._onEvent(event()); advance(9); expect(notes()).to.have.length(2);
      expect(notes()[0].opts.time).to.equal(notes()[1].opts.time); expect(notes()[0].opts.rawAttack).to.be.lessThan(notes()[1].opts.rawAttack);
      advance(5); expect(notes()).to.have.length(2); advance(1); expect(notes()).to.have.length(3);
      expect(notes()[2].opts.time - notes()[0].opts.time).to.equal(360);
      expect(notes().every(note => [0, 2, 4, 5, 7, 9, 11].includes(note.note % 12))).to.equal(true);
    });
  });
  it('advances event cells independently of a started phrase or musical bar', function() {
    withDirection(({ router, advance }) => {
      const source = router.mapping.config.sfx[SoundEffectIds.PROCGEN_ROUTE_COMPLETE];
      source.clipSequence = { id: 'event-cue', advance: 'event', spacingTicks: 2, steps: [
        { note: 60, velocity: 90, durationTicks: 1 }, { note: 64, velocity: 90, durationTicks: 1, condition: { unit: 'event', every: 2 } } ] };
      const cue = { event: event() }, position = router._directionPosition(0);
      const first = router._musicDirectionCells(cue, 'lead', position); expect(first[0].voices.filter(voice => Number.isFinite(voice.note))).to.have.length(1);
      expect(cue.clipCounts).to.deep.equal({ event: 1, pass: 1 }); advance(1);
      const second = router._musicDirectionCells({ event: event(1) }, 'lead', position); expect(second[0].voices.filter(voice => Number.isFinite(voice.note))).to.have.length(1);
      expect(second[0].voices[0].note).not.to.equal(first[0].voices[0].note);
      expect(router._arpStateBySfx.get(router._resolveArpKey(event(), source)).index).to.equal(2);
    });
  });
  it('retains full authored trailing-rest completion and skips an answer whose bar was missed', function() {
    withDirection(({ router, notes, advance }) => {
      const source = router.mapping.config.sfx[SoundEffectIds.PROCGEN_ROUTE_COMPLETE];
      source.clipSequence = { id: 'long-rest-cue', advance: 'game-tick', passCounter: 'completed', spacingTicks: 3,
        steps: [{ note: 60, velocity: 90, durationTicks: 1 }, ...Array.from({ length: 15 }, () => ({ note: null }))] };
      const key = router._resolveArpKey(event(), source); router._onEvent(event()); advance(42);
      expect(notes()).to.have.length(1); expect(router._arpStateBySfx.get(key).completedPasses).to.equal(0);
      advance(12); expect(router._arpStateBySfx.get(key).completedPasses).to.equal(1); advance(20); expect(notes()).to.have.length(1);
    });
  });
  it('keeps an authored nonensemble cue to its source without inventing a reply role', function() {
    withDirection(({ router, notes, advance }) => { router._onEvent(event()); advance(70); expect(notes()).to.have.length(4); },
      { edit: p => ({ ...p, ensemble: { ...p.ensemble, enabled: false } }) });
  });
  it('does not issue a reply when the output declines every lead admission', function() {
    withDirection(({ router, device, notes, advance }) => {
      device.channels[4].sendNoteOn = () => false;
      router._onEvent(event()); advance(70); expect(notes()).to.have.length(0);
      expect(router.getMusicDirection().cue).to.equal('thinned');
    });
  });
  it('gates rhythm at actual dispatch and applies scene velocity exactly once to queued melody', function() {
    withDirection(({ router, notes }) => {
      const common = { channel: 4, note: 69, velocity: 100, durationTicks: 1, ensembleRole: 'melody' };
      expect(router._sendGamePhraseNote(common, { laneIndex: 0 }, 0)).to.equal(true); expect(notes()[0].opts.rawAttack).to.equal(72);
      expect(router._sendGamePhraseNote({ ...common, channel: 3, ensembleRole: 'rhythm' }, { laneIndex: 0 }, 0)).to.equal(false);
      expect(notes()).to.have.length(1);
    });
  });
});
