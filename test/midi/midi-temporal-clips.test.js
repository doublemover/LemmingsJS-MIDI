import { expect } from 'chai';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { projectToMidiConfig, createMidiProjectFromMidiConfig, sanitizeMidiProject, reduceMidiProject } from '../../js/midi/project/MidiProject.js';
import { buildMidiClipPhrase, clipCellEnabled } from '../../js/midi/project/MidiClipPlayback.js';
import { createEventClipProject, parseClipNote } from '../../js/app/midi-ui/midiEventClipEditor.js';
import { createSoundAuditionPlan } from '../../js/app/midi-ui/midiSoundAudition.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { EventHandler } from '../../js/util/EventHandler.js';

const sequence = (advance = 'event') => ({ id: 'cells', advance, spacingTicks: 2, steps: [
  { index: 0, note: 60, velocity: 40, durationTicks: 1, probability: 1 },
  { index: 1, note: null },
  { index: 2, note: 64, velocity: 110, durationTicks: 2, probability: 1 },
  { index: 3, note: 67, velocity: 90, durationTicks: 1, condition: { unit: 'pass', every: 2 } }
] });
const config = cells => ({ enabled: true, mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 },
  scale: { name: 'chromatic', root: 0 }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 },
  durationTicks: { min: 1, max: 960, default: 4 }, sfx: { 20: { note: 60, channel: 1, clipSequence: cells } } });

describe('explicit temporal MIDI clips', function() {
  it('advances over rests, loops cells, distinguishes passes and applies cell dynamics at actual dispatch', function() {
    withFakeClockAndPerformance(clock => {
      const router = new MidiEventRouter(config(sequence())), calls = []; router.setOutput(makeOutput([1], calls));
      try {
        for (let index = 0; index < 8; index += 1) { router._onEvent({ sfxId: 20, tick: index, frameMs: 60 }); clock.tick(60); }
        const notes = calls.filter(call => call.type === 'noteOn');
        expect(notes.map(call => call.note)).to.deep.equal([60, 64, 60, 64, 67]);
        expect(notes.map(call => call.opts.rawAttack)).to.deep.equal([40, 110, 40, 110, 90]);
        expect(notes.map(call => call.opts.time)).to.deep.equal([0, 120, 240, 360, 420]);
        expect(router.getEventPlaybackState({ sfxId: 20 }).nextIndex).to.equal(0);
        router.setMapping(config({ ...sequence(), steps: sequence().steps.map(step => ({ ...step, note: step.note == null ? null : step.note + 12 })) }));
        router._onEvent({ sfxId: 20, tick: 8, frameMs: 60 }); expect(calls.filter(call => call.type === 'noteOn').at(-1).note).to.equal(72);
      } finally { router.dispose(); }
    });
  });

  it('uses the existing game-tick queue with rest spacing, pause, speed changes and Panic cancellation', function() {
    withFakeClockAndPerformance(clock => {
      const router = new MidiEventRouter(config(sequence('game-tick'))), calls = []; router.setOutput(makeOutput([1], calls));
      const timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; }, get tps() { return 1000 / this.frameTime; } };
      router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      const advance = () => { clock.tick(timer.frameTime); timer.tick += 1; timer.onGameTick.trigger(); };
      try {
        router._onEvent({ sfxId: 20, tick: 0, frameMs: 60 }); clock.tick(500);
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(1);
        advance(); advance(); expect(calls.filter(call => call.type === 'noteOn')).to.have.length(1);
        timer.frameTime = 30; advance(); advance();
        const notes = calls.filter(call => call.type === 'noteOn'); expect(notes.map(call => call.note)).to.deep.equal([60, 64]);
        expect(notes[1].opts.time).to.equal(680); expect(notes[1].opts.rawAttack).to.equal(110);
        router.scheduler.allNotesOff(); for (let i = 0; i < 8; i += 1) advance();
        expect(calls.filter(call => call.type === 'noteOn')).to.have.length(2);
      } finally { router.dispose(); }
    });
  });

  it('keeps probability repeatable, separates event and pass conditions, and gives Hold/Tie bounded phrase gates', function() {
    const cells = sequence();
    const step = { index: 1, note: 60, probability: 0.5, condition: { unit: 'event', every: 2 } };
    expect(clipCellEnabled(cells, step, 1, 2)).to.equal(false);
    const outcomes = Array.from({ length: 40 }, (_, index) => clipCellEnabled(cells, step, (index + 1) * 2, 1));
    expect(outcomes).to.deep.equal(Array.from({ length: 40 }, (_, index) => clipCellEnabled(cells, step, (index + 1) * 2, 1)));
    expect(outcomes).to.include(true).and.include(false);
    expect(clipCellEnabled(cells, { ...step, probability: 1, condition: { unit: 'pass', every: 2 } }, 1, 2)).to.equal(true);
    const phrase = { ...cells, steps: [{ note: 60, hold: true, durationTicks: 1 }, { note: 60, tie: true }, { note: null }, { note: 67, durationTicks: 1 }] };
    expect(buildMidiClipPhrase(phrase, 1, 1, entry => entry)[0].durationTicks).to.equal(6);
    phrase.steps[0].hold = false;
    expect(buildMidiClipPhrase(phrase, 1, 1, entry => entry)[0].durationTicks).to.equal(3);
  });

  it('creates one reusable clip, persists temporal fields and supports audition rests without mutating old clips', function() {
    const project = createMidiProjectFromMidiConfig(config(null)), source = project.sources[0];
    const next = createEventClipProject(project, source), assigned = next.sources.find(item => item.id === source.id), clip = next.clips.find(item => item.id === assigned.clipId);
    expect(assigned.mode).to.equal('clip'); expect(clip.lengthSteps).to.equal(8); expect(clip.playback.advance).to.equal('event');
    const clean = sanitizeMidiProject(JSON.parse(JSON.stringify(next)));
    expect(clean.clips.find(item => item.id === clip.id).playback).to.deep.equal(clip.playback);
    const runtime = projectToMidiConfig(clean); expect(runtime.sfx[20].clipSequence.steps).to.have.length(8);
    expect(createSoundAuditionPlan(assigned, clean, 60, 0).notes[0].note).to.equal(60);
    expect(createSoundAuditionPlan(assigned, clean, 60, 1)).to.include({ advance: true });
    expect(createSoundAuditionPlan(assigned, clean, 60, 1).notes).to.have.length(0);
    const legacy = reduceMidiProject(clean, { type: 'clip.update', clipId: clip.id, patch: { playback: null } });
    expect(projectToMidiConfig(legacy).sfx[20]).not.to.have.property('clipSequence');
    expect(project).not.to.equal(next); expect(project.sources[0].mode).to.equal('direct');
  });

  it('accepts chromatic note names, accidentals, MIDI endpoints and rests, rejecting malformed notes', function() {
    expect(['C4', 'F#4', 'Db4', '0', '127', 'rest', '-'].map(parseClipNote)).to.deep.equal([60, 66, 61, 0, 127, null, null]);
    for (const raw of ['C10', '128', '-2', 'banana']) expect(parseClipNote(raw)).to.equal(undefined);
  });
});
