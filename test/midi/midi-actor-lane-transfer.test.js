import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { expect } from 'chai';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const config = { enabled: true, mpe: { enabled: false }, position: { viewPan: false, mappings: [] },
  density: { velocityBoost: 0, durationScale: 0 }, timing: { scheduleAheadMs: 0 },
  limits: { maxEventsPerSecond: 128, hardMaxEventsPerSecond: 128, maxBytesPerSecond: 100000 } };

describe('MIDI actor lane transfer', function() {
  it('moves queued tails to completed destination position and budget without replaying the sounding note', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], output = makeOutput([1], calls, 'fake-local');
      const router = new MidiEventRouter({ ...config, sfx: { 24: { notes: [60, 64, 67], velocity: 80,
        durationTicks: 2, phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } },
      automationSpans: [{ id: 'destination', enabled: true, scope: 'global', target: 'velocity', min: 20, max: 100,
        span: { domain: 'distance', start: 0, duration: 100, shape: 'ramp', laneScope: 'lane', laneStart: 1 } }] });
      const timer = { tick: 0, frameTime: 60, tps: 1000 / 60, TIME_PER_FRAME_MS: 60,
        onGameTick: new EventHandler(), getGameTicks() { return this.tick; } };
      const queries = [], world = { generation: 1, laneCount: 2, getGameTimer: () => timer,
        getLaneMusicActorPosition(id, lane) { queries.push([id, lane]); return lane === 1 ? { x: 50, tick: timer.tick } : null; } };
      router.setOutput(output); router.attach(null, { game: world });
      try {
        router._onEvent({ sfxId: 24, tick: 0, laneIndex: 0, laneCount: 2, lemmingId: 9, x: 5 });
        const active = [...router.scheduler._activeNotes.values()][0], token = active.token;
        const releases = router.scheduler._noteOffs.map(off => ({ ...off }));
        const ledger = JSON.stringify([router.scheduler._rateSent, router.scheduler._ratePlanned]);
        const before = calls.length;
        expect(router.transferActorLane(9, 0, 1, 2)).to.equal(true);
        expect(calls).to.have.length(before);
        expect(active).to.include({ token, laneIndex: 1, lemmingId: 9, note: 60, channel: 1 });
        expect(router.scheduler._noteOffs).to.deep.equal(releases);
        expect(JSON.stringify([router.scheduler._rateSent, router.scheduler._ratePlanned])).to.equal(ledger);
        const [key, voice] = [...router.scheduler.gamePhrases.voices][0];
        expect(JSON.parse(key).slice(0, 2)).to.deep.equal([1, 9]);
        expect(voice.meta).to.include({ laneIndex: 1, originLaneIndex: 0 });
        for (let tick = 1; tick <= 4; tick += 1) { clock.tick(60); timer.tick = tick; timer.onGameTick.trigger(); }
        const notes = calls.filter(call => call.type === 'noteOn');
        expect(notes.map(note => note.note)).to.deep.equal([60, 64, 67]);
        expect(notes.map(note => note.opts.rawAttack)).to.deep.equal([80, 60, 60]);
        expect(queries).to.deep.equal([[9, 0], [9, 1], [9, 1]]);
        expect(router.scheduler._ratePlanned.some(entry => entry.laneIndex === 1)).to.equal(true);
        clock.tick(120);
        expect(calls.filter(call => call.type === 'noteOff').map(note => note.note)).to.deep.equal([60, 64, 67]);
        expect(router.scheduler._activeNotes.size).to.equal(0);
      } finally { router.dispose(); }
    });
  });

  it('preserves held gates and pending dispatch ownership while tension follows the new lane', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], output = makeOutput([2, 3], calls, 'fake-local');
      output.supportsPlaybackMetadata = true; output.supportsPerNoteInstrument = true; output.supportsPerNotePan = true;
      const router = new MidiEventRouter(config), capture = new MidiOutputCapture({ nowMs: () => clock.now });
      capture.start(); router.setOutput(output); router.setCapture(capture);
      try {
        const meta = { laneIndex: 0, laneCount: 2, lemmingId: 4, sfxId: 20 };
        router.scheduler.sendNote({ note: 45, channel: 2, durationTicks: 0, program: 38, ensembleRole: 'bass' }, { ...meta });
        router.scheduler.sendNote({ note: 65, channel: 3, timeMs: 100, durationTicks: 4, program: 81, ensembleRole: 'melody' }, { ...meta });
        const tokens = [...router.scheduler._activeNotes.keys()];
        const ledger = JSON.stringify([router.scheduler._rateSent, router.scheduler._ratePlanned]);
        const before = calls.length;
        expect(router.transferActorLane(4, 0, 1, 2)).to.equal(true);
        expect([...router.scheduler._activeNotes.keys()]).to.deep.equal(tokens);
        expect(calls).to.have.length(before);
        expect(JSON.stringify([router.scheduler._rateSent, router.scheduler._ratePlanned])).to.equal(ledger);
        router._releaseTensionVoices(0, 99);
        expect(router.scheduler._activeNotes.size).to.equal(2);
        clock.tick(100);
        expect(calls.filter(call => call.type === 'noteOn')[1].opts.playback.laneIndex).to.equal(1);
        const emitted = capture.snapshot().records.filter(record => record.stage === 'api-dispatch' && record.type === 'noteOn');
        expect(emitted[1]).to.include({ laneIndex: 1, originLaneIndex: 0, note: 65, program: 81 });
        router._releaseTensionVoices(1, 99);
        expect(router.scheduler._activeNotes.size).to.equal(0);
        expect(router.scheduler._pendingNoteOns.size).to.equal(0);
        expect(calls.filter(call => call.type === 'noteOff').map(note => note.note)).to.deep.equal([45, 65]);
        clock.tick(500);
        expect(calls.filter(call => call.type === 'noteOff')).to.have.length(2);
      } finally { router.dispose(); }
    });
  });

  it('keeps the newer destination phrase when transfer collides with a boundary retrigger', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], project = applyGameEventMidiPreset(createMidiProject({ enabled: true }), 'game-iron-ensemble', { mode: 'phrase' });
      project.ensemble.assignments = [{ lemmingId: 8, laneIndex: 0, trackId: 'ensemble-bass' },
        { lemmingId: 8, laneIndex: 1, trackId: 'ensemble-bass' }];
      const router = new MidiEventRouter(projectToMidiConfig(project));
      const output = makeOutput([2, 3, 4, 10], calls); output.supportsPerNoteInstrument = true; output.supportsPerNotePan = true;
      const timer = { tick: 0, frameTime: 60, tps: 1000 / 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; } };
      router.setOutput(output); router.attach(null, { game: { getGameTimer: () => timer } });
      try {
        router._onEvent({ sfxId: 24, tick: 0, laneIndex: 0, laneCount: 2, lemmingId: 8 });
        clock.tick(60); timer.tick = 1;
        router._onEvent({ sfxId: 24, tick: 1, laneIndex: 1, laneCount: 2, lemmingId: 8 });
        const destination = [...router.scheduler.gamePhrases.voices].find(([, voice]) => voice.meta.laneIndex === 1);
        const tokens = [...router.scheduler._activeNotes.keys()], releases = router.scheduler._noteOffs.map(off => ({ ...off }));
        const before = calls.length;
        expect(router.transferActorLane(8, 0, 1, 2)).to.equal(true);
        expect(router.scheduler.gamePhrases.voices.size).to.equal(1);
        expect(router.scheduler.gamePhrases.voices.get(destination[0])).to.equal(destination[1]);
        expect(destination[1].meta.tick).to.equal(1);
        expect(destination[1].dueTick).to.equal(3);
        expect([...router.scheduler._activeNotes.keys()]).to.deep.equal(tokens);
        expect(router.scheduler._noteOffs).to.deep.equal(releases);
        expect(calls).to.have.length(before);
        clock.tick(60); timer.tick = 2; timer.onGameTick.trigger();
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(2);
        clock.tick(60); timer.tick = 3; timer.onGameTick.trigger();
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(3);
        expect(calls.filter(call => call.type === 'noteOn').at(-1).id).to.equal(2);
      } finally { router.dispose(); }
    });
  });
  it('rejects invalid transfers without touching voices, phrases, clocks or budgets', function() {
    const router = new MidiEventRouter(config);
    try {
      for (const args of [[1, 0, 0, 2], [1, 0, 2, 2], [1, -1, 1, 2], [1.5, 0, 1, 2], [1, 0, 1, 1025]]) {
        expect(router.transferActorLane(...args)).to.equal(false);
      }
      expect(router.scheduler.gamePhrases.tick).to.equal(null);
      expect(router.scheduler._ratePlanned).to.deep.equal([]);
      expect(router.scheduler._rateSent).to.deep.equal([]);
    } finally { router.dispose(); }
  });
});
