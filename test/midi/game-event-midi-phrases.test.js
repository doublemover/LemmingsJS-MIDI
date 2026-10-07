import { expect } from 'chai';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { MidiGamePhraseQueue, MAX_GAME_PHRASE_NOTES, MAX_GAME_PHRASE_VOICES } from '../../js/midi/scheduler/MidiGamePhraseQueue.js';
import { SoundEventBus, SoundEffectIds, SoundEventTypes } from '../../js/game/SoundEvents.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const withPhrases = (run, overrides = {}) => withFakeClockAndPerformance(clock => {
  const calls = [];
  const project = applyGameEventMidiPreset(createMidiProject({
    enabled: true,
    global: { mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 }, ...overrides }
  }), 'game-major', { mode: 'phrase' });
  const config = projectToMidiConfig(project);
  const router = new MidiEventRouter(config);
  const output = makeOutput([1], calls, 'out');
  router.setOutput(output);
  const timer = {
    tick: 0, frameTime: 60, speedFactor: 1, onGameTick: new EventHandler(),
    getGameTicks() { return this.tick; },
    get tps() { return 1000 / this.frameTime; }
  };
  const bus = new SoundEventBus(timer);
  router.attach(bus);
  const advance = (count = 1) => {
    for (let index = 0; index < count; index += 1) {
      clock.tick(timer.frameTime);
      timer.tick += 1;
      timer.onGameTick.trigger();
    }
  };
  const spawn = (extra = {}) => bus.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN, extra);
  const notes = () => calls.filter(call => call.type === 'noteOn');
  try {
    run({ router, timer, bus, output, config, clock, calls, notes, advance, spawn });
  } finally {
    router.dispose();
    bus.dispose();
  }
});

