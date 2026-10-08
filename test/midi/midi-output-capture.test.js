import { expect } from 'chai';
import { createMidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { analyzeMidiOutputCapture, formatMidiCaptureSummary, renderMidiCaptureReport } from '../../js/midi/capture/MidiCaptureAnalysis.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { createBrowserNotePreview } from '../../js/app/midi-ui/browserNotePreview.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { makeOutput } from '../support/midi-output.js';

const config = { enabled: true, mpe: { enabled: false }, position: { mappings: [], viewPan: false },
  density: { velocityBoost: 0, durationScale: 0 }, timing: { scheduleAheadMs: 0 }, scale: { name: 'major', root: 0 },
  limits: { maxEventsPerSecond: 64, hardMaxEventsPerSecond: 64, maxBytesPerSecond: 100000, maxEventsPerTick: 32 },
  sfx: { '1': { notes: [60, 64, 67, 72], durationTicks: 1 } } };
const capturing = clock => { const capture = createMidiOutputCapture({ capacity: 16384, nowMs: () => clock.now }); capture.start({ seed: 42, scale: config.scale }); return capture; };
const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param(), pan: param() });
const audioContext = clock => ({
  state: 'running', get currentTime() { return clock.now / 1000; }, destination: {},
  createGain: node, createStereoPanner: node, createWaveShaper: node,
  createOscillator() {
    const oscillator = { ...node(), frequency: param(), detune: param(), start() {}, onended: null, timer: null,
      stop(time) { clearTimeout(this.timer); if (Number.isFinite(time)) this.timer = setTimeout(() => this.onended?.(), Math.max(0, time * 1000 - clock.now)); } };
    return oscillator;
  },
  addEventListener() {}, removeEventListener() {}, resume() { return Promise.resolve(); }, close() { return Promise.resolve(); }
});

