import { expect } from 'chai';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { snapshotMidiRecording, recordingExportPeakBytes } from '../js/app/procgen/workstation/MidiRecordingExportSnapshot.js';
import { encodeRecordedMidi } from '../js/app/procgen/workstation/RecordedMidiEncoding.js';
import { exportProcgenMidi, selectBalancedProcgenRecording } from '../js/app/procgen/workstation/ProcgenMidiExport.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';

const windowState = { recordingComplete: true, incompleteReason: null, incompleteReasons: [], retainedRange: { firstSequence: 1, lastSequence: 100, firstTimestamp: 0, lastTimestamp: 2000 },
  firstLostSequence: null, droppedRecords: 0, droppedCategories: { input: 0, output: 0, transport: 0, other: 0 } };
const fast = { yieldControl: async () => {} };
const rejected = async (work, text) => { let error; try { await work; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); if (text) expect(error.message).to.include(text); return error; };
const snapshot = records => snapshotMidiRecording({ records, count: records.length, isCurrent: () => true, yieldTask: async () => {} });
const reference = (records, window, options) => {
  const output = records.filter(event => !event.cancelled && (event.direction === 'output' || event.type === 'tempo'));
  const submitted = output.some(event => event.evidence === 'api-accepted'), evidence = submitted ? 'api-accepted' : 'intent-render';
  const balanced = selectBalancedProcgenRecording(output.filter(event => event.evidence === evidence || event.type === 'tempo'));
  const complete = window.recordingComplete && !balanced.omittedOnsets && !balanced.omittedReleases;
  const manifest = { schema: 'procgen-recording-window/v1', complete, reason: window.incompleteReason || (complete ? null : 'unpaired-note-boundary'), reasons: window.incompleteReasons,
    evidence, retainedRange: window.retainedRange, firstLostSequence: window.firstLostSequence, droppedRecords: window.droppedRecords,
    droppedCategories: window.droppedCategories, omittedOnsets: balanced.omittedOnsets, omittedReleases: balanced.omittedReleases };
  return { bytes: exportProcgenMidi(balanced.events, { ...options, manifest }), manifest };
};
describe('owned recorded MIDI worker export', function() {
  this.timeout(20000);
  it('rejects physical-source options on submitted-output columns rather than silently ignoring their clock', async () => {
    const valid = await snapshot([{ direction: 'output', evidence: 'intent-render', data: [0xb0, 1, 80], beat: 0 }]);
    await rejected(encodeRecordedMidi({ snapshot: valid, window: windowState, options: { sourceTime: { domain: 'simulation-tick' } } },
      { estimatedPeakBytes: recordingExportPeakBytes(1), ...fast }), 'typed physical');
  });
  it('rejects unmapped snapshot beats and negative worker times while preserving explicit zero', async () => {
    for (const beat of [undefined, null, '', '2', NaN, Infinity, -1]) await rejected(snapshot([{ direction: 'output', evidence: 'intent-render', data: [0xb0, 1, 80], beat }]), 'unmapped');
    const valid = await snapshot([{ direction: 'output', evidence: 'intent-render', data: [0xb0, 1, 80], beat: 0 }]);
    valid.timing[0] = -1;
    await rejected(encodeRecordedMidi({ snapshot: valid, window: windowState }, { estimatedPeakBytes: recordingExportPeakBytes(1), ...fast }), 'unmapped');
    valid.timing[0] = Number.MAX_SAFE_INTEGER;
    await rejected(encodeRecordedMidi({ snapshot: valid, window: windowState }, { estimatedPeakBytes: recordingExportPeakBytes(1), ...fast }), 'exact SMF');
    valid.timing[0] = 0; expect((await encodeRecordedMidi({ snapshot: valid, window: windowState }, { estimatedPeakBytes: recordingExportPeakBytes(1), ...fast })).bytes).to.be.instanceOf(Uint8Array);
  });
  it('matches the complete reference bytes on generated same-pitch sustain, routes, timestamp disorder, cancellation and evidence windows', async () => {
    let random = 37; const next = bound => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % bound; };
    for (let trial = 0; trial < 64; trial++) {
      const records = [{ type: 'tempo', bpm: 120, beat: 0 }];
      for (let index = 0; index < 512; index++) {
        const channel = next(4), kind = next(6), note = 60 + next(3), data = kind === 0 ? [0xb0 | channel, 64, next(2) * 127] :
          kind === 1 ? [0xc0 | channel, next(128)] : kind === 2 ? [0xe0 | channel, next(128), next(128)] :
            kind === 3 ? [0x80 | channel, note, 0] : [0x90 | channel, note, 1 + next(127)];
        records.push({ data, beat: next(4096) / 480, direction: next(5) ? 'output' : 'input', evidence: trial % 2 && next(4) ? 'api-accepted' : 'intent-render',
          outputId: 'port-' + next(3), cancelled: next(13) === 0 });
        if (index % 100 === 0) records.push({ type: 'tempo', bpm: 80 + next(100), beat: next(16) });
      }
      const window = trial % 3 ? windowState : { ...windowState, recordingComplete: false, incompleteReason: 'recording-cap-reached', incompleteReasons: ['recording-cap-reached'], droppedRecords: 3, firstLostSequence: 400 };
      const options = { bpm: 90 + next(80), ppq: trial % 2 ? 96 : 480, beatsPerBar: 3, beatUnit: 8 };
      const actual = await encodeRecordedMidi({ snapshot: await snapshot(records), window, options }, { ...fast, estimatedPeakBytes: recordingExportPeakBytes(records.length) });
      expect(actual.manifest).to.deep.equal(reference(records, window, options).manifest); expect(actual.bytes).to.deep.equal(reference(records, window, options).bytes);
    }
  });
  it('captures a stable prefix while new events append and refuses clear, canceled future events and retirement', async () => {
    const ports = createProcgenMidiPorts({ now: () => 1000 });
    try {
      ports.configure({ recording: true }); ports.recordOutput({ note: 60, timeMs: 900, durationMs: 200 }, { beat: 1, bpm: 120 });
      const first = ports.createRecordingExportSource(); ports.recordEvent({ type: 'cc', controller: 74, value: 40, timestamp: 1100, beat: 1 });
      const input = await first.prepareInput(); expect(input.count).to.equal(2); expect(first.isCurrent()).to.equal(true);
      ports.flush(); expect(first.isCurrent()).to.equal(false); await rejected(first.prepareInput(), 'changed'); first.release();
      const second = ports.createRecordingExportSource(); expect(second.id).to.equal(first.id); ports.clearRecording(); await rejected(second.prepareInput(), 'changed'); second.release();
      const third = ports.createRecordingExportSource(); expect(third.id).not.to.equal(first.id); ports.dispose(); await rejected(third.prepareInput(), 'changed'); third.release();
    } finally { ports.dispose(); }
  });
  it('uses production paged worker transport and transfers the owned result without publishing private recording metadata', async () => {
    const ports = createProcgenMidiPorts({ now: () => 1000 }), jobs = createTestBackgroundJobs(), budget = createResourceBudget(); let computed;
    try {
      ports.configure({ recording: true }); ports.recordOutput({ note: 60, timeMs: 900, durationMs: 50 }, { beat: 1 });
      const source = ports.createRecordingExportSource();
      computed = await jobs.compute({ kind: 'encode-recorded-midi', ownerId: 'midi-test', ownerEpoch: 1, sourceRevision: 'take:1', inputBytes: source.inputBytes,
        estimatedPeakBytes: source.estimatedPeakBytes, budgetAdapter: budget, retainInput: true, isCurrent: source.isCurrent, releasePreparedInput: source.release,
        prepareInput: async () => ({ snapshot: await source.prepareInput(), window: source.state, options: { bpm: 120 } }) });
      expect(computed.receipt.method).to.equal('dedicated-worker'); expect(computed.receipt.outputTransport.ownedTransferredBytes).to.equal(computed.value.bytes.byteLength);
      expect(computed.value.bytes).to.deep.equal(reference(ports.getRecording(), source.state, { bpm: 120 }).bytes);
      expect(budget.diagnostics().accountedBytes).to.be.greaterThan(0); computed.release(); expect(budget.diagnostics().accountedBytes).to.equal(0);
    } finally { computed?.release(); ports.dispose(); jobs.dispose(); }
  });
  it('reserves before producing a snapshot and refuses missing workers without copying history', async () => {
    let produced = 0; const jobs = createTestBackgroundJobs(), budget = createResourceBudget({ limitBytes: 4096 }), noWorker = createBackgroundJobService({ Worker: null });
    const request = { kind: 'encode-recorded-midi', ownerId: 'midi-test', ownerEpoch: 1, sourceRevision: 'take:1', inputBytes: 1,
      estimatedPeakBytes: recordingExportPeakBytes(0), prepareInput: () => { produced++; return {}; } };
    try { await rejected(jobs.compute({ ...request, budgetAdapter: budget }), 'available'); await rejected(noWorker.compute(request), 'requires its admitted worker'); expect(produced).to.equal(0); }
    finally { jobs.dispose(); noWorker.dispose(); }
  });
  it('cancels between bounded snapshot slices and rejects oversized routes, clocks and export workspaces', async () => {
    const controller = new AbortController(), records = Array.from({ length: 10000 }, () => ({ type: 'tempo', bpm: 120, beat: 0 })); let slices = 0;
    await rejected(snapshotMidiRecording({ records, count: records.length, isCurrent: () => true, signal: controller.signal, now: () => 0,
      yieldTask: async () => { slices++; controller.abort(); } })); expect(slices).to.equal(1);
    expect(() => recordingExportPeakBytes(2000000)).to.throw('workspace');
    await rejected(snapshot([{ direction: 'output', evidence: 'intent-render', data: [0x90, 60, 80], beat: Infinity }]), 'unmapped');
    await rejected(snapshot([{ direction: 'output', evidence: 'intent-render', data: [0x90, 60, 80], beat: 0, outputId: 'x'.repeat(4097) }]), 'route');
    const empty = await snapshot([]);
    await rejected(encodeRecordedMidi({ snapshot: empty, window: windowState }, { estimatedPeakBytes: 4096 }), 'workspace');
    const invalid = await snapshot([{ type: 'tempo', bpm: 0, beat: 0 }]);
    await rejected(encodeRecordedMidi({ snapshot: invalid, window: windowState }, { estimatedPeakBytes: recordingExportPeakBytes(1) }), 'Tempo');
  });
});
