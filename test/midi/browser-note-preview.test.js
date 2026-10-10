import { expect } from 'chai';
import { EventHandler } from '../../js/util/EventHandler.js';
import { createMidiEventPlayback, getMidiEventPlaybackEnvelope } from '../../js/app/midi-ui/midiEventPlayback.js';
import { TestDocument } from '../helpers/test-dom.js';
import { readFileSync } from 'node:fs';
import { BrowserNotePreview, createBrowserNotePreview } from '../../js/app/midi-ui/browserNotePreview.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { createMidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { analyzeMidiOutputCapture } from '../../js/midi/capture/MidiCaptureAnalysis.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class FakeParam {
  constructor() { this.value = 1; this.events = []; }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'ramp', value, time }); }
  cancelScheduledValues(time) {
    this.events = this.events.filter(event => event.time < time);
  }
}

class FakeNode {
  constructor() { this.connections = []; this.disconnected = false; }
  connect(target) { this.connections.push(target); }
  disconnect() { this.disconnected = true; this.connections = []; }
}

class FakeOscillator extends FakeNode {
  constructor() {
    super();
    this.frequency = new FakeParam();
    this.detune = new FakeParam();
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }
  start(time) { this.starts.push(time); }
  stop(time) { this.stops.push(time); }
  end() { this.onended?.(); }
}

