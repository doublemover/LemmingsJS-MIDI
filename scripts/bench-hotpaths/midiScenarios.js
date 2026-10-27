import FakeTimers from '@sinonjs/fake-timers';
import { MidiEventRouter, MidiScheduler, measureN, setupRenderEnvironment, summarizeSamples, withGlobalStubs } from './shared.js';
import { BENCHMARK_RECEIPT_SCHEMA, admitMidiRepetition } from '../BenchmarkReceipt.js';

const makeMidiOutput = (channelCount = 16, observe = () => {}) => {
  const channels = {};
  for (let channel = 1; channel <= channelCount; channel++) channels[channel] = {
    sendNoteOn() { observe('noteOn'); }, sendNoteOff() { observe('noteOff'); },
    sendPitchBend() { observe('setup'); }, sendPitchBendRange() { observe('setup'); },
    sendControlChange() { observe('setup'); }, sendAllNotesOff() { observe('panic'); }
  };
  return { channels };
};

const runMidiBench = ({ kind, iterations, batchSize, repeats, workload = 'successful-fixed-work' }) => withGlobalStubs(() => {
  setupRenderEnvironment();
  const clock = FakeTimers.install({ now: 0, toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let owner = null, scheduler = null, current = null, tick = 0;
  try {
    const limits = { maxPerTick: 128, maxPerSecond: 1000, maxEventsPerSecond: 1000, maxBytesPerSecond: 100000000, maxActiveNotes: 32 };
    owner = kind === 'router' ? new MidiEventRouter({ enabled: true, noteRange: { min: 36, max: 96 },
      sfx: { 1: { enabled: true, note: 60, velocity: 96, durationTicks: 0, channel: 1 } },
      durationTicks: { min: 0, max: 0, default: 0 }, timing: { bpmBase: 120, scheduleAheadMs: 0 },
      repeat: { enabled: false }, mpe: { enabled: false }, limits }) : new MidiScheduler({ defaultChannel: 1, mpe: { enabled: false }, limits });
    scheduler = kind === 'router' ? owner.scheduler : owner;
    if (kind === 'router') owner.context = { game: { getGameTimer: () => ({ tps: 60, speedFactor: 1 }) } };
    scheduler.setTickMs(1000 / 60);
    const sendNote = scheduler.sendNote.bind(scheduler), reserve = scheduler.evaluateAndReserve.bind(scheduler);
    scheduler.sendNote = (...args) => {
      const admitted = sendNote(...args);
      if (current && admitted) current.admitted++;
      return admitted;
    };
    scheduler.evaluateAndReserve = (...args) => {
      const admission = reserve(...args);
      if (current && !admission.ok) current.rejectionReasons[admission.reason] = (current.rejectionReasons[admission.reason] || 0) + 1;
      return admission;
    };
    owner.setOutput(makeMidiOutput(16, type => {
      if (!current) return;
      if (type === 'noteOn') current.submittedNoteOns++;
      else if (type === 'noteOff') current.submittedNoteOffs++;
    }));
    const effectiveLimits = scheduler._outputRateLimits(null), transport = scheduler.getTransportBudget();
    if (workload === 'saturated-rate-rejection') {
      const count = Math.min(effectiveLimits.maxMessages, Math.floor(effectiveLimits.maxBytes / 3));
      const reservation = scheduler.evaluateAndReserve({ on: { timeMs: clock.now, count, bytes: count * 3 } }, {}, clock.now);
      if (!reservation.ok) throw new Error('Could not prepare the declared saturated MIDI rate window.');
    }
    const attempts = iterations * batchSize;
    const measured = measureN(repeats + 1, () => {
      current = { schema: BENCHMARK_RECEIPT_SCHEMA, source: kind, workload, clock: 'deterministic-workload-ms',
        startMs: clock.now, attempted: 0, admitted: 0, rejected: 0, submittedNoteOns: 0, submittedNoteOffs: 0, rejectionReasons: {} };
      for (let iteration = 0; iteration < iterations; iteration++) {
        tick++;
        for (let index = 0; index < batchSize; index++) {
          current.attempted++;
          if (kind === 'router') owner._onEvent({ tick, sfxId: 1, x: index * 7 % 320, y: index * 11 % 200 });
          else scheduler.sendNote({ note: 48 + (iteration + index) % 24, velocity: 96, durationTicks: 0, channel: 1 }, { sfxId: 1, priority: 1 });
        }
        if (workload === 'successful-fixed-work') {
          clock.tick(1001);
          for (const token of scheduler._activeNotes.keys()) scheduler._stopActiveNoteToken(token, 'benchmark-batch-terminal');
        }
      }
      current.rejected = current.attempted - current.admitted;
      Object.assign(current, { endMs: clock.now, activeVoices: scheduler._activeNotes.size,
        pendingOnsets: scheduler._pendingNoteOns.size, scheduledOffs: scheduler._noteOffs.length });
      const receipt = current; current = null;
      const admission = admitMidiRepetition(receipt, { attempts, workload, source: kind });
      if (!admission.accepted) throw new Error('Invalid MIDI benchmark repetition: ' + JSON.stringify(admission.diagnostics));
      return receipt;
    });
    owner.dispose();
    const finalCleanup = { activeVoices: scheduler._activeNotes.size, pendingOnsets: scheduler._pendingNoteOns.size,
      scheduledOffs: scheduler._noteOffs.length, timers: clock.countTimers() };
    if (Object.values(finalCleanup).some(value => value !== 0)) throw new Error('MIDI benchmark cleanup retained work.');
    owner = null;
    const summary = summarizeSamples(measured.samplesMs.slice(1), attempts), allocation = summarizeSamples(measured.allocationSamples.slice(1), attempts);
    return { ...summary, workload, fixture: 'ordinary-single-note-held-with-explicit-terminal', cpuClock: 'node-hrtime',
      allocationClock: 'process-heap-snapshot', allocBytesAvg: Math.round(allocation.avgMs), allocBytesP95: Math.round(allocation.p95Ms),
      allocBytesWorst: Math.round(allocation.worstMs), repetitions: measured.receipts.slice(1).map((receipt, index) => ({ ...receipt, cpuElapsedMs: measured.samplesMs[index + 1] })),
      warmup: { ...measured.receipts[0], cpuElapsedMs: measured.samplesMs[0] },
      effectiveLimits, transport, finalCleanup };
  } finally {
    current = null;
    try { owner?.dispose(); } finally { clock.uninstall(); }
  }
});

const runMidiRouterBench = ({ iterations, eventsPerIter, repeats, workload }) => runMidiBench({ kind: 'router', iterations, batchSize: eventsPerIter, repeats, workload });
const runMidiSchedulerBench = ({ iterations, notesPerIter, repeats, workload }) => runMidiBench({ kind: 'scheduler', iterations, batchSize: notesPerIter, repeats, workload });
export { makeMidiOutput, runMidiRouterBench, runMidiSchedulerBench };
