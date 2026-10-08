import { expect } from 'chai';
import { GAME_EVENT_MIDI_PRESETS, applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import {
  createMidiProject,
  importMidiProjectPayload,
  projectToMidiConfig,
  stringifyMidiProjectExport
} from '../../js/midi/project/MidiProject.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { SoundEffectIds, SoundEventTypes, SoundEventBus } from '../../js/game/SoundEvents.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const expanded = GAME_EVENT_MIDI_PRESETS.slice(3).filter(preset => !preset.ensemble);
const actionEvents = [
  [SoundEffectIds.SPAWN, SoundEventTypes.LEMMING_SPAWN],
  [SoundEffectIds.EXIT, SoundEventTypes.LEMMING_EXIT, TriggerTypes.EXIT_LEVEL],
  [SoundEffectIds.BUILDER_STEP, SoundEventTypes.BUILDER_STEP],
  [SoundEffectIds.BASH, SoundEventTypes.LEMMING_BASH],
  [SoundEffectIds.DIG, SoundEventTypes.LEMMING_DIG],
  [SoundEffectIds.MINE, SoundEventTypes.LEMMING_MINE]
];
const playableProject = () => createMidiProject({
  enabled: true,
  transport: { quantize: '1/4', bpmBase: 137, swing: 0.6 },
  global: { mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 } }
});
const noteOns = calls => calls.filter(call => call.type === 'noteOn');

const renderActions = (presetId, events = actionEvents, count = 8) => withFakeClockAndPerformance(clock => {
  const project = applyGameEventMidiPreset(playableProject(), presetId);
  const config = projectToMidiConfig(project);
  const router = new MidiEventRouter(config);
  const calls = [];
  const result = [];
  router.setOutput(makeOutput([1], calls));
  try {
    for (const [sfxId, type, triggerType] of events) {
      const mapping = triggerType == null ? config.sfx[sfxId] : config.triggers[triggerType];
      for (let index = 0; index < count; index += 1) {
        clock.tick(660 + index % 3 * 60);
        const start = calls.length;
        router._onEvent({ sfxId, type, triggerType, tick: clock.now / 60, timeMs: clock.now, frameMs: 60 });
        const emitted = noteOns(calls.slice(start));
        const width = mapping.arp?.enabled ? 1 : mapping.notes?.length || 1;
        expect(emitted, `${presetId} event ${sfxId}`).to.have.length(width);
        expect(emitted.every(call => call.opts.time === clock.now), 'event time must not be quantized').to.equal(true);
        result.push({ sfxId, notes: emitted.map(call => call.note), time: clock.now });
      }
    }
    const length = noteOns(calls).length;
    clock.tick(3000);
    expect(noteOns(calls)).to.have.length(length);
    expect(router.scheduler._activeNotes.size).to.equal(0);
  } finally {
    router.dispose();
  }
  return result;
});

