import { expect } from 'chai';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { MidiGamePhraseQueue, MAX_ROLLING_PHRASE_LANES, MAX_ROLLING_PHRASE_DISPATCHES } from '../../js/midi/scheduler/MidiGamePhraseQueue.js';
import { createMidiProject, projectToMidiConfig, stringifyMidiProjectExport, importMidiProjectPayload, reduceMidiProject } from '../../js/midi/project/MidiProject.js';
import { getProcgenMusicBeatTicks, PROCGEN_GAME_EVENT_MIDI_PRESETS, applyProcgenGameEventMidiPreset, setProcgenSpawnPriority, getProcgenSpawnPriority } from '../../js/midi/project/ProcgenMidiDefaults.js';
import { SoundEventBus, SoundEffectIds as Sfx, SoundEventTypes as Events } from '../../js/game/SoundEvents.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const withRouting = run => withFakeClockAndPerformance(clock => {
  const project = applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true, global: { mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 } } }), 'game-major');
  const config = projectToMidiConfig(project), calls = [], output = makeOutput([1], calls, 'local');
  output.supportsPerNotePan = true; output.supportsPerNoteInstrument = true; output.supportsIndependentNoteGates = true; output.supportsPlaybackMetadata = true;
  const router = new MidiEventRouter(config), timer = { tick: 0, frameTime: 60, TIME_PER_FRAME_MS: 60, speedFactor: 1, onGameTick: new EventHandler(), getGameTicks() { return this.tick; } };
  const bus = new SoundEventBus(timer), game = { generation: 1, generationStartTick: 0, getGameTimer: () => timer };
  router.setOutput(output); router.attach(bus, { game });
  const advance = count => { for (let i = 0; i < count; i++) { clock.tick(timer.frameTime); timer.tick++; timer.onGameTick.trigger(); } };
  const notes = () => calls.filter(call => call.type === 'noteOn');
  try { run({ project, config, output, router, timer, bus, game, calls, clock, advance, notes }); } finally { router.dispose(); bus.dispose(); }
});

