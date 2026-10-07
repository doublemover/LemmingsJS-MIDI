import { expect } from 'chai';
import {
  GAME_EVENT_MIDI_PRESETS,
  applyGameEventMidiPreset
} from '../../js/midi/project/GameEventMidiPresets.js';
import {
  createMidiProject,
  createMidiProjectFromMidiConfig,
  importMidiProjectPayload,
  projectToMidiConfig,
  stringifyMidiProjectExport
} from '../../js/midi/project/MidiProject.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { SoundEffectIds, SoundEventTypes, SoundEventBus } from '../../js/game/SoundEvents.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { resolveAvailableSfxIds, SFX_NAME_BY_ID } from '../../js/app/midi-ui/midiUiDomain.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

describe('game-event MIDI presets', function() {
  it('provides bounded, distinct musical palettes for supported gameplay events', function() {
    expect(GAME_EVENT_MIDI_PRESETS.slice(0, 3).map(preset => preset.id)).to.deep.equal([
      'game-major', 'game-minor', 'game-chromatic'
    ]);
    for (const preset of GAME_EVENT_MIDI_PRESETS.slice(0, 3)) {
      const project = applyGameEventMidiPreset(createMidiProject(), preset.id);
      const config = projectToMidiConfig(project);
      expect(preset.description).to.be.a('string').and.not.be.empty;
      expect(config.sfx[SoundEffectIds.SPAWN].arp).to.include({ enabled: true, mode: 'down', length: 4 });
      expect(config.sfx[SoundEffectIds.EXIT].arp).to.include({ enabled: true, mode: 'up', length: 4 });
      expect(config.sfx[SoundEffectIds.BUILDER_STEP].arp.mode).to.equal('up');
      expect(config.sfx[SoundEffectIds.DIG].arp.mode).to.equal('down');
      for (const mapping of Object.values(config.sfx)) {
        expect(mapping.durationTicks).to.be.within(2, 8);
        expect(mapping.velocity).to.be.within(1, 127);
        expect(mapping.timbre).to.be.within(0, 127);
        expect(mapping.notes?.length || 1).to.be.at.most(4);
        for (const note of mapping.notes || [mapping.note]) {
          expect(note).to.be.within(project.global.noteRange.min, project.global.noteRange.max);
          expect(project.global.scale.degrees).to.include((note - project.global.scale.root + 120) % 12);
        }
      }
    }
  });

  it('keeps transport, devices, enablement, tracks, custom clips and automation intact', function() {
    const original = createMidiProject({
      enabled: false,
      devices: { inputId: 'in', outputId: 'out', inputChannel: 3 },
      transport: { bpmBase: 137, quantize: '1/4', swing: 0.7 },
      global: { noteRange: { min: 60, max: 65 }, limits: { maxEventsPerTick: 3 } },
      tracks: [{ id: 'custom-track', name: 'Custom', channel: 8, voiceBudget: 3, outputId: 'out-2' }],
      clips: [{ id: 'keep-clip', name: 'Keep', lengthSteps: 1, steps: [{ note: 90 }] }],
      automation: [{ id: 'keep-lane', target: 'pan', axis: 'x' }],
      sources: [
        { id: 'custom-spawn', kind: 'sfx', sourceKey: String(SoundEffectIds.SPAWN), trackId: 'custom-track', mode: 'clip', clipId: 'keep-clip' },
        { id: 'keep-flag', kind: 'midiFlag', sourceKey: '1003', trackId: 'custom-track', mapping: { note: 90 } }
      ]
    });
    const snapshot = JSON.stringify(original);
    const next = applyGameEventMidiPreset(original, 'game-major');
    expect(JSON.stringify(original)).to.equal(snapshot);
    expect(next.enabled).to.equal(false);
    for (const key of ['devices', 'transport', 'tracks', 'clips', 'automation']) {
      expect(next[key]).to.deep.equal(original[key]);
    }
    expect(next.global.limits).to.deep.equal(original.global.limits);
    expect(next.global.noteRange).to.deep.equal({ min: 36, max: 84 });
    expect(next.sources.find(source => source.id === 'keep-flag')).to.deep.equal(original.sources[1]);
    expect(next.sources.find(source => source.id === 'custom-spawn')).to.include({
      trackId: 'custom-track', mode: 'direct', clipId: null, enabled: true
    });
    expect(next.ui).to.include({ selectedSourceId: 'custom-spawn', selectedTrackId: 'custom-track' });
  });

  it('replaces stale direct and clip fields, stays stable on reapply and round-trips', function() {
    const project = createMidiProjectFromMidiConfig({
      sfx: { [SoundEffectIds.SPAWN]: { note: 20, chord: { type: 'ninth' }, pitchBend: 0.8, disabled: true } },
      triggers: { [TriggerTypes.EXIT_LEVEL]: { note: 36, disabled: true } }
    });
    const next = applyGameEventMidiPreset(project, 'game-minor');
    const again = applyGameEventMidiPreset(next, 'game-chromatic');
    expect(again.sources).to.have.length(next.sources.length);
    const spawn = again.sources.find(source => source.sourceKey === String(SoundEffectIds.SPAWN) && source.kind === 'sfx');
    expect(spawn.mapping.chord).to.equal(null);
    expect(spawn.mapping.pitchBend).to.equal(null);
    expect(spawn.mapping.notes).to.deep.equal([72, 73, 74, 75]);
    expect(projectToMidiConfig(again).triggers[TriggerTypes.EXIT_LEVEL].arp.mode).to.equal('up');
    expect(importMidiProjectPayload(stringifyMidiProjectExport(again))).to.deep.equal(again);
    expect(() => applyGameEventMidiPreset(project, 'unknown')).to.throw('Unknown game-event MIDI preset');
  });

  it('includes the actual spawn source in source discovery', function() {
    const config = projectToMidiConfig(applyGameEventMidiPreset(createMidiProject(), 'game-major'));
    expect(resolveAvailableSfxIds(config, { skills: [], triggers: [] }, null).has(SoundEffectIds.SPAWN)).to.equal(true);
    expect(SFX_NAME_BY_ID.get(SoundEffectIds.SPAWN)).to.equal('spawn');
  });

  it('advances only on actual events without snapping irregular simulation times', function() {
    withFakeClockAndPerformance(clock => {
      const project = applyGameEventMidiPreset(createMidiProject({
        enabled: true,
        transport: { bpmBase: 137, quantize: '1/4', swing: 0.7 },
        global: { mpe: { enabled: false } }
      }), 'game-major');
      const calls = [];
      const router = new MidiEventRouter(projectToMidiConfig(project));
      router.setOutput(makeOutput([1], calls));
      const timer = { tick: 0, frameTime: 17, speedFactor: 1, getGameTicks() { return this.tick; } };
      const bus = new SoundEventBus(timer);
      router.attach(bus);
      try {
        for (const tick of [0, 3, 11, 18]) {
          clock.tick(tick * 17 - clock.now);
          timer.tick = tick;
          bus.emitSfx(SoundEventTypes.LEMMING_SPAWN, SoundEffectIds.SPAWN, { lemmingId: tick });
        }
        const spawned = calls.filter(call => call.type === 'noteOn');
        expect(spawned.map(call => call.note)).to.deep.equal([84, 79, 76, 72]);
        expect(spawned.map(call => call.opts.time)).to.deep.equal([0, 51, 187, 306]);
        clock.tick(1000);
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(4);
        for (let index = 0; index < 4; index += 1) {
          clock.tick(85);
          timer.tick += 5;
          bus.emitSfx(SoundEventTypes.LEMMING_EXIT, SoundEffectIds.EXIT, { triggerType: TriggerTypes.EXIT_LEVEL });
        }
        expect(calls.filter(call => call.type === 'noteOn').slice(4).map(call => call.note)).to.deep.equal([60, 64, 67, 72]);
      } finally {
        router.dispose();
        bus.dispose();
      }
    });
  });

  it('keeps unmapped or disabled spawn events silent in existing MIDI projects', function() {
    for (const sfx of [{}, {
      [SoundEffectIds.SPAWN]: { note: 72, disabled: true },
      [SoundEffectIds.LAND]: { note: 48, disabled: true }
    }]) {
      const calls = [];
      const router = new MidiEventRouter({ enabled: true, mpe: { enabled: false }, sfx });
      router.setOutput(makeOutput([1], calls));
      try {
        router._onEvent({ sfxId: SoundEffectIds.SPAWN, type: SoundEventTypes.LEMMING_SPAWN, tick: 1 });
        router._onEvent({ sfxId: SoundEffectIds.LAND, type: SoundEventTypes.LEMMING_LAND, tick: 1 });
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(0);
      } finally {
        router.dispose();
      }
    }
  });

  it('offers quiet five-note phrases and a plain distinct landing note without changing velocity limits', function() {
    const project = createMidiProject({ global: { velocityRange: { min: 60, max: 100, default: 80 } } });
    const phrase = applyGameEventMidiPreset(project, 'game-major', { mode: 'phrase' });
    const config = projectToMidiConfig(phrase);
    expect(config.sfx[SoundEffectIds.SPAWN].phrase).to.deep.equal({ enabled: true, mode: 'down', spacingTicks: 2 });
    expect(config.sfx[SoundEffectIds.SPAWN].notes).to.have.length(5);
    expect(config.sfx[SoundEffectIds.SPAWN].velocity).to.equal(42);
    expect(config.sfx[SoundEffectIds.SPAWN].arp).to.equal(undefined);
    expect(config.sfx[SoundEffectIds.LAND].note).to.equal(48);
    expect(config.sfx[SoundEffectIds.LAND]).to.not.have.property('arp');
    expect(config.sfx[SoundEffectIds.LAND]).to.not.have.property('phrase');
    expect(config.velocityRange).to.deep.equal(project.global.velocityRange);
    expect(importMidiProjectPayload(stringifyMidiProjectExport(phrase))).to.deep.equal(phrase);
    expect(() => applyGameEventMidiPreset(project, 'game-major', { mode: 'invalid' })).to.throw('playback mode');
    const steps = projectToMidiConfig(applyGameEventMidiPreset(phrase, 'game-major', { mode: 'steps' }));
    expect(steps.sfx[SoundEffectIds.SPAWN]).to.not.have.property('phrase');
    expect(steps.sfx[SoundEffectIds.LAND].note).to.equal(48);
  });
});