describe('bounded MIDI output capture', function() {
  it('bounds memory, clones settings and snapshots, exports CSV/JSONL and stops by duration', function() {
    let now = 0;
    const capture = createMidiOutputCapture({ capacity: 64, maxDurationMs: 100, nowMs: () => now });
    const settings = { scale: { degrees: [0, 2, 4] }, label: 'a,"b"\n<c>' };
    capture.start(settings); settings.scale.degrees[0] = 11;
    for (let index = 0; index < 70; index += 1) capture.record('request', { note: index, reason: settings.label });
    const snapshot = capture.snapshot();
    expect(snapshot.metadata.scale.degrees[0]).to.equal(0);
    expect(snapshot.state).to.include({ retained: 64, recorded: 70, truncated: 6 });
    expect(snapshot.records[0].seq).to.equal(7);
    snapshot.records[0].note = 99;
    expect(capture.snapshot().records[0].note).to.equal(6);
    expect(capture.toJSONL().trim().split('\n')).to.have.length(65);
    expect(capture.toCSV()).to.include('"a,""b""\n<c>"');
    expect(renderMidiCaptureReport(capture.snapshot())).not.to.include('<c>');
    now = 101; expect(capture.record('request')).to.equal(null);
    expect(capture.getState()).to.include({ active: false, stopReason: 'duration-limit' });
    expect(analyzeMidiOutputCapture(capture.snapshot()).partialLifecycle).to.equal(true);
  });

  it('preserves bounded track/program/role settings references and CSV provenance', function() {
    const capture = createMidiOutputCapture();
    capture.start({ settingsReference: { projectId: 'p1', tracks: [{ id: 'bass', channel: 2, program: 38 }],
      ensemble: { roles: [{ id: 'bass', register: { min: 36, max: 55 }, pan: -18 }] } } });
    const metadata = capture.snapshot().metadata;
    expect(metadata.settingsReference.tracks[0]).to.deep.equal({ id: 'bass', channel: 2, program: 38 });
    expect(metadata.settingsReference.ensemble.roles[0]).to.deep.equal({ id: 'bass', register: { min: 36, max: 55 }, pan: -18 });
    capture.record('request', { seed: 42, generation: 3, themeId: 'dirt', scaleRoot: 2, scaleDegrees: [0, 2, 3],
      beatClock: 'simulation-base-ticks', outputScope: 'audio-1', captureScope: 'scheduler-1' });
    expect(capture.toCSV()).to.include('beatClock').and.include('generation').and.include('scaleDegrees').and.include('outputScope');
    expect(capture.toCSV()).to.include('"simulation-base-ticks"').and.include('"dirt"');
  });

  it('protects canonical and note lifecycle fields when real observer provenance exceeds 48 fields', function() {
    withFakeClockAndPerformance(clock => {
      const capture = capturing(clock), scheduler = new MidiScheduler(config);
      scheduler.setCapture(capture); scheduler.setOutput(makeOutput([1], []));
      const metadata = Object.fromEntries(Array.from({ length: 80 }, (_, index) => ['optional' + index, 'extra metadata']));
      Object.assign(metadata, { tick: 100, beat: 12, laneIndex: 3, laneCount: 16, lemmingId: 9, seed: 42, generation: 4, themeId: 'dirt', origin: 'procgen' });
      scheduler.sendNote({ note: 60, channel: 1, durationTicks: 2, program: 38, pan: -12 }, metadata);
      clock.tick(130); scheduler.dispose();
      const snapshot = capture.snapshot();
      expect(snapshot.records.every(record => Number.isInteger(record.seq) && typeof record.stage === 'string' && Number.isFinite(record.dispatchMs))).to.equal(true);
      const on = snapshot.records.find(record => record.stage === 'api-dispatch' && record.type === 'noteOn');
      const off = snapshot.records.find(record => record.stage === 'api-dispatch' && record.type === 'noteOff');
      expect(on).to.include({ note: 60, channel: 1, laneIndex: 3, generation: 4 });
      expect(off).to.include({ matchedDurationMs: 120, token: on.token });
      expect(Object.keys(off).length).to.be.at.most(64);
      const report = analyzeMidiOutputCapture(snapshot);
      expect(report.noteOns).to.equal(1); expect(report.notes[0].durationMs).to.equal(120);
      expect(report.openNotes).to.have.length(0); expect(report.elapsedSeconds).to.be.finite;
    });
  });

  it('captures base-tick beats across speed changes and each phrase cell dispatch', function() {
    withFakeClockAndPerformance(clock => {
      const capture = capturing(clock), timer = { speedFactor: 0.1, TIME_PER_FRAME_MS: 60 };
      const router = new MidiEventRouter({ ...config, timing: { scheduleAheadMs: 0, bpmBase: 120 }, sfx: { '1': { note: 60, durationTicks: 1 } } });
      router.context = { game: { getGameTimer: () => timer, seed: 42, generation: 3, laneCount: 4, laneSeeds: [9], terrain: { recipe: { id: 'pack:dirt' }, laneThemes: ['dirt'] } } };
      router.setCapture(capture); router.setOutput(makeOutput([1], []));
      router._onEvent({ sfxId: 1, type: 'fixture', tick: 100, laneIndex: 0, laneCount: 4, frameMs: 600, speedFactor: 0.1 });
      clock.tick(1001); timer.speedFactor = 1e308;
      expect(router._captureBeatFields(100)).to.include({ beat: 12, beatClock: 'simulation-base-ticks', tempoBpm: 120 });
      timer.speedFactor = 1;
      router._sendGamePhraseNote({ note: 64, durationTicks: 1 }, { laneIndex: 0, laneCount: 4, tick: 100, beat: 12 }, 104);
      const records = capture.snapshot().records;
      expect(records.find(record => record.stage === 'request')).to.include({ beat: 12, seed: 42, generation: 3, originId: 'pack:dirt', themeId: 'dirt' });
      const cell = records.find(record => record.stage === 'api-dispatch' && record.note === 64);
      expect(cell).to.include({ tick: 104, beatClock: 'simulation-base-ticks' }); expect(cell.beat).to.be.closeTo(12.48, 1e-10);
      router.dispose();
    });
  });

  it('skips stopped observer work and keeps lifecycle ownership across replacement scopes', function() {
    withFakeClockAndPerformance(clock => {
      const scheduler = new MidiScheduler({ ...config }), calls = [];
      let observations = 0;
      scheduler.setCapture({ isActive: () => false, record() { observations += 1; } });
      scheduler.setOutput(makeOutput([1], calls));
      Object.defineProperty(scheduler.config, 'scale', { get() { throw new Error('inactive scale clone'); }, configurable: true });
      expect(scheduler.sendNote({ note: 60, durationTicks: 1 })).to.equal(true);
      clock.tick(70); scheduler.dispose(); expect(observations).to.equal(0);
      const capture = capturing(clock);
      for (const captureScope of ['old', 'new']) capture.record('api-dispatch', { type: 'noteOn', accepted: true, outputScope: 'one', captureScope, channel: 1, note: 60, token: 1, scheduledMs: clock.now });
      clock.tick(20);
      for (const captureScope of ['new', 'old']) capture.record('api-dispatch', { type: 'noteOff', accepted: true, outputScope: 'one', captureScope, channel: 1, note: 60, token: 1, scheduledMs: clock.now });
      const report = analyzeMidiOutputCapture(capture.snapshot());
      expect(report.notes.map(note => note.durationMs)).to.deep.equal([20, 20]);
      expect(report.openNotes).to.have.length(0); expect(report.orphanNoteOffs).to.have.length(0);
      expect(capture.getState().observedOpenGates).to.equal(0);
    });
  });

  it('keeps a planned audition scale context after later project edits', async function() {
    await withFakeClockAndPerformance(async clock => {
      const capture = capturing(clock), preview = createBrowserNotePreview({ createAudioContext: () => audioContext(clock), nowMs: () => clock.now });
      let context = { scaleRoot: 0, scaleDegrees: [0, 2, 4, 5, 7, 9, 11], generation: 1 };
      preview.setCapture(capture, () => context);
      await preview.preview([{ note: 60, offsetMs: 0, durationMs: 200 }, { note: 64, offsetMs: 10000, durationMs: 200 }]);
      context = { scaleRoot: 1, scaleDegrees: [0, 2, 4, 5, 7, 9, 11], generation: 2 };
      await clock.tickAsync(11000);
      const snapshot = capture.snapshot(), report = analyzeMidiOutputCapture(snapshot);
      expect(snapshot.records.filter(record => record.stage === 'synth-scheduled').map(record => record.scaleRoot)).to.deep.equal([0, 0]);
      expect(report.outsideScale).to.equal(0);
      expect(report.notes.every(note => note.generation === 1)).to.equal(true);
      await preview.dispose();
    });
  });

  it('matches note lifecycles and inspects coalescing, ownership, held notes and Panic', function() {
    withFakeClockAndPerformance(clock => {
      const capture = capturing(clock), calls = [], output = makeOutput([2], calls, 'fake-output');
      output.channels[2].sendProgramChange = value => calls.push({ type: 'program', value });
      const scheduler = new MidiScheduler({ ...config, position: { panRange: { min: -127, max: 127 } } });
      scheduler.setCapture(capture); scheduler.setOutput(output);
      const spec = { note: 60, channel: 2, program: 38, pan: -12, velocity: 90, durationTicks: 2 };
      scheduler.sendNote(spec, { laneIndex: 0, lemmingId: 12 });
      scheduler.sendNote({ ...spec, note: 64 }, { laneIndex: 0, lemmingId: 12 });
      clock.tick(130);
      scheduler.sendNote({ ...spec, note: 67, durationTicks: 0, program: 29 });
      scheduler.allNotesOff(); capture.stop();
      const snapshot = capture.snapshot(), report = analyzeMidiOutputCapture(snapshot);
      expect(report.noteOns).to.equal(3);
      expect(report.openNotes).to.have.length(0);
      expect(report.orphanNoteOffs).to.have.length(0);
      expect(report.activeChannelChanges).to.have.length(0);
      expect(report.coalescing[0].count).to.equal(3);
      const releases = snapshot.records.filter(record => record.type === 'noteOff' && record.stage === 'api-dispatch');
      expect(releases.map(record => record.matchedDurationMs)).to.deep.equal([120, 120]);
      expect(snapshot.state.observedOpenGates).to.equal(0);
      expect(report.notes[2].held).to.equal(true);
      expect(formatMidiCaptureSummary(snapshot)).to.include('3 accepted note-on API calls');
      scheduler.dispose();
    });
  });

  it('captures complete lane demand and expanded chord admission without changing output', function() {
    withFakeClockAndPerformance(clock => {
      const capture = capturing(clock), router = new MidiEventRouter(config), calls = [];
      router.setCapture(capture); router.setOutput(makeOutput([1], calls, 'fake-output'));
      for (let second = 0; second < 32; second += 1) {
        for (let laneIndex = 0; laneIndex < 64; laneIndex += 1) router._onEvent({ sfxId: 1, type: 'fixture', tick: second,
          laneIndex, laneCount: 64, lemmingId: laneIndex, frameMs: 60, speedFactor: second < 16 ? 1 : 8 });
        clock.tick(1001);
      }
      router.dispose(); capture.stop();
      const report = analyzeMidiOutputCapture(capture.snapshot());
      expect(report.requests).to.equal(2048);
      expect(report.noteOns).to.equal(calls.filter(call => call.type === 'noteOn').length);
      expect(report.fairness).to.include({ demandedLanes: 64, heardLanes: 64 });
      expect(report.outsideScale).to.equal(0);
      expect(report.openNotes).to.have.length(0);
      expect(report.drops.some(entry => entry.value === 'lane-share')).to.equal(true);
    });
  });

  it('does not let a capture observer failure interrupt sends or note-off ownership', function() {
    withFakeClockAndPerformance(clock => {
      const calls = [], scheduler = new MidiScheduler(config);
      scheduler.setCapture({ record() { throw new Error('broken observer'); } });
      scheduler.setOutput(makeOutput([1], calls));
      expect(scheduler.sendNote({ note: 60, durationTicks: 1 })).to.equal(true);
      clock.tick(70);
      expect(calls.filter(call => call.type === 'noteOff')).to.have.length(1);
      scheduler.dispose();
    });
  });

  it('records rejected and throwing output API calls without changing return or exception behavior', function() {
    withFakeClockAndPerformance(clock => {
      const capture = capturing(clock), scheduler = new MidiScheduler(config), output = makeOutput([1], []);
      scheduler.setCapture(capture); scheduler.setOutput(output);
      output.channels[1].sendNoteOn = () => false;
      expect(scheduler._sendOutput(output, 1, 'sendNoteOn', [60, { rawAttack: 96, time: clock.now }])).to.equal(false);
      output.channels[1].sendNoteOn = () => { throw new Error('fixture rejected send'); };
      expect(() => scheduler._sendOutput(output, 1, 'sendNoteOn', [64, { rawAttack: 90, time: clock.now }])).to.throw('fixture rejected send');
      const records = capture.snapshot().records;
      expect(records.find(record => record.stage === 'api-dispatch')).to.include({ accepted: false, reason: 'returned-false', type: 'noteOn', note: 60 });
      expect(records.find(record => record.stage === 'api-failed')).to.include({ accepted: false, reason: 'fixture rejected send', type: 'noteOn', note: 64 });
      expect(capture.getState().observedOpenGates).to.equal(0);
      const report = analyzeMidiOutputCapture(capture.snapshot()); expect(report.noteOns).to.equal(0);
      scheduler.dispose();
    });
  });

  it('records late-drop reasons without inventing an API note-on', function() {
    withFakeClockAndPerformance(clock => {
      const capture = capturing(clock), scheduler = new MidiScheduler(config), calls = [];
      scheduler.setCapture(capture); scheduler.setOutput(makeOutput([1], calls));
      scheduler.sendNote({ note: 60, timeMs: 500, durationTicks: 1 });
      clock.jump(1000);
      expect(calls.filter(call => call.type === 'noteOn')).to.have.length(0);
      expect(capture.snapshot().records.some(record => record.stage === 'drop' && record.reason === 'expired-note')).to.equal(true);
      expect(analyzeMidiOutputCapture(capture.snapshot()).noteOns).to.equal(0);
      scheduler.dispose();
    });
  });

  it('records demand-render samples without activating audio or adding voices', async function() {
    await withFakeClockAndPerformance(async clock => {
      const capture = capturing(clock), context = audioContext(clock);
      context.sampleRate = 48000;
      let analysers = 0;
      context.createAnalyser = () => { analysers += 1; return { ...node(), getFloatTimeDomainData(samples) { samples.fill(0.02); } }; };
      const preview = createBrowserNotePreview({ createAudioContext: () => context, nowMs: () => clock.now });
      preview.setCapture(capture);
      expect(preview.inspectRender()).to.equal(null); expect(analysers).to.equal(0);
      await preview.preview([{ note: 60, durationMs: 200 }]);
      const voices = preview.getState().activeVoices;
      const sample = preview.inspectRender(); preview.inspectRender();
      expect(sample).to.include({ sampleRate: 48000, frames: 2048, acousticReceipt: false, localMasterGain: 0.7 });
      expect(sample.rms).to.be.closeTo(0.02, 1e-6); expect(analysers).to.equal(1);
      expect(preview.getState().activeVoices).to.equal(voices);
      const render = capture.snapshot().records.filter(record => record.stage === 'synth-render-sample');
      expect(render).to.have.length(2); expect(render[0]).to.include({ backend: 'local-synth', audioTime: 0 });
      await preview.dispose();
    });
  });

  it('observes all 16 long-audition notes and cancellation in the existing incremental queue', async function() {
    await withFakeClockAndPerformance(async clock => {
      const capture = capturing(clock), preview = createBrowserNotePreview({ createAudioContext: () => audioContext(clock), nowMs: () => clock.now });
      preview.setCapture(capture);
      const notes = Array.from({ length: 16 }, (_, index) => ({ note: 60 + index % 7, offsetMs: index * 960, durationMs: 200 }));
      expect(await preview.preview(notes)).to.equal(true);
      await clock.tickAsync(15200);
      let snapshot = capture.snapshot(), report = analyzeMidiOutputCapture(snapshot);
      expect(report.requests).to.equal(16); expect(report.noteOns).to.equal(16);
      expect(report.synthSchedules).to.equal(16); expect(report.synthEnds).to.equal(16);
      expect(report.notes.every(note => note.durationMs === 200)).to.equal(true);
      expect(snapshot.records.filter(record => record.stage === 'synth-scheduled').every(record => record.audioTime >= 0)).to.equal(true);
      await preview.preview(notes); preview.stop(); await clock.tickAsync(16000);
      snapshot = capture.snapshot();
      expect(snapshot.records.some(record => record.stage === 'cancelled' && record.reason === 'audition-stop')).to.equal(true);
      const afterStop = snapshot.records.filter(record => record.stage === 'synth-scheduled').length;
      await clock.tickAsync(1000);
      expect(capture.snapshot().records.filter(record => record.stage === 'synth-scheduled')).to.have.length(afterStop);
      await preview.dispose();
    });
  });
});