class FakeContext {
  constructor(state = 'running') {
    this.state = state;
    this.currentTime = 2;
    this.destination = {};
    this.oscillators = [];
    this.gains = [];
    this.panners = [];
    this.limiters = [];
    this.compressors = [];
    this.listeners = new Set();
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.resumeResult = null;
  }
  createGain() {
    const node = new FakeNode();
    node.gain = new FakeParam();
    this.gains.push(node);
    return node;
  }
  createWaveShaper() {
    const node = new FakeNode();
    this.limiters.push(node);
    return node;
  }
  createDynamicsCompressor() {
    const node = new FakeNode();
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new FakeParam();
    node.reduction = 0; this.compressors.push(node); return node;
  }
  createStereoPanner() {
    const node = new FakeNode();
    node.pan = new FakeParam();
    this.panners.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  addEventListener(name, callback) { this.listeners.add(callback); }
  removeEventListener(name, callback) { this.listeners.delete(callback); }
  resume() {
    this.resumeCalls += 1;
    if (this.resumeResult) return this.resumeResult;
    this.state = 'running';
    return Promise.resolve();
  }
  close() { this.closeCalls += 1; this.state = 'closed'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; for (const callback of this.listeners) callback(); }
}

const setup = (options = {}, context = new FakeContext()) => {
  let creations = 0;
  const preview = createBrowserNotePreview({
    createAudioContext: () => { creations += 1; return context; },
    nowMs: () => 1000,
    ...options
  });
  return { preview, context, creations: () => creations };
};

describe('BrowserNotePreview', function() {
  it('coalesces owner unlock requests and cancels replaced requests while another owner is waiting', async () => {
    const context = new FakeContext('suspended'), pending = deferred(); context.resumeResult = pending.promise;
    const { preview } = setup({}, context), game = preview.createSession('game'), audition = preview.createSession('audition');
    const gameReady = game.enable(); expect(game.enable()).to.equal(gameReady);
    const replaced = [];
    for (let i = 0; i < 12; i++) {
      replaced.push(audition.enable()); expect(preview._pendingEnables.size).to.equal(2);
      audition.stop(); expect(preview._pendingEnables.size).to.equal(1);
    }
    expect((await Promise.all(replaced)).every(value => value === false)).to.equal(true);
    context.state = 'running'; pending.resolve(); expect(await gameReady).to.equal(true);
    expect(context.resumeCalls).to.equal(1); expect(preview._pendingEnables.size).to.equal(0); await preview.dispose();
  });

  it('uses the audition bend range without retuning another owner on the same channel', async () => {
    const { preview, context } = setup();
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    await game.enable(); game.output.channels[2].sendNoteOn(60, { voiceToken: 1 });
    expect(await audition.preview([{ note: 64, channel: 2, pitchBend: 0.25, pitchBendRange: 12.5 }])).to.equal(true);
    expect(context.oscillators[0].detune.events.at(-1).value).to.equal(0);
    expect(context.oscillators[1].detune.events.at(-1).value).to.equal(312.5);
    await preview.dispose();
  });

  it('shares one graph and total voice budget while isolating owner channels, same-pitch gates and Stop', async () => {
    const { preview, context, creations } = setup({ maxVoices: 2 });
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    await game.enable(); await audition.enable();
    expect(creations()).to.equal(1); expect(context.compressors).to.have.length(1); expect(context.limiters).to.have.length(1);
    game.output.channels[1].sendProgramChange(38); audition.output.channels[1].sendProgramChange(81);
    game.output.channels[1].sendNoteOn(60, { voiceToken: 1, priority: 4, pan: -0.5 });
    audition.output.channels[1].sendNoteOn(60, { voiceToken: 1, priority: 4, pan: 0.5 });
    const [gameVoice, auditionVoice] = [...preview._voices];
    expect(context.oscillators.map(node => node.type)).to.deep.equal(['sine', 'sawtooth']);
    audition.output.channels[1].sendPitchBend(0.5);
    expect(gameVoice.oscillator.detune.events.at(-1).value).to.equal(0);
    expect(auditionVoice.oscillator.detune.events.at(-1).value).to.equal(100);
    audition.output.channels[1].sendControlChange(7, 32);
    const gameChannel = preview._channels.get(game.getState().ownerId + ':1');
    expect(gameChannel.volume).to.equal(1);
    expect(audition.output.channels[1].sendNoteOn(64, { voiceToken: 2, priority: 0 })).to.equal(false);
    expect(preview.getState().voiceDrops).to.equal(1); expect(preview.getState().activeVoices).to.equal(2);
    audition.stop(); expect(game.output.isVoiceActive(1)).to.equal(true); expect(audition.output.isVoiceActive(1)).to.equal(false);
    expect(preview.getState().enabled).to.equal(true); expect(game.getState().activeVoices).to.equal(1);
    await audition.dispose(); expect(context.closeCalls).to.equal(0);
    const replacement = preview.createSession('audition'); await replacement.enable();
    replacement.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
    audition.output.clear(); expect(replacement.output.isVoiceActive(1)).to.equal(true);
    preview.panic(); expect(preview.getState().activeVoices).to.equal(0); expect(game.getState().enabled).to.equal(false);
    await preview.dispose(); expect(context.closeCalls).to.equal(1);
  });

  it('cancels one pending owner unlock without canceling or resurrecting the other owner', async () => {
    const context = new FakeContext('suspended'), pending = deferred(); context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    const gameReady = game.enable(), auditionReady = audition.enable();
    audition.stop(); expect(await auditionReady).to.equal(false);
    context.state = 'running'; pending.resolve(); expect(await gameReady).to.equal(true);
    expect(context.resumeCalls).to.equal(1); expect(game.getState().enabled).to.equal(true); expect(audition.getState().enabled).to.equal(false);
    await audition.dispose(); expect(game.getState().enabled).to.equal(true); await preview.dispose();
  });

  it('retains all long audition cells on the shared bounded queue and stops only its future tail', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      const game = preview.createSession('game'), audition = preview.createSession('audition');
      await game.enable(); game.output.channels[1].sendNoteOn(45, { voiceToken: 1 });
      expect(await audition.preview(Array.from({ length: 16 }, (_, i) => ({ note: 60 + i, offsetMs: i * 960, durationMs: 120 })))).to.equal(true);
      await clock.tickAsync(10500);
      expect(context.oscillators).to.have.length(17); expect(audition.getState().pendingNotes).to.equal(0);
      await audition.preview([{ note: 80, offsetMs: 14400 }]); expect(audition.getState().pendingNotes).to.equal(1);
      game.output.channels[1].sendNoteOn(48, { voiceToken: 2 });
      audition.stop(); expect(game.output.isVoiceActive(2)).to.equal(true);
      const count = context.oscillators.length; await clock.tickAsync(16000); expect(context.oscillators).to.have.length(count);
      expect(preview.getState().pendingNotes).to.equal(0); await preview.dispose();
    });
  });

  it('bounds reusable sessions and records distinct scopes at the shared render boundary', async () => {
    const { preview } = setup(), records = [];
    preview.setCapture({ isActive: () => true, record(stage, fields) { records.push({ stage, ...fields }); return records.length; } });
    const game = preview.createSession('game'), audition = preview.createSession('audition');
    preview.createSession('third'); preview.createSession('fourth');
    expect(() => preview.createSession('fifth')).to.throw(RangeError);
    await game.enable(); await audition.enable();
    game.output.channels[1].sendNoteOn(60, { voiceToken: 1 }); audition.output.channels[1].sendNoteOn(64, { voiceToken: 1 });
    expect(records.filter(item => item.stage === 'synth-scheduled').map(item => item.outputScope)).to.deep.equal([game.output.captureScope, audition.output.captureScope]);
    await audition.dispose(); expect(preview._channels.size).to.equal(1); expect(preview.createSession('fifth')).not.to.equal(null);
    await preview.dispose();
  });

  it('matches scheduler-observed future notes to their actual shared-session cancellation', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview } = setup({ nowMs: () => clock.now });
      const game = preview.createSession('game'), audition = preview.createSession('audition');
      const capture = createMidiOutputCapture(); capture.start(); preview.setCapture(capture);
      const scheduler = new MidiScheduler({ enabled: true, defaultChannel: 1 });
      scheduler.setCapture(capture); scheduler.setOutput(game.output);
      try {
        await game.enable(); await audition.enable();
        audition.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
        await audition.preview([{ note: 64, offsetMs: 1200, durationMs: 200 }], { replace: false });
        // Exercise the real scheduler API boundary with an accepted future local schedule.
        const origin = { captureScope: scheduler._captureScope, token: 1, requestId: 1, laneIndex: 3,
          owner: audition.getState().ownerId, outputId: 'retained-origin-output', outputScope: 'retained-origin-scope' };
        expect(scheduler._sendOutput(game.output, 1, 'sendNoteOn', [60, { time: 1000, rawAttack: 96, voiceToken: 1 }], origin)).to.equal(true);
        scheduler.allNotesOff();
        expect(audition.output.isVoiceActive(1)).to.equal(true);
        const snapshot = capture.snapshot(), gameRecords = snapshot.records.filter(record => record.token === 1);
        expect(gameRecords.map(record => record.stage)).to.include.members(['api-dispatch', 'synth-scheduled', 'synth-end']);
        for (const record of gameRecords) expect(record).to.include({ captureScope: origin.captureScope,
          outputScope: game.output.captureScope, outputId: game.output.id, laneIndex: 3 });
        const auditionRecords = snapshot.records.filter(record => record.outputId === audition.output.id);
        expect(auditionRecords.map(record => record.stage)).to.include('request');
        expect(auditionRecords.every(record => record.outputScope === audition.output.captureScope)).to.equal(true);
        const note = analyzeMidiOutputCapture(snapshot).notes.find(entry => entry.outputId === game.output.id);
        expect(note).to.include({ startMs: 1000, synthEndReason: 'panic-or-stop', cancelledBeforeStart: true });
      } finally { scheduler.dispose(); await preview.dispose(); }
    });
  });

  it('emits every cell of a 14.4-second audition incrementally at its original timestamp', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      const notes = Array.from({ length: 16 }, (_, index) => ({ note: 48 + index, offsetMs: index * 960, durationMs: 120 }));
      const calls = [], original = preview.output;
      preview.output = { ...original, channels: Object.fromEntries(Object.entries(original.channels).map(([id, channel]) => [id, { ...channel,
        sendNoteOn(note, options) { const accepted = channel.sendNoteOn(note, options); calls.push({ note, time: options.time, dispatch: clock.now, accepted }); return accepted; }
      }])) };
      expect(await preview.preview(notes)).to.equal(true); expect(calls).to.have.length(5); expect(preview.getState().pendingNotes).to.equal(11);
      await clock.tickAsync(16000); expect(calls).to.have.length(16); expect(calls.every(call => call.accepted)).to.equal(true);
      expect(calls.map(call => call.time)).to.deep.equal(notes.map(note => note.offsetMs));
      expect(calls.at(-1).time).to.equal(14400); expect(calls.at(-1).dispatch).to.equal(10400);
      context.oscillators.forEach((node, index) => expect(node.starts[0]).to.be.closeTo(2 + notes[index].offsetMs / 1000, 1e-9));
      expect(preview.getState().pendingNotes).to.equal(0); await preview.dispose();
    });
  });
  it('accepts a phrase whose only playable cell is beyond the current horizon and cancels it on Panic or replacement', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      expect(await preview.preview([{ note: 72, offsetMs: 14400 }])).to.equal(true); expect(context.oscillators).to.have.length(0);
      preview.panic(); await clock.tickAsync(16000); expect(context.oscillators).to.have.length(0); expect(preview.getState().pendingNotes).to.equal(0);
      await preview.preview([{ note: 72, offsetMs: 14400 }]); await preview.preview([60]); await clock.tickAsync(16000);
      expect(context.oscillators).to.have.length(1); expect(preview.getState().pendingNotes).to.equal(0); await preview.dispose();
    });
  });
  it('drops fully elapsed queued notes after a delayed timer instead of bursting them at resume', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      await preview.preview([{ note: 60, offsetMs: 6000, durationMs: 100 }]);
      clock.setSystemTime(10000);
      await clock.tickAsync(2001);
      expect(context.oscillators).to.have.length(0);
      expect(preview.getState().pendingNotes).to.equal(0);
      await preview.dispose();
    });
  });
  it('routes real ensemble game events into distinct local instruments and independent pan', async function() {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      await preview.enable();
      const project = applyGameEventMidiPreset(createMidiProject(), 'game-iron-ensemble');
      const router = new MidiEventRouter(projectToMidiConfig({ ...project, enabled: true }));
      router.setOutput(preview.output);
      for (let lemmingId = 0; lemmingId < 4; lemmingId += 1) router._onEvent({
        type: 'builder-step', sfxId: SoundEffectIds.BUILDER_STEP, tick: 0, lemmingId, laneIndex: 0, laneCount: 1
      });
      expect(context.oscillators.slice(0, 3).map(oscillator => oscillator.type)).to.deep.equal(['sine', 'square', 'sawtooth']);
      expect([...preview._voices].map(voice => voice.instrument.role)).to.deep.equal(['bass', 'rhythm', 'melody', 'percussion']);
      expect([...preview._voices].every(voice => !!voice.pan)).to.equal(true);
      clock.tick(400);
      router.dispose();
      expect(preview._voices.size).to.equal(0);
      await preview.dispose();
    });
  });

  it('preserves triangle preview for older palettes with saved program and channel edits', async function() {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      await preview.enable();
      const router = new MidiEventRouter({ enabled: true, defaultChannel: 10, mpe: { enabled: false },
        sfx: { [SoundEffectIds.BUILDER_STEP]: { enabled: true, note: 69, channel: 10, program: 81 } } });
      router.setOutput(preview.output);
      router._onEvent({ type: 'builder-step', sfxId: SoundEffectIds.BUILDER_STEP, tick: 0, lemmingId: 0 });
      expect(context.oscillators).to.have.length(1);
      expect(context.oscillators[0].type).to.equal('triangle');
      router.dispose();
      await preview.dispose();
    });
  });

  it('plays distinct bounded ensemble timbres and keeps existing voice programs independent', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[2].sendProgramChange(38);
    preview.output.channels[2].sendNoteOn(45, { rawAttack: 100, instrument: { program: 38 } });
    preview.output.channels[3].sendNoteOn(57, { rawAttack: 100, instrument: { program: 29 } });
    preview.output.channels[4].sendNoteOn(69, { rawAttack: 100, instrument: { program: 81 } });
    preview.output.channels[10].sendNoteOn(36, { rawAttack: 100, instrument: { percussion: true } });
    expect(context.oscillators.map(oscillator => oscillator.type)).to.deep.equal(['sine', 'square', 'sawtooth', 'sine']);
    expect(context.oscillators[3].frequency.events).to.deep.include({ type: 'ramp', value: 45, time: 2.16 });
    preview.output.channels[2].sendProgramChange(29);
    expect(context.oscillators[0].type).to.equal('sine');
    expect(preview.getState().masterVolume).to.equal(0.7);
    expect(preview._voices.size).to.equal(4);
    expect([...preview._voices].every(voice => voice.peak <= 1 && voice.end <= voice.start + 8)).to.equal(true);
    preview.stop();
    expect(preview._voices.size).to.equal(0);
    await preview.dispose();
  });

  it('uses one cached bounded deterministic noise buffer for local percussion', async function() {
    const context = new FakeContext();
    context.sampleRate = 48000;
    const buffers = [], sources = [];
    context.createBuffer = (channels, length, sampleRate) => {
      const data = new Float32Array(length), buffer = { channels, length, sampleRate, getChannelData: () => data };
      buffers.push(buffer); return buffer;
    };
    context.createBufferSource = () => { const source = new FakeOscillator(); sources.push(source); return source; };
    const { preview } = setup({}, context);
    await preview.enable();
    for (let index = 0; index < 4; index += 1) preview.output.channels[10].sendNoteOn(42, { instrument: { percussion: true } });
    expect(buffers).to.have.length(1);
    expect(buffers[0].length).to.equal(9600);
    expect(sources).to.have.length(4);
    expect(sources.every(source => source.buffer === buffers[0] && source.loop)).to.equal(true);
    expect([...preview._voices].every(voice => voice.end - voice.start < 0.1)).to.equal(true);
    preview.stop();
    expect(sources.every(source => source.disconnected)).to.equal(true);
    await preview.dispose();
    expect(preview._noiseBuffer).to.equal(null);
  });

  it('reports successful local onset, scheduled release and panic, while rejecting invalid notes quietly', async function() {
    const events = [];
    const { preview, context } = setup({ onPlayback: event => events.push(event) });
    const metadata = { sfxId: 20, durationMs: 120 };
    expect(preview.output.channels[1].sendNoteOn(60, { playback: metadata })).to.equal(false);
    await preview.enable();
    expect(preview.output.channels[1].sendNoteOn(128, { playback: metadata })).to.equal(false);
    expect(events).to.have.length(0);
    preview.output.channels[1].sendNoteOn(60, { rawAttack: 127, time: 1100, playback: metadata });
    expect(events[0]).to.include({ phase: 'start', note: 60, sfxId: 20, startMs: 1100, attackMs: 8, decayMs: 0, sustain: 1 });
    preview.output.channels[1].sendNoteOff(60, { time: 1220 });
    expect(events[1].releaseMs).to.be.closeTo(1220, 0.0001);
    expect(events[1].endMs).to.be.closeTo(1260, 0.0001);
    expect(context.oscillators[0].stops.at(-1)).to.be.closeTo(2.26, 0.0001);
    preview.stop(); expect(events.at(-1).phase).to.equal('end');
    await preview.dispose();
  });

  it('publishes profile envelope and early-release amplitude only from actual admitted local voices', async function() {
    const events = [], { preview } = setup({ onPlayback: event => events.push(event) });
    try {
      await preview.enable();
      const options = { rawAttack: 100, time: 1100, voiceToken: 1, instrument: { program: 38, legacy: false }, playback: { sfxId: 20, durationMs: 120, stepIndex: 1, stepCount: 3 } };
      expect(preview.output.channels[1].sendNoteOn(48, options)).to.equal(true);
      const voice = [...preview._voices][0], onset = events[0];
      expect(onset).to.include({ phase: 'start', note: 48, attackMs: 6, decayMs: 50, sustain: 0.82, releaseDurationMs: 60, mixLatencyMs: 6, stepIndex: 1, stepCount: 3 });
      const gain = voice.gain.gain.events;
      expect(gain.find(event => event.type === 'ramp' && event.value === voice.peak).time - voice.start).to.be.closeTo(onset.attackMs / 1000, 0.000001);
      expect(gain.find(event => event.type === 'ramp' && event.value === voice.peak * onset.sustain).time - voice.start).to.be.closeTo((onset.attackMs + onset.decayMs) / 1000, 0.000001);
      expect(getMidiEventPlaybackEnvelope(onset).endMs).to.be.closeTo(1286, 0.000001);
      preview.output.channels[1].sendNoteOff(48, { time: 1104, voiceToken: 1 });
      const release = events[1]; expect(release.releaseLevel).to.be.closeTo(2 / 3, 0.000001);
      expect(getMidiEventPlaybackEnvelope(release).points[1].level).to.be.closeTo(voice.releaseLevel / voice.peak, 0.000001);
      expect(getMidiEventPlaybackEnvelope(release).endMs).to.be.closeTo(1170, 0.000001);
      preview.stop(); expect(events.at(-1).phase).to.equal('end');
    } finally { await preview.dispose(); }
  });
  it('emits playback only at scheduler dispatch and cancels a future note before it sounds', async function() {
    await withFakeClockAndPerformance(async clock => {
      const events = []; const { preview } = setup({ nowMs: () => clock.now, onPlayback: event => events.push(event) });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } });
      scheduler.setOutput(preview.output); scheduler.setTickMs(60);
      scheduler.sendNote({ note: 60, durationTicks: 4, timeMs: 100 }, { sfxId: 20 });
      expect(events).to.have.length(0); clock.tick(100);
      expect(events[0]).to.include({ phase: 'start', sfxId: 20, durationMs: 240 });
      scheduler.sendNote({ note: 72, durationTicks: 4, timeMs: 200 }, { sfxId: 24 });
      scheduler.allNotesOff(); clock.tick(500);
      expect(events.filter(event => event.phase === 'start')).to.have.length(1);
      scheduler.dispose(); await preview.dispose();
    });
  });
  it('offers an explicit 12 dB local boost through a bounded output ceiling without changing MIDI attack', async function() {
    const { preview, context } = setup({ masterVolume: 4 });
    await preview.enable();
    expect(context.gains[0].gain.value).to.equal(0.6);
    const limiter = context.limiters[0];
    expect(context.gains[0].connections).to.deep.equal([context.compressors[0]]);
    expect(context.compressors[0].connections).to.deep.equal([context.gains[1]]);
    expect(context.gains[1].gain.value).to.equal(0.647);
    expect(context.gains[1].connections).to.deep.equal([limiter]);
    expect(context.compressors[0].threshold.value).to.equal(-9);
    expect(context.compressors[0].ratio.value).to.equal(12);
    expect(context.compressors[0].attack.value).to.equal(0.001);
    expect(context.compressors[0].release.value).to.equal(0.08);
    expect(limiter.connections).to.deep.equal([context.destination]);
    expect(Math.max(...limiter.curve.map(Math.abs))).to.be.lessThan(0.9);
    expect(limiter.curve[2048 + 512]).to.equal(0.25);
    preview.output.channels[1].sendNoteOn(60, { rawAttack: 127 });
    expect([...preview._voices][0].peak).to.equal(1);
    await preview.dispose();
    expect(limiter.disconnected).to.equal(true);
    expect(context.compressors[0].disconnected).to.equal(true);
    expect(context.gains[1].disconnected).to.equal(true);
  });
  it('mutes the compressor lookahead on Panic and reopens only after its bounded delay', async () => {
    const { preview, context } = setup(); await preview.enable();
    const fixed = context.gains[1].gain;
    preview.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
    context.currentTime = 2.1; preview.panic();
    expect(fixed.events.at(-1)).to.deep.equal({ type: 'set', value: 0, time: 2.1 });
    expect(preview._voices.size).to.equal(0);
    expect(preview.getState()).to.include({ masterVolume: 0.7, mixLatencyMs: 6 });
    await preview.enable();
    expect(fixed.events.at(-1)).to.deep.equal({ type: 'set', value: 0.647, time: 2.106 });
    await preview.dispose();
  });

  it('retains the output ceiling on a backend without mix compression capability', async () => {
    const context = new FakeContext(); context.createDynamicsCompressor = undefined;
    const { preview } = setup({}, context); expect(await preview.enable()).to.equal(true);
    expect(context.gains[0].connections).to.deep.equal([context.limiters[0]]);
    expect(preview.getState().mixCompression).to.equal(false); await preview.dispose();
  });

  it('keeps master volume changes inert until enabled and applies the 70% default below the safe gain cap', async function() {
    const { preview, context, creations } = setup();
    expect(preview.getState().masterVolume).to.equal(0.7);
    expect(preview.setMasterVolume(0.4)).to.equal(0.4);
    expect(creations()).to.equal(0);
    expect(await preview.enable()).to.equal(true);
    expect(context.gains[0].gain.value).to.be.closeTo(0.15 * 0.4, 0.000001);
    await preview.dispose();
    const defaults = setup();
    await defaults.preview.enable();
    expect(defaults.context.gains[0].gain.value).to.be.closeTo(0.15 * 0.7, 0.000001);
    await defaults.preview.dispose();
  });

  it('ramps live master gain to exact mute and back without changing note velocity, channel volume or active voices', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[1];
    channel.sendControlChange(7, 80);
    channel.sendNoteOn(60, { rawAttack: 100 });
    const voice = [...preview._voices][0];
    const envelope = [...voice.gain.gain.events];
    const channelGain = [...preview._channels.get(1).gain.gain.events];
    const master = context.gains[0].gain;
    expect(preview.setMasterVolume(0)).to.equal(0);
    expect(master.events.at(-1)).to.deep.equal({ type: 'ramp', value: 0, time: context.currentTime + 0.015 });
    expect(preview.getState()).to.include({ enabled: true, masterVolume: 0, activeVoices: 1 });
    expect(preview.setMasterVolume(1)).to.equal(1);
    expect(master.events.filter(event => event.type === 'ramp')).to.have.length(1);
    expect(master.events.at(-1).value).to.equal(0.15);
    expect(voice.gain.gain.events).to.deep.equal(envelope);
    expect(preview._channels.get(1).gain.gain.events).to.deep.equal(channelGain);
    expect(preview.getState().activeVoices).to.equal(1);
    await preview.dispose();
  });

  it('holds an in-progress master ramp when the browser supports cancelAndHoldAtTime', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const master = context.gains[0].gain;
    const held = [];
    master.cancelAndHoldAtTime = time => held.push(time);
    preview.setMasterVolume(0.2);
    preview.setMasterVolume(0.8);
    expect(held).to.deep.equal([context.currentTime, context.currentTime]);
    expect(master.events.at(-1).value).to.equal(0.15 * 0.8);
    await preview.dispose();
  });

  it('applies mute before a pending unlock completes and preserves it across stop and restart', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const enabling = preview.enable();
    preview.setMasterVolume(0);
    expect(context.gains[0].gain.events.at(-1)).to.deep.equal({ type: 'set', value: 0, time: context.currentTime });
    context.state = 'running';
    pending.resolve();
    expect(await enabling).to.equal(true);
    preview.stop();
    expect(await preview.enable()).to.equal(true);
    expect(preview.getState().masterVolume).to.equal(0);
    await preview.dispose();
  });

  it('clamps master volume, ignores invalid values and leaves disposed audio untouched', async function() {
    const { preview, context, creations } = setup({ masterVolume: Infinity });
    expect(preview.getState().masterVolume).to.equal(0.7);
    expect(preview.setMasterVolume(-1)).to.equal(0);
    expect(preview.setMasterVolume(5)).to.equal(4);
    expect(preview.setMasterVolume(NaN)).to.equal(4);
    expect(preview.setMasterVolume('0.5')).to.equal(4);
    expect(creations()).to.equal(0);
    await preview.enable();
    await preview.dispose();
    expect(preview.setMasterVolume(0)).to.equal(4);
    expect(context.gains[0].gain.events).to.deep.equal([]);
  });

  it('is completely inert until a user-triggered enable and never depends on MIDI access', async function() {
    const { preview, context, creations } = setup();
    expect(preview).to.be.instanceOf(BrowserNotePreview);
    expect(preview.getState()).to.include({ status: 'idle', enabled: false, activeVoices: 0 });
    expect(Object.keys(preview.output.channels)).to.have.length(16);
    expect(preview.output.channels[1].sendNoteOn(60)).to.equal(false);
    expect(creations()).to.equal(0);
    const source = readFileSync(new URL('../../js/app/midi-ui/browserNotePreview.js', import.meta.url), 'utf8');
    expect(source).not.to.match(/requestMIDIAccess|WebMidi|MidiScheduler|MidiEventRouter/m);
    expect(await preview.enable()).to.equal(true);
    expect(creations()).to.equal(1);
    expect(context.oscillators).to.have.length(0);
    await preview.dispose();
  });

  it('creates and resumes synchronously before yielding for the browser gesture', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview, creations } = setup({}, context);
    const enabling = preview.enable();
    expect(creations()).to.equal(1);
    expect(context.resumeCalls).to.equal(1);
    expect(preview.getState().status).to.equal('unlocking');
    expect(preview.output.channels[1].sendNoteOn(60)).to.equal(false);
    context.state = 'running';
    pending.resolve();
    expect(await enabling).to.equal(true);
    await preview.dispose();
  });

  it('reports unsupported audio without creating anything', async function() {
    const preview = createBrowserNotePreview({ createAudioContext: null });
    expect(await preview.enable()).to.equal(false);
    expect(await preview.preview([60])).to.equal(false);
    expect(preview.getState()).to.include({ status: 'unsupported', enabled: false });
    await preview.dispose();
  });

  it('handles resume rejection and retries on the next explicit enable', async function() {
    const context = new FakeContext('suspended');
    context.resumeResult = Promise.reject(new Error('permission denied'));
    const { preview, creations } = setup({}, context);
    expect(await preview.enable()).to.equal(false);
    expect(preview.getState().status).to.equal('error');
    expect(context.oscillators).to.have.length(0);
    context.resumeResult = null;
    expect(await preview.enable()).to.equal(true);
    expect(creations()).to.equal(1);
    expect(context.resumeCalls).to.equal(2);
    await preview.dispose();
  });

  it('does not accept a resolved resume while audio remains suspended', async function() {
    const context = new FakeContext('suspended');
    context.resumeResult = Promise.resolve();
    const { preview } = setup({}, context);
    expect(await preview.enable()).to.equal(false);
    expect(preview.getState().status).to.equal('error');
    await preview.dispose();
  });

  it('cancels a pending unlock with stop and permits a later explicit enable', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const enabling = preview.enable();
    preview.stop();
    context.state = 'running';
    pending.resolve();
    expect(await enabling).to.equal(false);
    expect(preview.getState()).to.include({ status: 'idle', enabled: false });
    expect(await preview.enable()).to.equal(true);
    await preview.dispose();
  });

  it('allows only the newest rapidly repeated preview after resume', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview, creations } = setup({}, context);
    const first = preview.preview([60]);
    const second = preview.preview([67]);
    expect(context.resumeCalls).to.equal(2);
    context.state = 'running';
    pending.resolve();
    expect(await first).to.equal(false);
    expect(await second).to.equal(true);
    expect(context.oscillators).to.have.length(1);
    expect(context.oscillators[0].frequency.events[0].value).to.be.closeTo(391.995, 0.001);
    expect(creations()).to.equal(1);
    await preview.dispose();
  });

  it('disposes pending unlock once and never revives or schedules notes afterward', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const playing = preview.preview([60]);
    const first = preview.dispose();
    expect(preview.dispose()).to.equal(first);
    pending.resolve();
    expect(await playing).to.equal(false);
    expect(await preview.enable()).to.equal(false);
    expect(await preview.preview([72])).to.equal(false);
    await first;
    expect(context.closeCalls).to.equal(1);
    expect(context.listeners.size).to.equal(0);
    expect(context.gains.every(node => node.disconnected)).to.equal(true);
    expect(context.oscillators).to.have.length(0);
    expect(preview.getState().status).to.equal('disposed');
  });

  it('maps absolute performance timestamps to audio time and schedules a soft envelope', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[2];
    expect(channel.sendNoteOn(69, { rawAttack: 100, time: 1250 })).to.equal(true);
    channel.sendNoteOff(69, { time: 1500 });
    const voice = context.oscillators[0];
    expect(voice.starts).to.eql([2.25]);
    expect(voice.frequency.events[0]).to.eql({ type: 'set', value: 440, time: 2.25 });
    expect(voice.stops.at(-1)).to.equal(2.54);
    const envelope = context.gains.at(-1).gain.events;
    expect(envelope[0]).to.eql({ type: 'set', value: 0, time: 2.25 });
    expect(envelope.some(event => event.type === 'ramp' && event.value > 0)).to.equal(true);
    expect(envelope.at(-1)).to.eql({ type: 'ramp', value: 0, time: 2.54 });
    voice.end();
    expect(preview.getState().activeVoices).to.equal(0);
    expect(voice.onended).to.equal(null);
    expect(voice.disconnected).to.equal(true);
    await preview.dispose();
  });

  it('has a hard note lifetime even without a note-off and bounds note inputs', async function() {
    const { preview, context } = setup({ maxNoteSeconds: 3 });
    await preview.enable();
    const channel = preview.output.channels[1];
    for (const note of [-1, 128, NaN, Infinity, 60.5, '60', null]) expect(channel.sendNoteOn(note)).to.equal(false);
    expect(channel.sendNoteOn(60, { time: 4100 })).to.equal(false);
    expect(channel.sendNoteOn(60, { rawAttack: 1000 })).to.equal(true);
    expect(context.oscillators[0].stops).to.eql([5]);
    expect(context.gains.at(-1).gain.events[1].value).to.equal(1);
    await preview.dispose();
  });

  it('supports bounded short phrases without changing any game clock', async function() {
    const { preview, context } = setup();
    expect(await preview.preview([
      { note: 60, offsetMs: 0, durationMs: 100 },
      { note: 64, offsetMs: 200, durationMs: 150 },
      { note: 67, offsetMs: 400, durationMs: 200 },
      { note: 72, offsetMs: 999999, durationMs: 100 }
    ])).to.equal(true);
    expect(context.oscillators.map(node => node.starts[0])).to.eql([2, 2.2, 2.4]);
    expect(context.oscillators.map(node => node.stops.at(-1))).to.eql([2.14, 2.39, 2.64]);
    await preview.dispose();
  });

  it('preserves independent local same-pitch gates until each scheduler token releases', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } });
      scheduler.setOutput(preview.output); scheduler.setTickMs(60);
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 8 });
      clock.tick(60);
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 4 });
      const [first, second] = [...preview._voices];
      expect(first.token).not.to.equal(second.token);
      expect(context.oscillators.every(node => !node.disconnected)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(2);
      clock.tick(240);
      expect(second.released).to.equal(true); expect(first.released).to.equal(false);
      expect(scheduler._activeNotes.size).to.equal(1);
      clock.tick(180);
      expect(first.released).to.equal(true); expect(scheduler._activeNotes.size).to.equal(0);
      scheduler.allNotesOff(); expect(preview._voices.size).to.equal(0);
      expect(context.oscillators.every(node => node.disconnected)).to.equal(true);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('retains the hardware single-pitch retrigger policy when independent gates are absent', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now }); await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } });
      scheduler.setOutput({ ...preview.output, supportsIndependentNoteGates: false });
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 8 });
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 8 });
      expect(context.oscillators[0].disconnected).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(1);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('lets an owned immediate release replace an already scheduled future release', async () => {
    const { preview, context } = setup(); await preview.enable();
    preview.output.channels[1].sendNoteOn(60, { voiceToken: 1 });
    preview.output.channels[1].sendNoteOff(60, { time: 2000, voiceToken: 1 });
    const voice = [...preview._voices][0]; expect(voice.releaseAt).to.equal(3);
    context.currentTime = 2.1;
    expect(preview.output.channels[1].sendNoteOff(60, { voiceToken: 1, reason: 'local-voice-budget' })).to.equal(true);
    expect(voice.end).to.be.closeTo(2.14, 1e-9); expect(voice.oscillator.disconnected).to.equal(false);
    await preview.dispose();
  });

  it('protects higher-priority local gates from spawn overflow and balances equal-priority lanes', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false }, limits: { maxActiveNotes: 8 } });
      scheduler.setOutput(preview.output);
      for (let index = 0; index < 8; index++) expect(scheduler.sendNote({ note: 48 + index, durationTicks: 0 }, { priority: 4, laneIndex: 0 })).to.equal(true);
      const originalTokens = [...scheduler._activeNotes.keys()];
      clock.tick(80);
      expect(scheduler.sendNote({ note: 72, durationTicks: 3 }, { priority: 0, laneIndex: 1 })).to.equal(false);
      expect([...scheduler._activeNotes.keys()]).to.deep.equal(originalTokens);
      expect(scheduler.getOutputPressure().reason).to.equal('local-voice-priority');
      expect(scheduler._noteOffs).to.have.length(0);
      for (let index = 0; index < 8; index++) scheduler.sendNote({ note: 60 + index, durationTicks: 0 }, { priority: 4, laneIndex: 1 });
      const lanes = [...scheduler._activeNotes.values()].map(voice => voice.laneIndex);
      expect(lanes.filter(lane => lane === 0)).to.have.length(4);
      expect(lanes.filter(lane => lane === 1)).to.have.length(4);
      expect(context.oscillators.slice(0, 4).every(node => !node.disconnected && node.stops.at(-1) > context.currentTime)).to.equal(true);
      expect(preview.getState().voiceSteals).to.equal(8);
      scheduler.allNotesOff(); expect(preview._voicesByToken.size).to.equal(0);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('rejects source-cap overflow before evicting an existing scheduler gate', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview } = setup({ nowMs: () => clock.now }); await preview.enable();
      let available = true;
      const output = { ...preview.output, canAllocateVoice: () => available };
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false }, limits: { maxActiveNotes: 1 } }); scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, durationTicks: 0 }, { priority: 0 })).to.equal(true);
      const existing = [...scheduler._activeNotes.keys()]; available = false;
      expect(scheduler.sendNote({ note: 72, durationTicks: 0 }, { priority: 4 })).to.equal(false);
      expect([...scheduler._activeNotes.keys()]).to.deep.equal(existing);
      expect([...preview._voices][0].released).to.equal(false);
      expect(scheduler.getOutputPressure().reason).to.equal('local-source-cap');
      scheduler.dispose(); await preview.dispose();
    }, { now: 60000 });
  });

  it('retains a decaying percussion note whose zero-level release is scheduled in the future', async () => {
    const { preview, context } = setup(); await preview.enable();
    preview.output.channels[1].sendNoteOn(36, { voiceToken: 1, instrument: { percussion: true } });
    preview.output.channels[1].sendNoteOff(36, { time: 2000, voiceToken: 1 });
    const percussion = [...preview._voices][0];
    expect(percussion.releaseLevel).to.equal(0); expect(percussion.releaseAt).to.be.greaterThan(context.currentTime);
    preview.output.channels[1].sendNoteOn(60, { voiceToken: 2 });
    expect(preview._voices.has(percussion)).to.equal(true); expect(percussion.oscillator.disconnected).to.equal(false);
    await preview.dispose();
  });

  it('reclaims finished or inaudible percussion gates without cutting a live high-priority note', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup({ nowMs: () => clock.now });
      Object.defineProperty(context, 'currentTime', { get: () => 2 + clock.now / 1000 });
      await preview.enable();
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false }, limits: { maxActiveNotes: 2 } });
      scheduler.setOutput(preview.output);
      scheduler.sendNote({ note: 60, durationTicks: 0 }, { priority: 4 });
      scheduler.sendNote({ note: 42, durationTicks: 0, percussion: true }, { priority: 4 });
      const melody = [...scheduler._activeNotes.keys()][0];
      clock.tick(70);
      expect(scheduler.sendNote({ note: 65, durationTicks: 0 }, { priority: 0 })).to.equal(true);
      expect(scheduler._activeNotes.has(melody)).to.equal(true);
      expect(scheduler._activeNotes.size).to.equal(2);
      expect(preview._voices.size).to.equal(2);
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('bounds explicitly configured local sources at64 and scheduled sources plus tails at96', async () => {
    const { preview, context } = setup({ maxVoices: 1000 }); await preview.enable();
    for (let index = 0; index < 64; index++) preview.output.channels[1].sendNoteOn(48 + index % 24, { voiceToken: index + 1 });
    expect(preview.getState()).to.include({ maxVoices: 64, maxScheduledVoices: 96, activeVoices: 64 });
    context.currentTime = 2.1;
    for (let index = 0; index < 128; index++) preview.output.channels[1].sendNoteOn(60, { voiceToken: 100 + index });
    expect(preview._voices.size).to.be.at.most(96);
    expect([...preview._voices].filter(voice => !voice.stolen)).to.have.length.at.most(64);
    expect(preview.getState().voiceDrops).to.be.greaterThan(0);
    preview.panic(); expect(preview._voicesByToken.size).to.equal(0); await preview.dispose();
  });

  it('removes a rejected render gate without scheduling a phantom note-off or panicking other notes', async () => {
    await withFakeClockAndPerformance(async clock => {
      const { preview } = setup({ nowMs: () => clock.now }); await preview.enable();
      const original = preview.output;
      const output = { ...original, channels: { ...original.channels, 1: { ...original.channels[1], sendNoteOn: () => false } } };
      const scheduler = new MidiScheduler({ enabled: true, mpe: { enabled: false } }); scheduler.setOutput(output);
      expect(scheduler.sendNote({ note: 60, durationTicks: 4 })).to.equal(false);
      expect(scheduler._activeNotes.size).to.equal(0); expect(scheduler._noteOffs).to.have.length(0);
      expect(scheduler.getOutputPressure().reason).to.equal('local-render-rejected');
      scheduler.dispose(); await preview.dispose();
    });
  });

  it('permits all32 scheduler voices and fades only the overflow voice with bounded release tails', async () => {
    const { preview, context } = setup(); await preview.enable();
    for (let index = 0; index < 32; index++) preview.output.channels[1].sendNoteOn(48 + index);
    expect(preview._voices.size).to.equal(32);
    expect([...preview._voices].every(voice => !voice.stolen && !voice.released)).to.equal(true);
    const oldest = [...preview._voices][0]; context.currentTime = 2.1;
    preview.output.channels[1].sendNoteOn(84);
    expect(oldest.stolen).to.equal(true); expect(oldest.oscillator.disconnected).to.equal(false);
    expect(oldest.end).to.be.closeTo(2.14, 1e-9);
    expect([...preview._voices].filter(voice => !voice.stolen)).to.have.length(32);
    preview.panic(); expect(preview._voices.size).to.equal(0); await preview.dispose();
  });

  it('keeps nominal headroom independent of the configured voice capacity', async () => {
    const small = setup({ maxVoices: 2, masterVolume: 1 }), full = setup({ maxVoices: 32, masterVolume: 1 });
    await small.preview.enable(); await full.preview.enable();
    expect(small.context.gains[0].gain.value).to.equal(0.15);
    expect(full.context.gains[0].gain.value).to.equal(0.15);
    expect(Math.max(...full.context.limiters[0].curve.map(Math.abs))).to.be.lessThan(0.9);
    await small.preview.dispose(); await full.preview.dispose();
  });

  it('retains earlier non-overlapping notes while bounding polyphony and total queued voices', async function() {
    const { preview, context } = setup({ maxVoices: 2 });
    await preview.preview(Array.from({ length: 8 }, (_, index) => ({ note: 60 + index, offsetMs: index * 150, durationMs: 50 })));
    expect(context.oscillators.every(node => !node.disconnected)).to.equal(true);
    preview.output.clear();
    for (let index = 0; index < 100; index += 1) preview.output.channels[1].sendNoteOn(60 + index % 12);
    expect(preview.getState().activeVoices).to.be.at.most(64);
    expect(context.oscillators.filter(node => !node.disconnected && node.stops.at(-1) > 2.04)).to.have.length.at.most(2);
    await preview.dispose();
    expect(context.oscillators.every(node => node.disconnected && node.onended === null)).to.equal(true);
  });

  it('clears scheduled future voices and prevents zombie ended callbacks', async function() {
    const { preview, context } = setup();
    await preview.preview([{ note: 60, offsetMs: 600 }]);
    const node = context.oscillators[0];
    const ended = node.onended;
    preview.panic();
    expect(preview.getState()).to.include({ enabled: false, activeVoices: 0 });
    expect(node.disconnected).to.equal(true);
    expect(node.onended).to.equal(null);
    ended();
    expect(preview.getState().activeVoices).to.equal(0);
    expect(preview.output.channels[1].sendNoteOn(62)).to.equal(false);
    await preview.dispose();
  });

  it('keeps the enabled adapter usable after scheduler output.clear', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[1].sendNoteOn(60);
    preview.output.clear();
    expect(context.oscillators[0].disconnected).to.equal(true);
    expect(preview.getState().enabled).to.equal(true);
    expect(preview.output.channels[1].sendNoteOn(62)).to.equal(true);
    await preview.dispose();
  });

  it('cleans up when the browser interrupts a running audio context', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[1].sendNoteOn(60);
    context.suspend();
    expect(preview.getState()).to.include({ status: 'interrupted', enabled: false, activeVoices: 0 });
    expect(context.oscillators[0].disconnected).to.equal(true);
    expect(await preview.enable()).to.equal(true);
    await preview.dispose();
  });

  it('implements the scheduler surface including MPE, timestamped releases, pan and panic', async function() {
    await withFakeClockAndPerformance(async clock => {
      const { preview, context } = setup();
      await preview.enable();
      const scheduler = new MidiScheduler({
        mpe: { enabled: true, masterChannel: 1, memberChannels: [2, 3], pitchBendRange: { semitones: 12, cents: 0 } },
        defaultChannel: 1
      });
      scheduler.setOutput(preview.output);
      scheduler.setTickMs(60);
      expect(scheduler.sendNote({ note: 60, velocity: 80, pitchBend: 0.5, pan: 127, timbre: 100, durationTicks: 4, timeMs: 1100 })).to.equal(true);
      expect(context.oscillators).to.have.length(0);
      clock.tick(100);
      expect(context.oscillators).to.have.length(1);
      expect(context.oscillators[0].detune.events[0].value).to.equal(600);
      expect([...preview._voices][0].pan.pan.events.at(-1).value).to.equal(1);
      scheduler.allNotesOff();
      expect(preview.getState().activeVoices).to.equal(0);
      expect(context.oscillators[0].disconnected).to.equal(true);
      expect(scheduler._noteOffTimerId).to.equal(0);
      scheduler.dispose();
      await preview.dispose();
    }, { now: 1000 });
  });

  it('pairs consecutive scheduled same-pitch notes independently', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[1];
    channel.sendNoteOn(60, { time: 1000 });
    channel.sendNoteOff(60, { time: 1100 });
    channel.sendNoteOn(60, { time: 1050 });
    channel.sendNoteOff(60, { time: 1250 });
    expect(context.oscillators.map(node => node.stops.at(-1))).to.eql([2.14, 2.29]);
    channel.sendNoteOff(60);
    expect(preview.getState().activeVoices).to.equal(0);
    await preview.dispose();
  });

  it('supports pitch bend automation for existing and later-created voices', async function() {
    const { preview, context } = setup();
    await preview.enable();
    const channel = preview.output.channels[3];
    channel.sendPitchBendRange(3, 50);
    channel.sendPitchBend(0.5, { time: 1100 });
    channel.sendPitchBend(0, { time: 1500 });
    channel.sendNoteOn(69, { time: 1200 });
    expect(context.oscillators[0].detune.events).to.eql([
      { type: 'set', value: 175, time: 2.2 },
      { type: 'set', value: 0, time: 2.5 }
    ]);
    channel.sendPitchBend(-1, { time: 1300 });
    expect(context.oscillators[0].detune.events.at(-1)).to.eql({ type: 'set', value: -350, time: 2.3 });
    channel.sendControlChange(7, 100);
    channel.sendControlChange(11, 64);
    expect(preview._channels.get(3).gain.gain.events.at(-1).value).to.be.closeTo(100 * 64 / (127 * 127), 0.00001);
    channel.sendControlChange(120, 0);
    expect(preview.getState().activeVoices).to.equal(0);
    await preview.dispose();
  });

  it('keeps simultaneous voices on the same channel at their own pan positions', async function() {
    const { preview } = setup();
    await preview.enable();
    preview.output.channels[1].sendNoteOn(60, { pan: -1 });
    preview.output.channels[1].sendNoteOn(67, { pan: 1 });
    const voices = [...preview._voices];
    expect(voices.map(voice => voice.pan.pan.events.at(-1).value)).to.deep.equal([-1, 1]);
    preview.panic();
    expect(voices.every(voice => voice.pan.disconnected)).to.equal(true);
  });

  it('tolerates unavailable panning and exceptions in status consumers', async function() {
    const context = new FakeContext();
    context.createStereoPanner = undefined;
    const { preview } = setup({ onStateChange: () => { throw new Error('UI failed'); } }, context);
    expect(await preview.enable()).to.equal(true);
    preview.output.channels[1].sendControlChange(10, 0);
    expect(await preview.preview([60])).to.equal(true);
    await preview.dispose();
  });

  it('closes a context after partial initialization failure and permits a clean retry', async function() {
    const failed = new FakeContext();
    failed.createGain = () => { throw new Error('No audio nodes'); };
    const valid = new FakeContext();
    let next = failed;
    const preview = createBrowserNotePreview({ createAudioContext: () => next });
    expect(await preview.enable()).to.equal(false);
    expect(failed.closeCalls).to.equal(1);
    next = valid;
    expect(await preview.enable()).to.equal(true);
    await preview.dispose();
    expect(valid.closeCalls).to.equal(1);
    expect(failed.closeCalls).to.equal(1);
  });

  it('disconnects partially constructed voices and failed channel graphs', async function() {
    const { preview, context } = setup();
    await preview.enable();
    preview.output.channels[1].sendControlChange(10, 64);
    const createGain = context.createGain.bind(context);
    context.createGain = () => { throw new Error('Resource exhausted'); };
    expect(preview.output.channels[1].sendNoteOn(60)).to.equal(false);
    expect(context.oscillators[0].disconnected).to.equal(true);
    expect(preview.getState().activeVoices).to.equal(0);
    context.createGain = createGain;
    context.createStereoPanner = () => { throw new Error('Panner failed'); };
    expect(preview.output.channels[2].sendPitchBend(0)).to.equal(false);
    expect(context.gains.at(-1).disconnected).to.equal(true);
    await preview.dispose();
  });

  it('reports note completion so local listening status cannot stay stale', async function() {
    const { preview, context } = setup();
    const counts = [];
    preview.subscribe(state => counts.push(state.activeVoices));
    await preview.preview([60]);
    expect(counts.at(-1)).to.equal(1);
    context.oscillators[0].end();
    expect(counts.at(-1)).to.equal(0);
    expect(preview.getState().activeVoices).to.equal(0);
    await preview.dispose();
  });

  it('allows subscriber removal and handles close rejection without leaked listeners', async function() {
    const { preview, context } = setup();
    let updates = 0;
    const unsubscribe = preview.subscribe(() => { updates += 1; });
    await preview.enable();
    expect(updates).to.equal(1);
    unsubscribe();
    preview.stop();
    expect(updates).to.equal(1);
    context.close = () => { context.closeCalls += 1; return Promise.reject(new Error('Already closed')); };
    await preview.dispose();
    expect(context.listeners.size).to.equal(0);
    expect(context.closeCalls).to.equal(1);
    preview.subscribe(() => { throw new Error('Disposed subscription'); });
    expect(await preview.enable()).to.equal(false);
  });


  it('settles cancelled enables immediately even when the browser resume never settles', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const starting = preview.enable();
    preview.stop();
    expect(await starting).to.equal(false);
    context.resumeResult = null;
    expect(await preview.enable()).to.equal(true);
    expect(context.resumeCalls).to.equal(2);
    await preview.dispose();
    pending.reject(new Error('Late abort'));
    await Promise.resolve();
    expect(preview.getState().status).to.equal('disposed');
  });

  it('shares one resume for concurrent enable calls that have not been cancelled', async function() {
    const context = new FakeContext('suspended');
    const pending = deferred();
    context.resumeResult = pending.promise;
    const { preview } = setup({}, context);
    const first = preview.enable();
    const second = preview.enable();
    expect(context.resumeCalls).to.equal(1);
    context.state = 'running';
    pending.resolve();
    expect(await first).to.equal(true);
    expect(await second).to.equal(true);
    await preview.dispose();
  });

});

