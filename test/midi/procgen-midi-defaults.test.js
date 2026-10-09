import { expect } from 'chai';
import { applyProcgenGameEventMidiPreset } from '../../js/midi/project/ProcgenMidiDefaults.js';
import { GAME_EVENT_MIDI_PRESETS, applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { createMidiProject, createMidiProjectFromMidiConfig, reduceMidiProject, projectToMidiConfig,
  stringifyMidiProjectExport, importMidiProjectPayload } from '../../js/midi/project/MidiProject.js';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const spawn = project => project.sources.find(source => source.kind === 'sfx' && source.sourceKey === String(SoundEffectIds.SPAWN));

describe('procgen spawn MIDI policy', function() {
  it('softens only fresh procgen spawn mappings across palettes and playback modes', function() {
    for (const preset of GAME_EVENT_MIDI_PRESETS) for (const mode of ['steps', 'phrase']) {
      const base = createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} });
      const original = applyGameEventMidiPreset(base, preset.id, { mode });
      const procgen = applyProcgenGameEventMidiPreset(base, preset.id, { mode });
      expect(spawn(procgen).mapping).to.include({ velocity: 32, priority: 0 });
      const withoutSpawn = project => project.sources.filter(source => source.id !== spawn(project).id);
      expect(withoutSpawn(procgen)).to.deep.equal(withoutSpawn(original));
      for (const key of ['global', 'tracks', 'ensemble', 'transport', 'enabled', 'devices', 'clips', 'automation']) {
        expect(procgen[key], key).to.deep.equal(original[key]);
      }
      expect(spawn(procgen).mapping.phrase).to.deep.equal(spawn(original).mapping.phrase);
      expect(spawn(procgen).mapping.notes).to.deep.equal(spawn(original).mapping.notes);
      expect(spawn(original).mapping.velocity).to.be.greaterThan(32);
    }
  });

  it('preserves saved loudness and event priority through preset changes and enablement', function() {
    let project = applyProcgenGameEventMidiPreset(createMidiProject(), 'game-major');
    project = reduceMidiProject(project, { type: 'source.mapping.update', sourceId: spawn(project).id,
      patch: { velocity: 117, priority: 4 } });
    project = importMidiProjectPayload(stringifyMidiProjectExport(project));
    project = applyProcgenGameEventMidiPreset(project, 'game-iron-ensemble', { mode: 'phrase' });
    project = reduceMidiProject(project, { type: 'enabled.set', enabled: true });
    expect(spawn(project).mapping).to.include({ velocity: 117, priority: 4 });
    const config = projectToMidiConfig(project);
    expect(config.sfx[SoundEffectIds.SPAWN]).to.include({ velocity: 117, priority: 4, eventPriority: 4 });
    const spec = new MidiMapping(config).mapEvent({ sfxId: SoundEffectIds.SPAWN, lemmingId: 0, laneIndex: 0 });
    expect(spec.priority).to.equal(4);
    expect(spec.velocity).to.be.greaterThan(80);
  });

  it('uses lowest spawn event priority without replacing other edited ensemble track priorities', function() {
    let project = applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true }), 'game-iron-ensemble');
    project = reduceMidiProject(project, { type: 'track.update', trackId: 'ensemble-bass', patch: { priority: 7 } });
    const mapping = new MidiMapping(projectToMidiConfig(project));
    const event = { lemmingId: 0, laneIndex: 0 };
    expect(mapping.mapEvent({ ...event, sfxId: SoundEffectIds.SPAWN }).priority).to.equal(0);
    expect(mapping.mapEvent({ ...event, sfxId: SoundEffectIds.BUILDER_STEP }).priority).to.equal(7);
    const legacy = projectToMidiConfig(applyGameEventMidiPreset(createMidiProject(), 'game-major'));
    expect(legacy.sfx[SoundEffectIds.SPAWN].priority).to.equal(1);
  });

  it('dispatches quieter spawn notes fairly and releases their gates under the existing output budget', function() {
    withFakeClockAndPerformance(clock => {
      const project = applyProcgenGameEventMidiPreset(createMidiProject({ enabled: true }), 'game-iron-ensemble');
      const config = projectToMidiConfig(project);
      const calls = [], accepted = [];
      const output = makeOutput([1, 2, 3, 4, 10], calls, 'fake-local');
      output.supportsPerNoteInstrument = true; output.supportsPerNotePan = true;
      const router = new MidiEventRouter(config);
      router.setOutput(output);
      const send = router.scheduler.sendNote.bind(router.scheduler);
      router.scheduler.sendNote = (spec, meta) => {
        const ok = send(spec, meta);
        if (ok) accepted.push({ lane: meta.laneIndex, priority: meta.priority, sfx: meta.sfxId, velocity: spec.velocity });
        return ok;
      };
      try {
        for (let laneIndex = 0; laneIndex < 4; laneIndex += 1) {
          router._onEvent({ sfxId: SoundEffectIds.SPAWN, lemmingId: 4 - laneIndex, laneIndex, laneCount: 4, tick: 0 });
        }
        expect(accepted.map(note => note.lane)).to.deep.equal([0, 1, 2, 3]);
        expect(accepted.every(note => note.priority === 0)).to.equal(true);
        clock.tick(400);
        for (let laneIndex = 0; laneIndex < 4; laneIndex += 1) {
          router._onEvent({ sfxId: SoundEffectIds.BUILDER_STEP, lemmingId: 4 - laneIndex, laneIndex, laneCount: 4, tick: 1 });
        }
        const quiet = accepted.filter(note => note.sfx === SoundEffectIds.SPAWN);
        const action = accepted.filter(note => note.sfx === SoundEffectIds.BUILDER_STEP);
        expect(action).to.have.length(4);
        expect(quiet.every((note, index) => note.velocity < action[index].velocity)).to.equal(true);
        clock.tick(500);
        expect(calls.filter(call => call.type === 'noteOff')).to.have.length(calls.filter(call => call.type === 'noteOn').length);
        router._onEvent({ sfxId: SoundEffectIds.SPAWN, lemmingId: 8, laneIndex: 0, laneCount: 4, tick: 2 });
        const used = router.scheduler.getRateSnapshot();
        router.scheduler.allNotesOff({ preserveRateHistory: true });
        expect(router.scheduler._activeNotes.size).to.equal(0);
        expect(router.scheduler._pendingNoteOns.size).to.equal(0);
        expect(router.scheduler.getRateSnapshot().past.count + router.scheduler.getRateSnapshot().next.count)
          .to.be.at.least(used.past.count + used.next.count);
        expect(calls.some(call => call.type === 'allNotesOff')).to.equal(true);
      } finally { router.dispose(); }
    });
  });
});
