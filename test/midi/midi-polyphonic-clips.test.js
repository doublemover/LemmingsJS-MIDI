import { expect } from 'chai';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { buildMidiClipRecording, MAX_MIDI_CLIP_CAPTURE_NOTES } from '../../js/midi/project/MidiClipRecording.js';
import { expandMidiClipCell } from '../../js/midi/project/MidiClipTransforms.js';
import { createMidiProjectFromMidiConfig, reduceMidiProject, sanitizeMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { createSoundAuditionPlan } from '../../js/app/midi-ui/midiSoundAudition.js';
import { buildMidiClipPhrase, flattenMidiClipPhrase } from '../../js/midi/project/MidiClipPlayback.js';
const cfg = sequence => ({ enabled: true, mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 },
  scale: { name: 'chromatic', root: 0 }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 },
  durationTicks: { min: 1, max: 960, default: 4 }, sfx: { 20: { note: 60, channel: 1, clipSequence: sequence } } });
const voices = [{ note: 60, velocity: 45, durationTicks: 5 }, { note: 64, velocity: 95, durationTicks: 2 }];
const layers = [{ type: 'repeat', count: 2, spacingTicks: 2, transpose: 7 }, { type: 'pitch', transpose: 12, condition: { unit: 'event', every: 2, phase: 0 } }];
describe('polyphonic temporal clips and ordered transforms', function() {
  it('captures overlapping onset voices, merges same-pitch overdubs, and preserves untouched cells and modifiers', function() {
    const existing = [{ note: 60, velocity: 33, durationTicks: 3, voices: [{ note: 60, velocity: 33, durationTicks: 3 }, { note: 67, velocity: 44, durationTicks: 7 }],
      probability: 0.7, hold: true, transforms: { transpose: 2 }, transformLayers: layers }, { note: null }, { note: 72, velocity: 50, durationTicks: 9, condition: { unit: 'bar', every: 2 }, transformLayers: layers }];
    const result = buildMidiClipRecording([{ note: 64, velocity: 95, onsetMs: 105, durationMs: 240, order: 1 },
      { note: 60, velocity: 90, onsetMs: 100, durationMs: 600, order: 0 }], { length: 8, tickMs: 60, spacingTicks: 2, polyphonic: true, mode: 'overdub', existingSteps: existing });
    expect(result.steps[0].voices).to.deep.equal([{ note: 60, velocity: 90, durationTicks: 10 }, { note: 67, velocity: 44, durationTicks: 7 }, { note: 64, velocity: 95, durationTicks: 4 }]);
    expect(result.steps[0]).to.include({ hold: true, probability: 0.7 });
    expect(result.steps[0].transforms).to.deep.equal(existing[0].transforms);
    expect(result.steps[0].transformLayers).to.deep.equal(layers);
    expect(result.steps[2]).to.deep.equal({ ...existing[2], index: 2 });
    expect(existing[0].voices[0].velocity).to.equal(33); expect(result).to.include({ updated: 1, added: 1 });
  });
  it('retains scalar defaults and bounds actual captured admissions, voices and layer expansion', function() {
    const mono = buildMidiClipRecording([{ note: 60, velocity: 80, onsetMs: 0, durationMs: 120 }, { note: 64, velocity: 90, onsetMs: 10, durationMs: 240 }], { length: 8 });
    expect(mono.steps[0]).not.to.have.property('voices'); expect(mono.steps[0].note).to.equal(64); expect(mono.collisions).to.equal(1);
    const notes = Array.from({ length: MAX_MIDI_CLIP_CAPTURE_NOTES + 4 }, (_, index) => ({ note: 40 + index % 20, velocity: 80, onsetMs: 0, durationMs: 120 }));
    const poly = buildMidiClipRecording(notes, { length: 8, polyphonic: true });
    expect(poly.steps[0].voices).to.have.length(8); expect(poly.overflow).to.be.greaterThan(4);
    expect(expandMidiClipCell({ velocity: 77, durationTicks: 6, voices: [{ note: 64, velocity: null, durationTicks: null }] }, 1, 1).notes[0]).to.include({ note: 64, velocity: 77, durationTicks: 6 });
    const step = { voices: Array.from({ length: 8 }, (_, index) => ({ note: 50 + index })), transformLayers: [{ type: 'repeat', count: 8 }, { type: 'repeat', count: 8 }] };
    const expanded = expandMidiClipCell(step, 1, 1); expect(expanded.notes).to.have.length(16); expect(expanded.truncated).to.equal(160);
    const phrase = flattenMidiClipPhrase(buildMidiClipPhrase({ id: 'cap', spacingTicks: 2, steps: Array.from({ length: 16 }, () => step) }, 1, 1, voice => ({ ...voice, durationTicks: 1 })), 2);
    expect(phrase.entries).to.have.length(257); expect(phrase.truncated).to.equal(2560);
  });
  it('round trips optional voices/layers and keeps scalar first-voice edits from discarding independent voices', function() {
    let project = createMidiProjectFromMidiConfig(cfg(null));
    project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'poly', lengthSteps: 8, playback: { advance: 'game-tick', spacingTicks: 2 }, steps: [{ note: 60, voices, transformLayers: layers }] } });
    project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: project.sources[0].id, clipId: 'poly' });
    const clean = sanitizeMidiProject(JSON.parse(JSON.stringify(project)));
    expect(clean.clips[0].steps[0].voices).to.deep.equal(voices); expect(clean.clips[0].steps[0].transformLayers).to.have.length(2);
    const edited = reduceMidiProject(clean, { type: 'clip.step.update', clipId: 'poly', stepIndex: 0, patch: { note: 62, velocity: 70 } });
    expect(edited.clips[0].steps[0].voices).to.deep.equal([{ ...voices[0], note: 62, velocity: 70 }, voices[1]]);
    expect(projectToMidiConfig(edited).sfx[20].clipSequence.steps[0].voices).to.deep.equal(edited.clips[0].steps[0].voices);
    const bad = reduceMidiProject(clean, { type: 'clip.step.update', clipId: 'poly', stepIndex: 0, patch: { voices: {}, transformLayers: {} } });
    expect(bad.clips[0].steps[0].voices).to.deep.equal([]); expect(bad.clips[0].steps[0].transformLayers).to.deep.equal([]);
  });
  it('applies layer order before scale/range mapping and separates event, pass and bar conditions', function() {
    const step = { note: 120, transformLayers: [{ type: 'repeat', count: 2, transpose: 12, spacingTicks: 3 }, { type: 'pitch', transpose: -12 }] };
    expect(expandMidiClipCell(step, 1, 1).notes.map(note => [note.note, note.offsetTicks])).to.deep.equal([[108, 0], [115, 3]]);
    step.transformLayers.reverse(); expect(expandMidiClipCell(step, 1, 1).notes.map(note => note.note)).to.deep.equal([108, 120]);
    step.note = 60; step.transformLayers = [{ type: 'pitch', transpose: 1, condition: { unit: 'event', every: 2 } },
      { type: 'pitch', transpose: 2, condition: { unit: 'pass', every: 2 } }, { type: 'pitch', transpose: 4, condition: { unit: 'bar', every: 2 } }];
    expect(expandMidiClipCell(step, 2, 1, 1).notes[0].note).to.equal(61);
    expect(expandMidiClipCell(step, 1, 2, 2).notes[0].note).to.equal(66);
  });
  it('dispatches independent overlapping gates and deferred repeats on existing game ticks; Panic cancels future notes', function() {
    withFakeClockAndPerformance(clock => {
      const sequence = { id: 'poly', advance: 'game-tick', spacingTicks: 2, steps: [{ voices, transformLayers: layers }, { note: null }] };
      const router = new MidiEventRouter(cfg(sequence)), calls = [], timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; }, get tps() { return 1000 / this.frameTime; } };
      router.setOutput(makeOutput([1], calls)); router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      const advance = () => { clock.tick(timer.frameTime); timer.tick++; timer.onGameTick.trigger(); };
      try {
        router._onEvent({ sfxId: 20, tick: 0, frameMs: 60, lemmingId: 7 });
        expect(calls.filter(call => call.type === 'noteOn').map(call => [call.note, call.opts.rawAttack])).to.deep.equal([[60, 45], [64, 95]]);
        clock.tick(40); expect(calls.filter(call => call.type === 'noteOn')).to.have.length(2);
        advance(); advance(); expect(calls.filter(call => call.type === 'noteOn').map(call => call.note)).to.deep.equal([60, 64, 67, 71]);
        expect(calls.filter(call => call.type === 'noteOff').map(call => call.note)).to.include(64).and.not.include(60);
        router._onEvent({ sfxId: 20, tick: 2, frameMs: 60, lemmingId: 7 });
        expect(calls.filter(call => call.type === 'noteOn').slice(-2).map(call => call.note)).to.deep.equal([72, 76]);
        const count = calls.filter(call => call.type === 'noteOn').length;
        router.scheduler.allNotesOff(); for (let i = 0; i < 10; i++) advance();
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(count); expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
        expect(router.scheduler._activeNotes.size).to.equal(0);
      } finally { router.dispose(); }
    });
  });
  it('keeps event-cell lookahead and repeat tick order while applying project scale/range at output', function() {
    withFakeClockAndPerformance(clock => {
      const sequence = { id: 'event-poly', advance: 'event', spacingTicks: 2, steps: [{ voices, transformLayers: [{ type: 'repeat', count: 2, spacingTicks: 2, transpose: 7 }, { type: 'pitch', transpose: 1 }] }] };
      const settings = { ...cfg(sequence), timing: { scheduleAheadMs: 20 }, scale: { name: 'major', root: 0, degrees: [0, 2, 4, 5, 7, 9, 11] }, noteRange: { min: 60, max: 72 } };
      const router = new MidiEventRouter(settings), calls = [], timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; }, get tps() { return 1000 / this.frameTime; } };
      router.setOutput(makeOutput([1], calls)); router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      try {
        router._onEvent({ sfxId: 20, tick: 0, frameMs: 60 }); clock.tick(60); timer.tick = 1; timer.onGameTick.trigger();
        clock.tick(60); timer.tick = 2; timer.onGameTick.trigger(); clock.tick(20);
        const on = calls.filter(call => call.type === 'noteOn'); expect(on.map(call => call.opts.time)).to.deep.equal([20, 20, 140, 140]);
        expect(on.every(call => call.note >= 60 && call.note <= 72 && [0, 2, 4, 5, 7, 9, 11].includes(call.note % 12))).to.equal(true);
      } finally { router.dispose(); }
    });
  });

  it('uses actual scheduler admission for expanded notes and gives local audition the same bounded expansion without output activation', function() {
    withFakeClockAndPerformance(clock => {
      const step = { voices: Array.from({ length: 8 }, (_, index) => ({ note: 50 + index, velocity: 80, durationTicks: 5 })), transformLayers: [{ type: 'repeat', count: 8, spacingTicks: 1 }] };
      const sequence = { id: 'cap', advance: 'game-tick', spacingTicks: 2, steps: Array.from({ length: 16 }, () => step) };
      const settings = { ...cfg(sequence), limits: { maxEventsPerSecond: 4, maxBytesPerSecond: 500, maxEventsPerTick: 4 } };
      const router = new MidiEventRouter(settings), calls = [], timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; }, get tps() { return 1000 / this.frameTime; } };
      router.setOutput(makeOutput([1], calls)); router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      try {
        router._onEvent({ sfxId: 20, tick: 0, frameMs: 60 });
        for (let i = 0; i < 10; i++) { clock.tick(60); timer.tick++; timer.onGameTick.trigger(); }
        expect(calls.filter(call => call.type === 'noteOn').length).to.be.at.most(4);
        expect(router.getOutputPressure().dropped).to.be.greaterThan(0); router.scheduler.allNotesOff();
      } finally { router.dispose(); }
      let project = createMidiProjectFromMidiConfig(cfg(null)); project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'cap', lengthSteps: 16, playback: { advance: 'game-tick', spacingTicks: 2 }, steps: sequence.steps } });
      project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: project.sources[0].id, clipId: 'cap' });
      project.enabled = false; const snapshot = JSON.stringify(project);
      const plan = createSoundAuditionPlan(project.sources[0], project, 60);
      expect(plan.notes).to.have.length(64); expect(plan.omitted).to.equal(960); expect(JSON.stringify(project)).to.equal(snapshot); expect(project.enabled).to.equal(false);
      expect(plan.notes[0]).to.include({ note: 50, durationMs: 300, velocity: 80 });
    });
  });
});