describe('inactive hardware boundary', function() {
  it('does not configure MPE channels when the hardware mapping is disabled', function() {
    let messages = 0;
    const channel = { sendPitchBendRange() { messages += 1; }, sendPitchBend() { messages += 1; } };
    const output = { id: 'hardware', channels: { 1: channel, 2: channel } };
    const config = { enabled: false, mpe: { enabled: true, masterChannel: 1, memberChannels: [2] } };
    const scheduler = new MidiScheduler(config);
    scheduler.setOutput(output);
    scheduler.setOutputs([output]);
    scheduler.setConfig({ ...config, sfx: { 24: { note: 72 } } });
    expect(messages).to.equal(0);
    scheduler.setConfig({ ...config, enabled: true });
    expect(messages).to.be.greaterThan(0);
    scheduler.output = null;
    scheduler._outputsById.clear();
    scheduler.dispose();
  });
});


describe('polyphonic clip dispatch to existing event-card playback feedback', function() {
  it('creates separate actual-pitch gate spans for voices/repeats and cleans all spans on Panic without a frame layout loop', async function() {
    await withFakeClockAndPerformance(async clock => {
      const context = new FakeContext(); context.currentTime = 0;
      const document = new TestDocument(), row = document.createElement('button'); row.dataset.gameEventId = '20';
      let reads = 0; row.getBoundingClientRect = () => { reads++; return { width: 240 }; };
      const create = document.createElement.bind(document), animations = [], emitted = [];
      document.createElement = tag => { const node = create(tag); node.isConnected = true; node.remove = () => node.parent?.removeChild(node);
        node.animate = (frames, options) => { const animation = { frames, options, cancel() {} }; animations.push(animation); return animation; }; return node; };
      const cells = Array.from({ length: 8 }, () => document.createElement('button')); let selectedSource = 'sfx-20';
      const feedback = createMidiEventPlayback({ document, window: { performance: { now: () => clock.now } }, getRows: () => [row],
        getCellTarget: event => event.clipId === 'poly' && event.sourceId === selectedSource ? cells[event.stepIndex] : null });
      const preview = new BrowserNotePreview({ createAudioContext: () => context, nowMs: () => clock.now,
        onPlayback: event => { emitted.push(event); feedback.onPlayback({ ...event, owner: 'game' }); } }); await preview.enable();
      const router = new MidiEventRouter({ enabled: true, mpe: { enabled: false }, density: { velocityBoost: 0, durationScale: 0 },
        scale: { name: 'chromatic', root: 0 }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 },
        durationTicks: { min: 1, max: 960, default: 4 }, sfx: { 20: { note: 60, channel: 1, sourceId: 'sfx-20', sourceKind: 'sfx', sourceKey: '20', clipSequence: { id: 'poly', advance: 'game-tick', spacingTicks: 2,
          steps: [{ voices: [{ note: 60, velocity: 45, durationTicks: 5 }, { note: 64, velocity: 95, durationTicks: 2 }], transformLayers: [{ type: 'repeat', count: 2, spacingTicks: 2, transpose: 7 }] }, { note: null }, { note: 72, probability: 0 }] } } } });
      const timer = { tick: 0, frameTime: 60, onGameTick: new EventHandler(), getGameTicks() { return this.tick; }, get tps() { return 1000 / this.frameTime; } };
      router.setOutput(preview.output); router.attach({ onEvent: new EventHandler(), gameTimer: timer });
      try {
        router._onEvent({ sfxId: 20, tick: 0, frameMs: 60 });
        for (let index = 0; index < 2; index++) { context.currentTime += 0.06; clock.tick(60); timer.tick++; timer.onGameTick.trigger(); }
        const starts = emitted.filter(event => event.phase === 'start');
        expect(starts.map(event => [event.note, event.velocity])).to.deep.equal([[60, 45], [64, 95], [67, 45], [71, 95]]);
        starts.forEach((event, index) => expect(event.durationMs).to.be.closeTo(index % 2 ? 120 : 300, 0.000001));
        expect(new Set(starts.map(event => event.id)).size).to.equal(4); expect(row.children.map(node => node.textContent)).to.include.members(['C4', 'E4', 'G4', 'B4']);
        expect(starts.every(event => event.clipId === 'poly' && event.sourceId === 'sfx-20' && event.originTick === 0 && event.stepIndex === 0)).to.equal(true);
        expect(cells[0].children.map(node => node.textContent)).to.deep.equal(['C4', 'E4', 'G4', 'B4']); expect(cells.slice(1).every(cell => !cell.children.length)).to.equal(true);
        selectedSource = 'sfx-21'; feedback.render(); expect(cells.every(cell => !cell.children.length)).to.equal(true); expect(row.children).to.have.length(4);
        selectedSource = 'sfx-20'; feedback.render(); expect(cells[0].children).to.have.length(4);
        const before = reads; for (let index = 0; index < 5; index++) feedback.render(); expect(reads).to.equal(before);
        expect(animations.every(animation => animation.options.duration > 0 && animation.frames.at(-1).opacity === 0)).to.equal(true);
        router.scheduler.allNotesOff(); expect(row.children).to.have.length(0); expect(preview._voices.size).to.equal(0); expect(cells.every(cell => !cell.children.length)).to.equal(true);
      } finally { router.dispose(); preview.dispose(); feedback.dispose(); }
    });
  });
});
