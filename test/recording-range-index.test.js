import { expect } from 'chai';
import { createMidiRecordingRangeIndex } from '../js/app/procgen/workstation/MidiRecordingRangeIndex.js';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';

const empty = { firstSequence: null, lastSequence: null, firstTimestamp: null, lastTimestamp: null };
const reference = records => {
  const retained = records.filter(event => !event.cancelled);
  return retained.length ? { firstSequence: retained[0].sequence, lastSequence: retained.at(-1).sequence,
    firstTimestamp: Math.min(...retained.map(event => event.timestamp)), lastTimestamp: Math.max(...retained.map(event => event.timestamp)) } : empty;
};
describe('incremental MIDI recording range ownership', function() {
  this.timeout(15000);
  it('matches full reference ranges through out-of-order timestamps, duplicate extrema and canceled middle/end records', () => {
    const records = [], index = createMidiRecordingRangeIndex({ getRecords: () => records, capacity: 4096 }); let seed = 19;
    try {
      for (let sequence = 1; sequence <= 4096; sequence++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const event = { sequence, timestamp: seed % 113 }; index.append(event); records.push(event);
        if (sequence % 64 === 0) {
          for (let count = 0; count < 11; count++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; index.cancel(records[seed % records.length]); }
          expect(index.snapshot()).to.deep.equal(reference(records)); const before = index.diagnostics().scannedEvents; index.snapshot(); expect(index.diagnostics().scannedEvents).to.equal(before);
        }
      }
      for (const event of records) index.cancel(event); expect(index.snapshot()).to.deep.equal(empty);
    } finally { index.dispose(); }
  });
  it('handles empty/single/chunk-edge capacities and keeps private positions out of copied recording events', () => {
    for (const capacity of [0, 1, 127, 128, 129]) {
      const records = [], index = createMidiRecordingRangeIndex({ getRecords: () => records, capacity }); index.prepare();
      for (let sequence = 1; sequence <= capacity; sequence++) { const event = { sequence, timestamp: capacity - sequence }; index.append(event); records.push(event); }
      expect(index.snapshot()).to.deep.equal(reference(records)); expect(() => index.append({ sequence: capacity + 1, timestamp: 0 })).to.throw('capacity');
      if (records.length) { expect(Object.getOwnPropertySymbols({ ...records[0] })).to.have.length(0); index.cancel(records[0]); index.cancel(records.at(-1)); }
      expect(index.snapshot()).to.deep.equal(reference(records)); index.dispose();
    }
  });
  it('rejects stale cancellation after clear, preserves snapshots and never resurrects a retired index', () => {
    let records = []; const index = createMidiRecordingRangeIndex({ getRecords: () => records, capacity: 256 });
    const old = { sequence: 1, timestamp: 12 }; index.append(old); records.push(old); const snapshot = index.snapshot();
    records = []; index.clear(); const next = { sequence: 1, timestamp: 20 }; index.append(next); records.push(next);
    expect(index.cancel(old)).to.equal(false); expect(index.cancel({ ...next })).to.equal(false); expect(index.snapshot().firstTimestamp).to.equal(20);
    expect(snapshot.firstTimestamp).to.equal(12); expect(Object.isFrozen(snapshot)).to.equal(true); index.dispose(); expect(() => index.prepare()).to.throw('retired');
    expect(index.cancel(next)).to.equal(false); expect(index.snapshot().firstTimestamp).to.equal(20);
  });
  it('reserves before allocating and keeps unknown release charged with a readable final range', () => {
    const budget = createResourceBudget({ limitBytes: 4096 }), denied = createMidiRecordingRangeIndex({ getRecords: () => [], capacity: 100000, resourceBudget: budget });
    expect(() => denied.prepare()).to.throw('available'); expect(denied.diagnostics().typedBytes).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0); denied.dispose();
    const retained = createResourceBudget(), records = [], index = createMidiRecordingRangeIndex({ getRecords: () => records, capacity: 128,
      resourceBudget: { reserve: value => retained.reserve(value), release: () => false } });
    const event = { sequence: 1, timestamp: 3 }; index.append(event); records.push(event); index.dispose();
    expect(index.diagnostics().reservation.state).to.equal('failed-or-unknown'); expect(index.diagnostics().typedBytes).to.be.greaterThan(0);
    expect(retained.diagnostics().accountedBytes).to.be.greaterThan(0); expect(index.snapshot().firstTimestamp).to.equal(3);
  });
  it('rejects malformed capacities and nonfinite/unretained event inputs before indexing them', () => {
    for (const capacity of [-1, 2000001, Infinity, 0.5]) expect(() => createMidiRecordingRangeIndex({ getRecords: () => [], capacity })).to.throw('bounded');
    const index = createMidiRecordingRangeIndex({ getRecords: () => [], capacity: 1 });
    for (const event of [null, { sequence: 0, timestamp: 0 }, { sequence: 1, timestamp: NaN }, { sequence: 1, timestamp: 0, cancelled: true }]) expect(() => index.append(event)).to.throw('retained finite');
    expect(index.diagnostics().typedBytes).to.equal(0); index.dispose();
  });
  for (const history of [1000, 10000, 100000]) it('cancels an outer future note after' + history + ' historical CCs without visiting retained history', () => {
    const budget = createResourceBudget(), ports = createProcgenMidiPorts({ now: () => 1000, maxRecordedEvents: history + 32, resourceBudget: budget });
    try {
      ports.configure({ recording: true });
      for (let event = 0; event < history; event++) ports.recordEvent({ type: 'cc', channel: 1, controller: 74, value: event % 128, timestamp: event % 1000 });
      expect(ports.recordOutput({ note: 60, channel: 1, velocity: 90, timeMs: 2000, durationMs: 500 })).to.equal(true);
      const before = ports.getRecordingIndexState(); ports.flush(); const state = ports.getState(), after = ports.getRecordingIndexState();
      expect(state.recordedEvents).to.equal(history); expect(state.retainedRange).to.deep.equal({ firstSequence: 1, lastSequence: history, firstTimestamp: 0, lastTimestamp: 999 });
      expect(after.scannedEvents - before.scannedEvents).to.be.at.most(128); expect(after.refreshedChunks - before.refreshedChunks).to.equal(1);
      const count = ports.getRecording().length; ports.flush(); expect(ports.getRecording()).to.have.length(count);
      expect(ports.getRecordingIndexState().scannedEvents).to.equal(after.scannedEvents);
    } finally { ports.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0); }
  });
  it('retains exact serialized public data, refuses recording pressure atomically and releases stopped/cleared storage', () => {
    const budget = createResourceBudget(), callbacks = [], ports = createProcgenMidiPorts({ now: () => 1000, resourceBudget: budget, onRecord: event => callbacks.push(event) });
    ports.configure({ recording: true }); ports.recordTempo(120, 0, 10); ports.recordEvent({ type: 'cc', channel: 2, controller: 1, value: 40, timestamp: 20 });
    const saved = ports.getRecording(); expect(saved.map(event => event.data)).to.deep.equal([[], [0xb1, 1, 40]]);
    expect(callbacks.every(event => Object.isFrozen(event) && !Object.getOwnPropertySymbols(event).length)).to.equal(true);
    expect(saved.every(event => !Object.getOwnPropertySymbols(event).length)).to.equal(true); const json = JSON.stringify(saved);
    ports.configure({ recording: false }); ports.clearRecording(); expect(budget.diagnostics().accountedBytes).to.equal(0); expect(JSON.stringify(saved)).to.equal(json); ports.dispose();
    const deniedBudget = createResourceBudget({ limitBytes: 4096 }), denied = createProcgenMidiPorts({ resourceBudget: deniedBudget });
    expect(denied.configure({ recording: true })).to.include({ recording: false }); expect(denied.getState().lastConfigurationFailure.reason).to.equal('recording-index-budget');
    expect(denied.getRecordingIndexState().typedBytes).to.equal(0); expect(denied.getRecording()).to.deep.equal([]); denied.panic(); denied.dispose();
    expect(deniedBudget.diagnostics().accountedBytes).to.equal(0);
  });
  it('refuses nonfinite recording clocks without retaining broken future cleanup entries', () => {
    const ports = createProcgenMidiPorts({ now: () => 1000 });
    try {
      ports.configure({ recording: true });
      for (const timestamp of [NaN, Infinity, -Infinity]) {
        expect(ports.recordOutput({ note: 60, timeMs: timestamp, durationMs: 20 })).to.equal(false);
        expect(ports.recordEvent({ type: 'cc', controller: 74, value: 60, timestamp })).to.equal(false);
      }
      expect(ports.recordOutput({ note: 60, timeMs: Number.MAX_VALUE, durationMs: Number.MAX_VALUE })).to.equal(false);
      ports.flush(); ports.panic(); expect(ports.getState().retainedRange).to.deep.equal(empty); expect(ports.getRecording()).to.have.length(0);
    } finally { ports.dispose(); }
  });
});