describe('procgen local musical routing', () => {
  it('derives fractional musical birth spacing from base BPM and simulation ticks only', () => {
    const project = createMidiProject({ transport: { bpmBase: 120 } });
    expect(getProcgenMusicBeatTicks(project)).to.be.closeTo(8 + 1 / 3, 1e-12);
    expect(getProcgenMusicBeatTicks({ ...project, transport: { ...project.transport, bpmBase: 100 } }, 60)).to.equal(10);
    expect(getProcgenMusicBeatTicks({ ...project, transport: { ...project.transport, bpmBase: 100, speedFactor: 22 } }, 60)).to.equal(10);
    expect(getProcgenMusicBeatTicks({ transport: { bpmBase: NaN } }, 0)).to.be.closeTo(8 + 1 / 3, 1e-12);
  });

  it('dispatches quiet landing notes in descending high-register order on the existing game clock', () => {
    withRouting(({ bus, advance, notes }) => {
      bus.emitSfx(Events.LEMMING_LAND, Sfx.LAND, { lemmingId: 2, laneIndex: 0, laneCount: 1 });
      advance(20);
      expect(notes()).to.have.length(4);
      const pitches = notes().map(call => call.note);
      expect(pitches).to.deep.equal([...pitches].sort((a, b) => b - a));
      expect(Math.min(...pitches)).to.be.at.least(72);
      expect(notes().every(call => call.opts.rawAttack === 32)).to.equal(true);
    });
  });
  it('keeps deliberate preferences and distinct procgen durations through roundtrip and preset changes', () => {
    const durations = new Set();
    for (const id of ['procgen-bass-relay', 'procgen-airy-arrivals', 'procgen-clockwork-crowd']) {
      let project = applyProcgenGameEventMidiPreset(createMidiProject(), id);
      expect(PROCGEN_GAME_EVENT_MIDI_PRESETS.some(preset => preset.id === id)).to.equal(true);
      const land = project.sources.find(source => source.sourceKey === String(Sfx.LAND) && source.kind === 'sfx');
      durations.add(land.mapping.durationTicks); expect(land.mapping.velocity).to.equal(32); expect(land.mapping.phrase.mode).to.equal('down');
      project = setProcgenSpawnPriority(project, 7);
      project = reduceMidiProject(project, { type: 'global.update', patch: { position: { ...project.global.position, lanePanSpread: 0 } } });
      project = importMidiProjectPayload(stringifyMidiProjectExport(project));
      project = applyProcgenGameEventMidiPreset(project, 'game-iron-ensemble');
      expect(getProcgenSpawnPriority(project)).to.equal(7); expect(project.global.position.lanePanSpread).to.equal(0);
    }
    expect(durations.size).to.equal(3);
  });

  it('replaces rolling defaults only on explicit preset application while retaining deliberate performance edits', () => {
    let project = applyProcgenGameEventMidiPreset(createMidiProject(), 'procgen-bass-relay');
    for (const id of [Sfx.BLOCKER_TURN, Sfx.BLOCKER_CONTACT, Sfx.BASH]) {
      const source = project.sources.find(source => source.kind === 'sfx' && source.sourceKey === String(id));
      project = reduceMidiProject(project, { type: 'source.mapping.update', sourceId: source.id, patch: { velocity: 51, priority: 7, pan: 23, timbre: 40, pitchBend: 0.2,
        envelope: { attack: 1.1, decay: 0.2, sustain: 0.8, release: 0.5 }, ...(id === Sfx.BASH ? {} : { phrase: { ...source.mapping.phrase, rolling: { enabled: true, bars: 6, evolve: -5 } } }) } });
    }
    project = reduceMidiProject(project, { type: 'global.update', patch: { position: { ...project.global.position, viewPan: true, panMode: 'level', lanePanSpread: 19 }, velocityRange: { min: 20, max: 100, default: 60 } } });
    const kept = applyProcgenGameEventMidiPreset(project, 'procgen-airy-arrivals');
    const selected = applyProcgenGameEventMidiPreset(project, 'procgen-airy-arrivals', { replaceRollingDefaults: true });
    const turns = value => value.sources.filter(source => source.kind === 'sfx' && [String(Sfx.BLOCKER_TURN), String(Sfx.BLOCKER_CONTACT)].includes(source.sourceKey));
    expect(turns(kept).every(source => source.mapping.phrase.rolling.bars === 6 && source.mapping.phrase.rolling.evolve === -5)).to.equal(true);
    expect(turns(selected).every(source => source.mapping.phrase.rolling.bars === 4 && source.mapping.phrase.rolling.evolve === 4)).to.equal(true);
    expect(selected.global).to.deep.equal(kept.global); expect(selected.global.position).to.include({ viewPan: true, panMode: 'level', lanePanSpread: 19 });
    for (const source of selected.sources.filter(source => source.kind === 'sfx' && [Sfx.BLOCKER_TURN, Sfx.BLOCKER_CONTACT, Sfx.BASH].map(String).includes(source.sourceKey))) expect(source.mapping).to.include({ velocity: 51, priority: 7, pan: 23, timbre: 40, pitchBend: 0.2 });
    const clockwork = applyProcgenGameEventMidiPreset(importMidiProjectPayload(stringifyMidiProjectExport(selected)), 'procgen-clockwork-crowd', { replaceRollingDefaults: true });
    expect(turns(clockwork).every(source => source.mapping.phrase.rolling.bars === 3 && source.mapping.phrase.rolling.evolve === -2)).to.equal(true);
    expect(turns(applyProcgenGameEventMidiPreset(clockwork, 'procgen-airy-arrivals', { mode: 'phrase', replaceRollingDefaults: false })).every(source => source.mapping.phrase.rolling.bars === 3 && source.mapping.phrase.rolling.evolve === -2)).to.equal(true);
  });

  it('sends lane pan per local voice without channel CC and preserves explicit pan or external routing', () => {
    withRouting(({ bus, notes, calls, router, config, game }) => {
      for (let laneIndex = 0; laneIndex < 4; laneIndex++) bus.emitSfx(Events.LEMMING_SPAWN, Sfx.SPAWN, { laneIndex, laneCount: 4, lemmingId: laneIndex });
      for (const [index, expected] of [-72, -24, 24, 72].entries()) expect(notes()[index].opts.pan).to.be.closeTo(expected / 127, 1e-12);
      expect(calls.some(call => call.type === 'cc' && call.cc === 10)).to.equal(false);
      const scheduler = new MidiScheduler(config), externalCalls = [], external = makeOutput([1], externalCalls);
      try {
        scheduler.setOutput(external);
        scheduler.sendNote({ note: 60, velocity: 40, durationTicks: 2 }, { laneIndex: 0, laneCount: 4 });
        expect(externalCalls.find(call => call.type === 'noteOn').opts).not.to.have.property('pan');
        expect(externalCalls.some(call => call.type === 'cc' && call.cc === 10)).to.equal(false);
      } finally { scheduler.dispose(); }
      router.setMapping({ ...config, sfx: { ...config.sfx, [Sfx.SPAWN]: { ...config.sfx[Sfx.SPAWN], pan: 8 } } });
      bus.emitSfx(Events.LEMMING_SPAWN, Sfx.SPAWN, { laneIndex: 0, laneCount: 4, lemmingId: 7 });
      expect(notes().at(-1).opts.pan).to.equal(8 / 127);
      game.level = { width: 100, height: 400 };
      router.setMapping({ ...config, position: { ...config.position, viewPan: true, panMode: 'level' } });
      bus.emitSfx(Events.LEMMING_SPAWN, Sfx.SPAWN, { x: 50, laneIndex: 0, laneCount: 4, lemmingId: 8 });
      expect(notes().at(-1).opts.pan).to.equal(0);
      bus.emitSfx(Events.LEMMING_SPAWN, Sfx.SPAWN, { x: 100, laneIndex: 0, laneCount: 4, lemmingId: 9 });
      expect(notes().at(-1).opts.pan).to.equal(1);
    });
  });

  it('coalesces collisions into finite evolving multi-bar phrases on actual ticks and Panic owns their tails', () => {
    withRouting(({ bus, notes, router, timer, clock, advance, calls, config }) => {
      const bounce = () => bus.emitSfx(Events.BLOCKER_TURN, Sfx.BLOCKER_TURN, { lemmingId: 2, laneIndex: 0, laneCount: 1 });
      for (let i = 0; i < 100; i++) bounce();
      expect(notes()).to.have.length(0); expect(router.scheduler.gamePhrases.voices.size).to.equal(1);
      clock.tick(1000); expect(notes()).to.have.length(0);
      advance(70);
      const first = notes().map(call => call.note); expect(first).to.have.length(8);
      expect(notes()[7].opts.time - notes()[0].opts.time).to.be.greaterThan(3000);
      expect(notes().every(call => call.opts.rawAttack === Math.max(18, config.velocityRange.min))).to.equal(true);
      expect(first.every(note => config.scale.degrees.includes((note - config.scale.root + 120) % 12))).to.equal(true);
      advance(10); expect(notes()).to.have.length(8); expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      bounce(); advance(9); expect(notes().at(-1).note).not.to.equal(first[0]);
      router.scheduler.allNotesOff(); const stopped = notes().length;
      advance(100); expect(notes()).to.have.length(stopped);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0); expect(router.scheduler._activeNotes.size).to.equal(0);
      expect(calls.some(call => call.type === 'allNotesOff')).to.equal(true); expect(timer.tick).to.equal(189);
    });
  });

  it('clears the old generation once at an origin event even with no spans or tension, retaining the real-time budget', () => {
    withRouting(({ bus, notes, router, timer, game, calls, advance }) => {
      const bounce = () => bus.emitSfx(Events.BLOCKER_TURN, Sfx.BLOCKER_TURN, { lemmingId: 2, laneIndex: 0, laneCount: 1 });
      bounce(); advance(9); expect(notes()).to.have.length(1);
      const firstPitch = notes()[0].note, used = router.scheduler.getRateSnapshot();
      router.scheduler.sendNote({ note: 72, durationTicks: 0 });
      const releases = () => calls.filter(call => call.type === 'noteOff').length;
      const previousReleases = releases();
      game.generation++; game.generationStartTick = timer.tick;
      bounce();
      expect(releases()).to.equal(previousReleases + 1);
      expect([...router.scheduler._activeNotes.values()].map(voice => voice.note)).to.deep.equal([72]);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(1);
      const retained = router.scheduler.getRateSnapshot();
      expect(retained.past.count + retained.next.count).to.be.at.least(used.past.count + used.next.count);
      advance(9); expect(notes()).to.have.length(3); expect(notes()[2].note).to.equal(firstPitch);
      expect(releases()).to.equal(previousReleases + 1);
      game.generation++; advance(1);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      const stopped = notes().length; advance(80); expect(notes()).to.have.length(stopped);
      expect(releases()).to.equal(previousReleases + 2);
    });
  });

  it('gives64simultaneous lanes bounded rotating dispatch under one shared real-time budget', () => {
    withRouting(({ bus, notes, router, timer, advance }) => {
      for (let laneIndex = 0; laneIndex < 64; laneIndex++) bus.emitSfx(Events.BLOCKER_CONTACT, Sfx.BLOCKER_CONTACT, { lemmingId: laneIndex, laneIndex, laneCount: 64 });
      expect(router.scheduler.gamePhrases.voices.size).to.equal(64);
      advance(13);
      expect(new Set(notes().map(call => call.opts.playback.laneIndex)).size).to.equal(64);
      const counts = new Map(); for (const call of notes()) counts.set(call.opts.time, (counts.get(call.opts.time) || 0) + 1);
      expect(Math.max(...counts.values())).to.be.at.most(MAX_ROLLING_PHRASE_DISPATCHES);
      timer.frameTime = 60 / 22; timer.speedFactor = 22;
      advance(80);
      const rate = router.scheduler.getRateSnapshot();
      expect(rate.past.count + rate.next.count).to.be.at.most(1000);
      expect(rate.past.bytes + rate.next.bytes).to.be.at.most(3906);
      router.scheduler.allNotesOff(); expect(router.scheduler._activeNotes.size).to.equal(0);
    });
  });

  it('bounds per-lane work, drops expired tails, and retains current transfer identity without replay', () => {
    const queue = new MidiGamePhraseQueue(), dropped = [], sent = [];
    for (let lane = 0; lane < 1100; lane++) queue.replaceRolling(JSON.stringify([lane, null, 'rolling-bounce', null, 'track', null, 1]), [60, 62], { durationTicks: 2 }, { lemmingId: lane, laneIndex: lane, laneCount: 1024 }, 0, { spacingTicks: 8, onDrop: reason => dropped.push(reason) });
    expect(queue.voices.size).to.equal(MAX_ROLLING_PHRASE_LANES);
    for (let tick = 1; tick <= 30; tick++) queue.advance(tick, (spec, meta) => sent.push([tick, spec.note, meta.laneIndex]));
    expect(sent.length).to.be.at.most(30 * MAX_ROLLING_PHRASE_DISPATCHES); expect(dropped.length).to.be.greaterThan(0);
    queue.clear(); const key = JSON.stringify([0, null, 'rolling-bounce', null, 'track', null, 1]);
    queue.replaceRolling(key, [60, 62], {}, { lemmingId: 7, laneIndex: 0, laneCount: 2 }, 0, { spacingTicks: 8 });
    queue.transferActorLane(7, 0, 1, 2);
    expect(queue.voices.has(key)).to.equal(false); expect([...queue.voices.values()][0].meta).to.include({ lemmingId: 7, laneIndex: 1, originLaneIndex: 0 });
    queue.advance(1, (spec, meta) => sent.push([1, spec.note, meta.laneIndex])); expect(sent.at(-1)[2]).to.equal(1);
    queue.advance(0, () => { throw new Error('Rewind must clear pending tails'); }); expect(queue.voices.size).to.equal(0);
  });
});