describe('expanded game-event MIDI preset library', function() {
  it('exposes twelve additional immutable, descriptive and distinct musical definitions', function() {
    expect(expanded).to.have.length.at.least(12);
    expect(new Set(GAME_EVENT_MIDI_PRESETS.map(preset => preset.id)).size).to.equal(GAME_EVENT_MIDI_PRESETS.length);
    expect(Object.isFrozen(GAME_EVENT_MIDI_PRESETS)).to.equal(true);
    const signatures = new Set();
    const rhythms = new Set();
    const registers = new Set();
    for (const preset of expanded) {
      for (const field of ['label', 'description', 'family', 'register', 'contour', 'rhythm', 'voicing']) {
        expect(preset[field], `${preset.id}.${field}`).to.be.a('string').and.not.be.empty;
      }
      expect(Object.isFrozen(preset)).to.equal(true);
      expect(Object.isFrozen(preset.scale)).to.equal(true);
      expect(Object.isFrozen(preset.scale.degrees)).to.equal(true);
      expect(preset.baseNote % 12).to.equal(preset.scale.root);
      const project = applyGameEventMidiPreset(createMidiProject(), preset.id);
      const config = projectToMidiConfig(project);
      expect(project.global.scale).to.deep.equal(preset.scale);
      const actions = actionEvents.map(([id]) => config.sfx[id]);
      signatures.add(JSON.stringify(actions));
      rhythms.add(preset.rhythm);
      registers.add(preset.register);
      expect(Object.keys(config.sfx)).to.have.length(27);
      for (const mapping of Object.values(config.sfx)) {
        const notes = mapping.notes || [mapping.note];
        expect(notes.length).to.be.within(1, 5);
        expect(new Set(notes).size, `${preset.id} has duplicate pitches`).to.equal(notes.length);
        expect(mapping.durationTicks).to.be.within(2, 7);
        expect(mapping.velocity).to.be.within(1, 127);
        expect(mapping.timbre).to.be.within(0, 127);
        if (!mapping.arp?.enabled) {
          expect(notes.length).to.be.at.most(3);
          if (notes.length > 1) expect(mapping.velocity).to.be.at.most(81);
        }
        for (const note of notes) {
          expect(note).to.be.within(24, 100);
          expect(note).to.be.within(project.global.noteRange.min, project.global.noteRange.max);
          expect(preset.scale.degrees).to.include(((note - preset.scale.root) % 12 + 12) % 12);
        }
      }
    }
    expect(signatures.size).to.equal(expanded.length);
    expect(rhythms.size).to.be.at.least(8);
    expect(registers.size).to.be.at.least(5);
  });

  it('preserves every hardware, channel, track, safety and transport setting for both playback modes', function() {
    const original = createMidiProject({
      enabled: false,
      devices: { inputId: 'keyboard', outputId: 'synth', inputChannel: 7 },
      transport: { bpmBase: 151, quantize: '1/8', swing: 0.3 },
      global: {
        velocityRange: { min: 21, max: 87, default: 65 },
        durationTicks: { min: 2, max: 19, default: 5 },
        mpe: { enabled: false, masterChannel: 4, memberChannels: [6, 7] },
        limits: { maxEventsPerTick: 3, maxActiveNotes: 2, maxBytesPerSecond: 1500 },
        density: { windowTicks: 10, velocityBoost: 0.15, durationScale: 0.2 },
        reverse: { allNotesOffOnToggle: true },
        envelope: { attack: 0.8, decay: 0.2, sustain: 0.9, release: 0.4 }
      },
      tracks: [{ id: 'routed-track', channel: 9, outputId: 'external-synth', program: 17, voiceBudget: 2, mute: true }],
      sources: [
        { id: 'my-spawn', kind: 'sfx', sourceKey: String(SoundEffectIds.SPAWN), trackId: 'routed-track', mapping: { note: 30 } },
        { id: 'my-flag', kind: 'midiFlag', sourceKey: '1001', trackId: 'routed-track', mapping: { note: 43 } }
      ],
      clips: [{ id: 'saved-clip', lengthSteps: 1, steps: [{ note: 43 }] }],
      automation: [{ id: 'saved-pan', target: 'pan', axis: 'x' }]
    });
    const snapshot = structuredClone(original);
    for (const preset of GAME_EVENT_MIDI_PRESETS.filter(preset => !preset.ensemble)) {
      for (const mode of ['steps', 'phrase']) {
        const next = applyGameEventMidiPreset(original, preset.id, { mode });
        expect(next.enabled).to.equal(false);
        for (const key of ['devices', 'transport', 'tracks', 'clips', 'automation']) {
          expect(next[key], `${preset.id}.${key}`).to.deep.equal(original[key]);
        }
        for (const [key, value] of Object.entries(original.global)) {
          if (key !== 'scale' && key !== 'noteRange') expect(next.global[key], key).to.deep.equal(value);
        }
        expect(next.sources.find(source => source.id === 'my-flag')).to.deep.equal(original.sources[1]);
        expect(next.sources.find(source => source.id === 'my-spawn').trackId).to.equal('routed-track');
        const calls = [];
        const router = new MidiEventRouter(projectToMidiConfig(next));
        router.setOutput(makeOutput([9], calls, 'external-synth'));
        try {
          router._onEvent({ sfxId: SoundEffectIds.SPAWN, type: SoundEventTypes.LEMMING_SPAWN, tick: 0 });
          expect(noteOns(calls)).to.have.length(0);
        } finally {
          router.dispose();
        }
      }
    }
    expect(original).to.deep.equal(snapshot);
  });

  it('round-trips custom scales and is deterministic and idempotent without stale playback fields', function() {
    withFakeClockAndPerformance(() => {
      const project = createMidiProject();
      for (const preset of GAME_EVENT_MIDI_PRESETS) {
        for (const mode of ['steps', 'phrase']) {
          const first = applyGameEventMidiPreset(project, preset.id, { mode });
          const repeated = applyGameEventMidiPreset(first, preset.id, { mode });
          expect(repeated).to.deep.equal(first);
          expect(applyGameEventMidiPreset(project, preset.id, { mode })).to.deep.equal(first);
          expect(importMidiProjectPayload(stringifyMidiProjectExport(first))).to.deep.equal(first);
          const backToSteps = applyGameEventMidiPreset(first, preset.id);
          expect(backToSteps.sources.every(source => !source.mapping.phrase)).to.equal(true);
        }
      }
    });
    const harmony = applyGameEventMidiPreset(createMidiProject(), 'game-major-open-harmony');
    const plucks = applyGameEventMidiPreset(harmony, 'game-minor-pentatonic-plucks');
    const builder = projectToMidiConfig(plucks).sfx[SoundEffectIds.BUILDER_STEP];
    expect(builder.arp.pattern).to.deep.equal({ preset: 'custom', steps: ['up', 'hold', 'down', 'hold'] });
    expect(builder.chord).to.equal(undefined);
    const again = projectToMidiConfig(applyGameEventMidiPreset(plucks, 'game-major-open-harmony'));
    expect(again.sfx[SoundEffectIds.BUILDER_STEP].arp).to.equal(undefined);
    expect(again.sfx[SoundEffectIds.BUILDER_STEP].notes).to.deep.equal([64, 67]);
  });

  it('aliases the actual exit, drowning and fire trigger routes to the selected palette', function() {
    for (const preset of GAME_EVENT_MIDI_PRESETS) {
      for (const mode of ['steps', 'phrase']) {
        const config = projectToMidiConfig(applyGameEventMidiPreset(createMidiProject(), preset.id, { mode }));
        for (const [trigger, sfx] of [
          [TriggerTypes.EXIT_LEVEL, SoundEffectIds.EXIT],
          [TriggerTypes.DROWN, SoundEffectIds.DROWN],
          [TriggerTypes.KILL, SoundEffectIds.TRAP_FIRE],
          [TriggerTypes.FRYING, SoundEffectIds.TRAP_FIRE]
        ]) expect(config.triggers[trigger]).to.deep.equal(config.sfx[sfx]);
      }
    }
  });

  it('plays every action deterministically, only when events arrive, with bounded simultaneous voicing', function() {
    const signatures = new Set();
    for (const preset of expanded) {
      const first = renderActions(preset.id);
      expect(renderActions(preset.id)).to.deep.equal(first);
      signatures.add(JSON.stringify(first.map(event => event.notes)));
    }
    expect(signatures.size).to.equal(expanded.length);
  });

  it('renders held-pitch, bouncing, single-note and simultaneous chord contours through the real router', function() {
    const build = [[SoundEffectIds.BUILDER_STEP, SoundEventTypes.BUILDER_STEP]];
    expect(renderActions('game-dorian-switchbacks', build).map(event => event.notes[0]))
      .to.deep.equal([62, 64, 64, 67, 64, 67, 67, 71]);
    expect(renderActions('game-major-music-box', build).map(event => event.notes[0]))
      .to.deep.equal([76, 78, 80, 83, 80, 78, 76, 78]);
    expect(renderActions('game-dorian-bass-pulse', [[SoundEffectIds.BASH, SoundEventTypes.LEMMING_BASH]], 3).map(event => event.notes))
      .to.deep.equal([[48], [48], [48]]);
    expect(renderActions('game-major-open-harmony', [[SoundEffectIds.EXIT, SoundEventTypes.LEMMING_EXIT, TriggerTypes.EXIT_LEVEL]], 2).map(event => event.notes))
      .to.deep.equal([[60, 67, 76], [60, 67, 76]]);
  });

  it('plays bounded phrases on simulation ticks with each palette\'s real spacing and no wall-clock advancement', function() {
    for (const preset of GAME_EVENT_MIDI_PRESETS) {
      for (const [sfxId, type, triggerType] of actionEvents.slice(0, 2)) {
        withFakeClockAndPerformance(clock => {
          const project = applyGameEventMidiPreset(playableProject(), preset.id, { mode: 'phrase' });
          const config = projectToMidiConfig(project);
          const mapping = config.sfx[sfxId];
          const expected = [...mapping.notes].sort((a, b) => a - b);
          if (sfxId === SoundEffectIds.SPAWN) expected.reverse();
          const calls = [];
          const timer = { tick: 0, frameTime: 60, speedFactor: 1, getGameTicks() { return this.tick; }, onGameTick: new EventHandler() };
          const bus = new SoundEventBus(timer);
          const router = new MidiEventRouter(config);
          router.setOutput(makeOutput([1], calls));
          router.attach(bus);
          try {
            bus.emitSfx(type, sfxId, { triggerType });
            expect(noteOns(calls).map(call => call.note)).to.deep.equal(expected.slice(0, 1));
            clock.tick(300);
            expect(noteOns(calls)).to.have.length(1);
            for (let tick = 1; tick <= 48; tick += 1) {
              clock.tick(60);
              timer.tick = tick;
              timer.onGameTick.trigger();
              expect(noteOns(calls), `${preset.id} ${type} tick ${tick}`).to.have.length(
                Math.min(expected.length, 1 + Math.floor(tick / mapping.phrase.spacingTicks))
              );
              expect(router.scheduler._activeNotes.size).to.be.at.most(1);
            }
            expect(noteOns(calls).map(call => call.note)).to.deep.equal(expected);
            expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
            expect(mapping.velocity).to.be.at.most(sfxId === SoundEffectIds.SPAWN ? 96 : 120);
          } finally {
            router.dispose();
            bus.dispose();
          }
        });
      }
    }
  });

  it('keeps dense harmony bursts within existing event and voice budgets and releases every note', function() {
    withFakeClockAndPerformance(clock => {
      const project = applyGameEventMidiPreset(createMidiProject({
        enabled: true,
        global: { mpe: { enabled: false }, limits: { maxEventsPerTick: 3, maxActiveNotes: 2 } },
        tracks: [{ id: 'limited', channel: 1, voiceBudget: 2 }]
      }), 'game-major-open-harmony');
      const calls = [];
      const router = new MidiEventRouter(projectToMidiConfig(project));
      router.setOutput(makeOutput([1], calls));
      try {
        for (let index = 0; index < 40; index += 1) {
          router._onEvent({ sfxId: SoundEffectIds.EXIT, type: SoundEventTypes.LEMMING_EXIT, triggerType: TriggerTypes.EXIT_LEVEL, tick: 0 });
          expect(router.scheduler._activeNotes.size).to.be.at.most(2);
        }
        expect(noteOns(calls)).to.have.length.within(1, 9);
        clock.tick(2000);
        expect(router.scheduler._activeNotes.size).to.equal(0);
        expect(router.scheduler._noteOffs).to.have.length(0);
      } finally {
        router.dispose();
      }
    });
  });
});