describe('bounded game-clock MIDI phrases', function() {
  it('plays five quiet falling notes on game ticks and rising exit notes', function() {
    withPhrases(({ spawn, advance, notes, bus, router }) => {
      spawn();
      advance(8);
      expect(notes().map(call => call.note)).to.deep.equal([76, 72, 67, 64, 60]);
      expect(notes().map(call => call.opts.time)).to.deep.equal([0, 120, 240, 360, 480]);
      expect(notes().map(call => call.opts.rawAttack)).to.deep.equal([42, 42, 42, 42, 42]);
      advance(2);
      bus.emitSfx(SoundEventTypes.LEMMING_EXIT, SoundEffectIds.EXIT, { triggerType: TriggerTypes.EXIT_LEVEL });
      advance(8);
      expect(notes().slice(5).map(call => call.note)).to.deep.equal([60, 64, 67, 72, 76]);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
    });
  });

  it('replaces only unsounded notes while the current sounding note keeps its original off', function() {
    withPhrases(({ spawn, advance, notes, calls, router }) => {
      spawn();
      advance();
      spawn({ intensity: 1.5 });
      expect(notes()).to.have.length(1);
      expect(calls.filter(call => call.type === 'noteOff')).to.have.length(0);
      expect(router.scheduler._noteOffs[0].timeMs).to.be.closeTo(120, 0.001);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(1);
      advance(9);
      expect(calls.find(call => call.type === 'noteOff').opts.time).to.be.closeTo(120, 0.001);
      expect(notes().map(call => call.note)).to.deep.equal([76, 76, 72, 67, 64, 60]);
      expect(notes().map(call => call.opts.rawAttack)).to.deep.equal([42, 63, 63, 63, 63, 63]);
      expect(notes()[1].opts.time).to.equal(120);
      advance(2);
      expect(router.scheduler._activeNotes.size).to.equal(0);
    });
  });

  it('freezes pending notes while paused and adapts future spacing to game speed', function() {
    withPhrases(({ spawn, advance, notes, clock, timer }) => {
      spawn();
      clock.tick(2000);
      expect(notes()).to.have.length(1);
      advance(2);
      expect(notes()[1].opts.time).to.equal(2120);
      timer.frameTime = 30;
      timer.speedFactor = 2;
      advance(4);
      expect(notes()[2].opts.time).to.equal(2240);
      advance(2);
      expect(notes()[3].opts.time).to.equal(2300);
    });
  });

  it('keeps a high user velocity minimum intact, even when it prevents a soft phrase', function() {
    withPhrases(({ spawn, notes, config }) => {
      spawn();
      expect(notes()[0].opts.rawAttack).to.equal(70);
      expect(config.velocityRange.min).to.equal(70);
    }, { velocityRange: { min: 70, max: 110, default: 80 } });
  });

  it('merges same-tick arrivals and supersedes a due tail after simulation work runs', function() {
    withPhrases(({ router, timer, bus, spawn, advance, notes }) => {
      router.detach();
      timer.onGameTick.on(() => {
        if (timer.tick === 2) spawn({ intensity: 1.5 });
      });
      router.attach(bus);
      spawn();
      spawn({ intensity: 1.25 });
      expect(notes()).to.have.length(1);
      advance(2);
      expect(notes().map(call => call.note)).to.deep.equal([76, 76]);
      expect(notes()[1].opts).to.include({ rawAttack: 63, time: 120 });
      expect(router.scheduler.gamePhrases.voices.size).to.equal(1);
      advance(8);
      expect(notes().slice(1).map(call => call.note)).to.deep.equal([76, 72, 67, 64, 60]);
    });
  });

  it('keeps pending phrase notes behind ordinary events at the per-tick limit', function() {
    withPhrases(({ router, timer, bus, spawn, advance, notes }) => {
      router.detach();
      timer.onGameTick.on(() => {
        if (timer.tick === 2) bus.emitSfx(SoundEventTypes.SKILL_ASSIGN, SoundEffectIds.SKILL_ASSIGN);
      });
      router.attach(bus);
      spawn();
      advance(2);
      expect(notes()).to.have.length(2);
      expect(notes()[1].note).to.equal(72);
      expect(notes()[1].opts.rawAttack).to.equal(82);
      advance(6);
      expect(notes()).to.have.length(5);
    }, { limits: { maxEventsPerTick: 1 } });
  });

  it('enforces byte limits on every tail note without retaining rejected work', function() {
    withPhrases(({ spawn, advance, notes, router }) => {
      spawn();
      advance(12);
      expect(notes()).to.have.length(0);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      expect(router.scheduler._activeNotes.size).to.equal(0);
    }, { limits: { maxBytesPerSecond: 3 } });
  });

  it('drops pending work safely when a device starts rejecting sends', function() {
    withPhrases(({ spawn, advance, output, router }) => {
      spawn();
      output.channels[1].sendNoteOn = () => { throw new Error('Device disconnected'); };
      expect(() => advance(4)).not.to.throw();
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      expect(router.scheduler._activeNotes.size).to.equal(0);
    });
  });

  for (const reason of ['panic', 'clear', 'mapping', 'disable', 'output', 'disconnect', 'detach', 'backward', 'forward', 'reverse']) {
    it(`cancels unsounded notes on ${reason}`, function() {
      withPhrases(({ spawn, router, config, advance, timer, bus, notes }) => {
        spawn();
        if (reason === 'panic') router.scheduler.allNotesOff();
        if (reason === 'clear') router.scheduler.clearQueue();
        if (reason === 'mapping') router.setMapping({ ...config, scale: { ...config.scale, root: 2 } });
        if (reason === 'disable') router.setMapping({ ...config, enabled: false });
        if (reason === 'output') router.setOutput(makeOutput([1], [], 'other'));
        if (reason === 'disconnect') router.setOutputs([]);
        if (reason === 'detach') router.detach();
        if (reason === 'backward') {
          advance();
          timer.tick = -1;
        }
        if (reason === 'forward') timer.tick = 100;
        if (reason === 'reverse') {
          bus.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN, { reverse: true });
          expect(notes()).to.have.length(2);
        }
        const before = notes().length;
        advance(20);
        expect(notes()).to.have.length(before);
        expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      });
    });
  }

  it('does not cancel pending music during identical config/device refreshes', function() {
    withPhrases(({ spawn, router, config, output, advance, notes }) => {
      spawn();
      router.setMapping(config);
      router.setOutput(output);
      router.setOutputs([output]);
      advance(8);
      expect(notes()).to.have.length(5);
    });
  });

  it('bounds rapid retriggers, active voices and pending memory during a long burst', function() {
    withPhrases(({ spawn, advance, router, timer }) => {
      for (let index = 0; index < 600; index += 1) {
        spawn();
        expect(router.scheduler.gamePhrases.voices.size).to.be.at.most(1);
        for (const voice of router.scheduler.gamePhrases.voices.values()) {
          expect(voice.notes.length).to.be.at.most(5);
        }
        expect(router.scheduler._activeNotes.size).to.be.at.most(1);
        advance();
      }
      expect(timer.tick).to.equal(600);
      advance(12);
      expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      expect(router.scheduler._activeNotes.size).to.equal(0);
    });
  });

  it('keeps source/track/output ownership separate and enforces queue hard bounds', function() {
    const queue = new MidiGamePhraseQueue();
    for (let index = 0; index < 100; index += 1) {
      queue.replace(`source-${index}`, Array.from({ length: 100 }, (_, note) => note), {}, {}, 1, 2);
    }
    expect(queue.voices.size).to.equal(MAX_GAME_PHRASE_VOICES);
    for (const voice of queue.voices.values()) expect(voice.notes.length).to.equal(MAX_GAME_PHRASE_NOTES);
    const sent = [];
    queue.advance(1, (spec) => sent.push(spec));
    expect(sent).to.have.length(MAX_GAME_PHRASE_VOICES);
    expect(new Set(sent.map(spec => spec.phraseVoiceKey)).size).to.equal(MAX_GAME_PHRASE_VOICES);
    queue.clear();
    expect(queue.voices.size).to.equal(0);
  });
});
