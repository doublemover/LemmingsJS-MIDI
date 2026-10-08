import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { BrowserNotePreview, createBrowserNotePreview } from '../../js/app/midi-ui/browserNotePreview.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';
import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
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
    expect(context.gains[0].gain.value).to.equal(0.15);
    const limiter = context.limiters[0];
    expect(context.gains[0].connections).to.deep.equal([limiter]);
    expect(limiter.connections).to.deep.equal([context.destination]);
    expect(Math.max(...limiter.curve.map(Math.abs))).to.be.lessThan(0.9);
    expect(limiter.curve[2048 + 512]).to.equal(0.25);
    preview.output.channels[1].sendNoteOn(60, { rawAttack: 127 });
    expect([...preview._voices][0].peak).to.equal(1);
    await preview.dispose();
    expect(limiter.disconnected).to.equal(true);
  });
  it('keeps master volume changes inert until enabled and applies the 70% default below the safe gain cap', async function() {
    const { preview, context, creations } = setup();
    expect(preview.getState().masterVolume).to.equal(0.7);
    expect(preview.setMasterVolume(0.4)).to.equal(0.4);
    expect(creations()).to.equal(0);
    expect(await preview.enable()).to.equal(true);
    expect(context.gains[0].gain.value).to.be.closeTo(0.15 / Math.sqrt(16) * 0.4, 0.000001);
    await preview.dispose();
    const defaults = setup();
    await defaults.preview.enable();
    expect(defaults.context.gains[0].gain.value).to.be.closeTo(0.15 / Math.sqrt(16) * 0.7, 0.000001);
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
    expect(master.events.at(-1).value).to.equal(0.15 / Math.sqrt(16));
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
    expect(master.events.at(-1).value).to.equal(0.15 / Math.sqrt(16) * 0.8);
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
    expect(source).not.to.match(/requestMIDIAccess|WebMidi|MidiScheduler|MidiEventRouter|^import /m);
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
    expect(context.gains[1].gain.events.at(-1).value).to.be.closeTo(100 * 64 / (127 * 127), 0.00001);
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
