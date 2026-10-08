import { expect } from 'chai';
import { getMidiTransportBar, clipConditionMatches, applyMidiClipTransforms, buildMidiClipPhrase } from '../../js/midi/project/MidiClipPlayback.js';
import { buildMidiClipRecording } from '../../js/midi/project/MidiClipRecording.js';
import { createMidiProjectFromMidiConfig, sanitizeMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { EventHandler } from '../../js/util/EventHandler.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { makeOutput } from '../support/midi-output.js';
import { createSoundAuditionPlan } from '../../js/app/midi-ui/midiSoundAudition.js';

const cfg = cells => ({ enabled: true, mpe: { enabled: false }, scale: { name: 'chromatic', root: 0 }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 }, durationTicks: { min: 1, max: 960, default: 4 }, density: { velocityBoost: 0, durationScale: 0 }, timing: { bpmBase: 120, timeSignature: { beats: 4, unit: 4 } }, sfx: { 20: { note: 60, channel: 1, clipSequence: cells } } });

describe('MIDI clip step components', function() {
  it('keeps event, pass and trigger-bar conditions distinct with explicit zero-based phases', function() {
    expect(clipConditionMatches({ unit: 'event', every: 3 }, 6, 1, 2)).to.equal(true);
    expect(clipConditionMatches({ unit: 'pass', every: 3 }, 6, 1, 2)).to.equal(false);
    expect(clipConditionMatches({ unit: 'bar', every: 2 }, 5, 3, 2)).to.equal(true);
    expect([1, 2, 3, 4, 5, 6].filter(n => clipConditionMatches({ unit: 'event', every: 3, phase: 1 }, n, 1, 1))).to.deep.equal([1, 4]);
    expect(clipConditionMatches(null, 1, 1, 1)).to.equal(true);
  });
  it('derives musical bars from simulation ticks, BPM and signature rather than trigger density or speed', function() {
    const timing = cfg().timing;
    expect([0, 33, 34, 66, 67].map(tick => getMidiTransportBar(timing, tick))).to.deep.equal([1, 1, 2, 2, 3]);
    expect(getMidiTransportBar({ bpmBase: 120, timeSignature: { beats: 3, unit: 8 } }, 13)).to.equal(2);
    expect(getMidiTransportBar({ ...timing, bpmBase: 60 }, 34)).to.equal(1);
    expect(getMidiTransportBar(timing, -4)).to.equal(1);
  });
  it('composes transpose, octave and cyclic ramp layers without mutating entered notes or emitting illegal pitches', function() {
    const step = { note: 60, transforms: { transpose: 2, octave: 1, interval: -3, span: 3, unit: 'pass' } };
    expect([1, 2, 3, 4].map(pass => applyMidiClipTransforms(step, 9, pass, 7).note)).to.deep.equal([74, 71, 68, 74]);
    expect(step.note).to.equal(60);
    expect(applyMidiClipTransforms({ ...step, note: 125 }, 1, 1).note).to.equal(127);
    expect(applyMidiClipTransforms({ note: 0, transforms: { transpose: -48, octave: -4 } }, 1, 1).note).to.equal(0);
    expect(applyMidiClipTransforms({ note: null }, 1, 1)).to.deep.equal({ note: null });
    expect(applyMidiClipTransforms({ note: 60, transforms: { unit: 'bar', span: 4, interval: 2 } }, 8, 5, 3).note).to.equal(64);
  });
  it('applies conditions to ties and shares one sampled bar across a triggered phrase', function() {
    const seq = { id: 'ties', spacingTicks: 2, steps: [{ note: 60, durationTicks: 1 }, { tie: true, condition: { unit: 'bar', every: 2 } }, { note: 67, condition: { unit: 'bar', every: 2 }, transforms: { octave: 1 } }] };
    expect(buildMidiClipPhrase(seq, 3, 1, s => s, 1).map(c => c.note)).to.deep.equal([60, null, null]);
    const second = buildMidiClipPhrase(seq, 3, 1, s => s, 2);
    expect(second[0].durationTicks).to.equal(3); expect(second[2].note).to.equal(79);
  });
  it('preserves legacy pass defaults and sanitizes new layers, condition phases and timing through export lowering', function() {
    const p = createMidiProjectFromMidiConfig(cfg());
    p.clips = [{ id: 'layers', name: 'Layers', type: 'stepPattern', lengthSteps: 8, playback: { advance: 'game-tick', spacingTicks: 2, passCounter: 'completed' }, steps: [{ note: 60, condition: { unit: 'bar', every: 3, phase: 90 }, transforms: { transpose: 90, octave: -90, interval: 90, span: 90, unit: 'bar' } }] }];
    p.sources[0] = { ...p.sources[0], mode: 'clip', clipId: 'layers' };
    const clean = sanitizeMidiProject(p), cell = clean.clips[0].steps[0];
    expect(cell.condition).to.deep.equal({ unit: 'bar', every: 3, phase: 2 });
    expect(cell.transforms).to.deep.equal({ transpose: 48, octave: -4, interval: 12, span: 16, unit: 'bar' });
    expect(projectToMidiConfig(clean).sfx[20].clipSequence.passCounter).to.equal('completed');
    delete p.clips[0].playback.passCounter; expect(sanitizeMidiProject(p).clips[0].playback).not.to.have.property('passCounter');
  });
  it('counts completed phrases only when their final cell is consumed; retriggers and wall-clock pause do not complete them', function() {
    withFakeClockAndPerformance(clock => {
      const seq = { id: 'completion', advance: 'game-tick', spacingTicks: 2, passCounter: 'completed', steps: [{ note: 60, velocity: 80, durationTicks: 1, condition: { unit: 'pass', every: 2 }, transforms: { unit: 'pass', interval: 2, span: 4 } }, { note: null }] };
      const router = new MidiEventRouter(cfg(seq)), calls = []; router.setOutput(makeOutput([1], calls));
      const timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; } };
      router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      const next = () => { clock.tick(timer.frameTime); timer.tick += 1; timer.onGameTick.trigger(); };
      try {
        router._onEvent({ sfxId: 20, tick: 0 }); clock.tick(1000);
        expect(router.getEventPlaybackState({ sfxId: 20 }).completedPasses).to.equal(0);
        next(); router._onEvent({ sfxId: 20, tick: 1 }); next(); next();
        expect(router.getEventPlaybackState({ sfxId: 20 })).to.include({ eventCount: 2, passCount: 1, completedPasses: 1 });
        next(); router._onEvent({ sfxId: 20, tick: 4 });
        expect(calls.filter(c => c.type === 'noteOn').map(c => c.note)).to.deep.equal([62]);
        expect(router.getEventPlaybackState({ sfxId: 20 })).to.include({ eventCount: 3, passCount: 2 });
        router.scheduler.allNotesOff(); next(); next(); expect(router.getEventPlaybackState({ sfxId: 20 }).completedPasses).to.equal(1);
      } finally { router.dispose(); }
    });
  });
  it('preserves temporal counters when effective speed rebases the output clock and resets them on tick rewind', function() {
    withFakeClockAndPerformance(clock => {
      const seq = { id: 'speed', advance: 'event', spacingTicks: 2, steps: [{ note: 60, velocity: 80, durationTicks: 1 }] };
      const router = new MidiEventRouter(cfg(seq)); router.setOutput(makeOutput([1], []));
      try {
        router._onEvent({ sfxId: 20, tick: 5, timeMs: 300, frameMs: 60, speedFactor: 1 }); clock.tick(60);
        router._onEvent({ sfxId: 20, tick: 6, timeMs: 180, frameMs: 30, speedFactor: 2 });
        expect(router.getEventPlaybackState({ sfxId: 20 }).eventCount).to.equal(2);
        router._onEvent({ sfxId: 20, tick: 0, timeMs: 0, frameMs: 30, speedFactor: 2 });
        expect(router.getEventPlaybackState({ sfxId: 20 })).to.include({ eventCount: 1, passCount: 1, triggerBar: 1 });
      } finally { router.dispose(); }
    });
  });
  it('resets completed phrase counts when the level tick clock rewinds without another note event', function() {
    withFakeClockAndPerformance(clock => {
      const seq = { id: 'rewind', advance: 'game-tick', spacingTicks: 1, passCounter: 'completed', steps: [{ note: 60, velocity: 80, durationTicks: 1 }, { note: null }] };
      const router = new MidiEventRouter(cfg(seq)); router.setOutput(makeOutput([1], []));
      const timer = { tick: 5, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; } }; router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      try {
        router._onEvent({ sfxId: 20, tick: 5 }); clock.tick(60); timer.tick = 6; timer.onGameTick.trigger();
        expect(router.getEventPlaybackState({ sfxId: 20 }).completedPasses).to.equal(1);
        timer.tick = 0; timer.onGameTick.trigger(); expect(router.getEventPlaybackState({ sfxId: 20 }).eventCount).to.equal(0);
      } finally { router.dispose(); }
    });
  });
  it('uses bar conditions and layered notes consistently in event dispatch and independent local tests', function() {
    const seq = { id: 'bars', advance: 'event', spacingTicks: 2, steps: [{ note: 60, velocity: 80, durationTicks: 1, condition: { unit: 'bar', every: 2 }, transforms: { transpose: 5 } }] };
    withFakeClockAndPerformance(clock => {
      const router = new MidiEventRouter(cfg(seq)), calls = []; router.setOutput(makeOutput([1], calls));
      try { router._onEvent({ sfxId: 20, tick: 0 }); clock.tick(60); router._onEvent({ sfxId: 20, tick: 34 }); expect(calls.filter(c => c.type === 'noteOn').map(c => c.note)).to.deep.equal([65]); } finally { router.dispose(); }
    });
    const p = createMidiProjectFromMidiConfig(cfg()); p.clips = [{ id: 'bars', name: 'Bars', type: 'stepPattern', lengthSteps: 8, playback: { advance: 'event', spacingTicks: 2 }, steps: seq.steps }]; p.sources[0] = { ...p.sources[0], mode: 'clip', clipId: 'bars' };
    expect(createSoundAuditionPlan(p.sources[0], p, 60, 0, { tick: 0 }).notes).to.have.length(0);
    expect(createSoundAuditionPlan(p.sources[0], p, 60, 0, { tick: 34 }).notes[0].note).to.equal(65);
  });
});

describe('bounded MIDI onset recording', function() {
  it('keeps gaps and overlapping lengths despite reversed note-off order, with latest onset/order winning collisions', function() {
    const result = buildMidiClipRecording([{ note: 67, velocity: 88, onsetMs: 460, durationMs: 120, order: 2 }, { note: 60, velocity: 90, onsetMs: 100, durationMs: 600, order: 0 }, { note: 64, velocity: 95, onsetMs: 105, durationMs: 300, order: 1 }, { note: 72, velocity: 100, onsetMs: 460, durationMs: 60, order: 3 }], { length: 8, tickMs: 60, spacingTicks: 2 });
    expect(result.steps.map(s => s.note)).to.deep.equal([64, null, null, 72, null, null, null, null]);
    expect(result.steps[0].durationTicks).to.equal(5); expect(result).to.include({ collisions: 2, outside: 0, retained: 2 });
  });
  it('uses nearest-cell quantization, bounds duration and reports notes outside the 8/16-cell window', function() {
    const result = buildMidiClipRecording([{ note: 60, velocity: 90, onsetMs: 0, durationMs: 10, order: 0 }, { note: 62, velocity: 90, onsetMs: 61, durationMs: 10000, order: 1 }, { note: 64, velocity: 90, onsetMs: 960, durationMs: 120, order: 2 }], { length: 8, tickMs: 60, spacingTicks: 2, minDuration: 2, maxDuration: 8 });
    expect(result.steps[0].durationTicks).to.equal(2); expect(result.steps[1]).to.include({ note: 62, durationTicks: 8 }); expect(result.outside).to.equal(1);
    expect(buildMidiClipRecording([], { length: 16 }).steps).to.have.length(16);
  });
});
