import { expect } from 'chai';
import { createOriginalUmpCapture } from '../js/app/procgen/workstation/OriginalUmpCapture.js';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { encodeRecordedMidi } from '../js/app/procgen/workstation/RecordedMidiEncoding.js';
import { recordingExportPeakBytes } from '../js/app/procgen/workstation/MidiRecordingExportSnapshot.js';
import { exportProcgenMidi, selectBalancedProcgenRecording } from '../js/app/procgen/workstation/ProcgenMidiExport.js';
import { parseSmf } from './support/smf.js';

const route = { outputId: 'native-route', connectionEpoch: 7, routeRevision: 11 };
const event = (umpWords = [0x41923c00, 0x12340000]) => ({ umpWords, beat: 8, timestamp: 4000, intentId: 'intent-A', sourceEventIds: ['event-A'] });
describe('original UMP authored capture before route lowering', () => {
  it('owns exact words and attribution once per authored event without merging unisons', () => {
    const capture = createOriginalUmpCapture(), rows = [], original = { ...event(), actorId: 32 };
    expect(capture.record(original, route, row => rows.push(row))).to.equal(true);
    expect(capture.record(original, route, row => rows.push(row))).to.equal(true);
    original.umpWords[1] = 0; original.sourceEventIds[0] = 'changed';
    expect(rows).to.have.length(2); expect(rows[0]).to.include({ type: 'umpIntent', protocol: 'ump', sourceProtocol: 'midi2', beat: 8, connectionEpoch: 7, routeRevision: 11, publication: 'authored-not-submitted' });
    expect(rows[0].umpWords).to.deep.equal([0x41923c00, 0x12340000]); expect(rows[0].sourceEventIds).to.deep.equal(['event-A']); expect(rows[0].actorId).to.equal(32);
    expect(Object.isFrozen(rows[0].umpWords)).to.equal(true); expect(capture.state()).to.include({ recorded: 2, complete: true, sourceLayer: 'authored-intent', publication: 'not-submitted' }); capture.dispose();
  });
  it('retains MIDI1-in-UMP source precision and unknown packets without calling them MIDI2', () => {
    const capture = createOriginalUmpCapture(), rows = [];
    capture.record(event([0x21923c7f]), route, row => rows.push(row)); capture.record(event([0xe0000000, 1, 2, 3]), route, row => rows.push(row));
    expect(rows.map(row => row.sourceProtocol)).to.deep.equal(['midi1', 'ump']); capture.dispose();
  });
  it('retains raw relative controls and marks absent source beat explicitly unmapped', () => {
    const capture = createOriginalUmpCapture(), rows = [], source = event([0x41420203, 0xffffffff]); delete source.beat;
    source.controllerSequence = 19; source.baselineRevision = 3;
    capture.record(source, route, row => rows.push(row));
    expect(rows[0]).to.include({ beat: null, timeDomain: 'unmapped', timingUncertainty: 'source-clock-unmapped', controllerSequence: 19, baselineRevision: 3 });
    expect(rows[0].umpWords[1]).to.equal(0xffffffff); expect(capture.state()).to.include({ complete: false, unmappedTimes: 1, reason: 'source-clock-unmapped' }); capture.dispose();
  });
  it('refuses invalid/truncated packets and oversized identities without silently truncating them', () => {
    for (const original of [event([0x40000000]), { ...event(), intentId: 'x'.repeat(257) }, { ...event(), sourceEventIds: Array(33).fill('a') },
      { ...event(), sourceEventIds: Array(32).fill('a'.repeat(256)) }, { ...event(), baselineRevision: NaN }]) {
      const capture = createOriginalUmpCapture(); let called = false;
      expect(capture.record(original, route, () => { called = true; })).to.equal(false); expect(called).to.equal(false);
      expect(capture.state()).to.include({ recorded: 0, dropped: 1, complete: false }); capture.dispose();
    }
  });
  it('bounds record count and rolls back refused append ownership', () => {
    let reserved = 0;
    const budget = { reserve: ({ bytes }) => { reserved = bytes; }, release: () => { reserved = 0; } };
    const capture = createOriginalUmpCapture({ resourceBudget: budget, maximumRecords: 1 });
    expect(capture.record(event(), route, () => false)).to.equal(false); expect(reserved).to.equal(4096);
    expect(capture.record(event(), route, () => true)).to.equal(true); expect(capture.record(event(), route, () => true)).to.equal(false);
    expect(capture.state()).to.include({ recorded: 1, dropped: 2, complete: false }); capture.clear(); expect(reserved).to.equal(0); expect(capture.state().complete).to.equal(true); capture.dispose();
  });
  it('treats resource or append failure as a refused capture without throwing into musical delivery', () => {
    const denied = createOriginalUmpCapture({ resourceBudget: { reserve() { throw Object.assign(new Error('full'), { name: 'ResourceBudgetError' }); }, release() {} } });
    expect(denied.record(event(), route, () => true)).to.equal(false); expect(denied.state().reason).to.equal('original-ump-resource-capacity'); denied.dispose();
    const refused = createOriginalUmpCapture(); expect(refused.record(event(), route, () => { throw new Error('index unavailable'); })).to.equal(false);
    expect(refused.state().reason).to.equal('recording-source-append-failed'); refused.dispose();
  });
  it('keeps unknown retirement charged and never resumes its failed owner', () => {
    const capture = createOriginalUmpCapture({ resourceBudget: { reserve() {}, release: () => false } });
    capture.record(event(), route, () => true); expect(() => capture.clear()).to.throw('acknowledge');
    expect(capture.state().reservation.state).to.equal('failed-or-unknown'); expect(capture.record(event(), route, () => true)).to.equal(false);
    expect(() => capture.dispose()).to.throw(); expect(capture.record(event(), route, () => true)).to.equal(false);
  });
  it('captures rejected high-resolution intent once and excludes it from MIDI1 snapshot/export columns', async () => {
    const ports = createProcgenMidiPorts({ now: () => 1000 });
    try {
      ports.configure({ recording: true });
      const original = event(); expect(ports.sendEvent(original)).to.equal(false);
      const rows = ports.getRecording({ protocol: 'ump' }); expect(rows).to.have.length(1); expect(rows[0].umpWords).to.deep.equal(original.umpWords);
      expect(ports.getRecording({ protocol: 'midi1' })).to.have.length(0); expect(ports.getState().originalUmp).to.include({ recorded: 1, complete: true });
      const source = ports.createRecordingExportSource(); const columns = await source.prepareInput();
      expect(Array.from(columns.messages)).to.deep.equal([0, 0, 0, 0, 4]); expect(columns.outputIds).to.deep.equal([]); source.release();
      let error; try { await encodeRecordedMidi({ snapshot: columns, window: { recordingComplete: true } }, { estimatedPeakBytes: recordingExportPeakBytes(columns.count) }); } catch (caught) { error = caught; }
      expect(error).to.have.property('code', 'original-ump-needs-lowering');
      expect(() => exportProcgenMidi(rows)).to.throw('explicit MIDI1 lowering');
      ports.recordEvent({ type: 'cc', controller: 74, value: 100, beat: 8, timestamp: 1000 });
      const mixedSource = ports.createRecordingExportSource(), mixed = await mixedSource.prepareInput();
      const encoded = await encodeRecordedMidi({ snapshot: mixed, window: { recordingComplete: true } }, { estimatedPeakBytes: recordingExportPeakBytes(mixed.count) });
      expect(encoded.manifest.excludedOriginalUmpIntents).to.equal(1); expect(encoded.manifest.evidence).to.equal('intent-render');
      expect(parseSmf(encoded.bytes).filter(row => row.status === 0xb0)).to.have.length(1); mixedSource.release();
      ports.clearRecording(); expect(ports.getState().originalUmp.recorded).to.equal(0);
    } finally { ports.dispose(); }
  });
  it('keeps direct compatibility balancing inside known connection and route boundaries', () => {
    const records = [{ outputId: 'A', connectionEpoch: 7, routeRevision: 1, data: [0x90, 60, 100] },
      { outputId: 'A', connectionEpoch: 8, routeRevision: 1, data: [0x80, 60, 0] }];
    expect(selectBalancedProcgenRecording(records)).to.include({ omittedOnsets: 1, omittedReleases: 1 });
    expect(selectBalancedProcgenRecording(records).events).to.have.length(0);
  });
  it('fences nested append, clear and disposal until the original capture is quiescent', () => {
    const capture = createOriginalUmpCapture({ maximumRecords: 1 });
    expect(capture.record(event(), route, () => {
      expect(capture.state().pending).to.equal(true); expect(capture.record(event(), route, () => true)).to.equal(false);
      expect(() => capture.clear()).to.throw('quiescent'); expect(() => capture.dispose()).to.throw('quiescent'); return true;
    })).to.equal(true);
    expect(capture.state()).to.include({ recorded: 1, dropped: 1, pending: false, complete: false }); capture.clear(); expect(capture.state().recorded).to.equal(0); capture.dispose();
  });
  it('publishes an original packet observer only after its ownership counters commit', () => {
    let ports, observed;
    ports = createProcgenMidiPorts({ now: () => 1000, onRecord: row => {
      if (row.type !== 'umpIntent') return; observed = ports.getState().originalUmp;
      ports.clearRecording();
    } });
    try {
      ports.configure({ recording: true }); ports.sendEvent(event());
      expect(observed).to.include({ recorded: 1, pending: false }); expect(ports.getRecording()).to.have.length(0);
      expect(ports.getState().originalUmp).to.include({ recorded: 0, retainedEstimateBytes: 0, pending: false });
    } finally { ports.dispose(); }
  });
  it('publishes recording pressure only after the original ownership boundary is quiescent', () => {
    const observed = [];
    const ports = createProcgenMidiPorts({ now: () => 1000, maxRecordedEvents: 1, onState: state => { if (state.recordedEvents) observed.push(state.originalUmp); } });
    try {
      ports.configure({ recording: true }); ports.sendEvent(event());
      expect(observed.length).to.be.greaterThan(0); expect(observed.every(state => state.recorded === 1 && state.pending === false)).to.equal(true);
    } finally { ports.dispose(); }
  });
  it('allows an original packet observer to retire the ports without reviving capture ownership', () => {
    let ports;
    ports = createProcgenMidiPorts({ now: () => 1000, onRecord: row => { if (row.type === 'umpIntent') ports.dispose(); } });
    ports.configure({ recording: true }); ports.sendEvent(event());
    expect(ports.getState().originalUmp.reservation).to.equal(null); expect(ports.getState().originalUmp.pending).to.equal(false);
    expect(ports.sendEvent(event())).to.equal(false);
  });
  for (const change of ['none', 'replace-output', 'replace-policy', 'mutate-caller', 'panic', 'flush']) it('pins original delivery across observer action ' + change, () => {
    let ports;
    const messages = [], timestamps = [], original = event([0x40903c00, 0x80000000]), next = { id: 'B', state: 'connected', send: (data, timestamp) => { messages.push(['B', ...data]); timestamps.push(timestamp); return true; } };
    ports = createProcgenMidiPorts({ now: () => 1000, onRecord: row => {
      if (row.type !== 'umpIntent') return;
      if (change === 'replace-output') ports.setNoteOutput(next);
      if (change === 'replace-policy') ports.configure({ protocolLowering: { groupMap: { 0: 'preserve' } } });
      if (change === 'mutate-caller') { original.umpWords[1] = 0xffff0000; original.timestamp = 9000; original.outputId = 'B'; }
      if (change === 'panic') ports.panic(); if (change === 'flush') ports.flush();
    } });
    try {
      ports.setNoteOutput({ id: 'A', state: 'connected', send: (data, timestamp) => { messages.push(['A', ...data]); timestamps.push(timestamp); return true; } });
      ports.configure({ schedulerConfig: { mpe: { enabled: false } }, protocolLowering: { groupMap: { 0: 'preserve' } }, recording: true });
      const expected = change === 'none' || change === 'mutate-caller'; expect(ports.sendEvent(original)).to.equal(expected);
      expect(messages).to.deep.equal(expected ? [['A', 0x90, 60, 64]] : []);
      expect(timestamps).to.deep.equal(expected ? [4000] : []);
      expect(ports.getRecording({ protocol: 'ump' })[0].umpWords).to.deep.equal([0x40903c00, 0x80000000]);
    } finally { ports.dispose(); }
  });
  it('keeps original metadata charged while a retained source survives clear or disposal', async () => {
    const held = new Map(), budget = { reserve: entry => held.set(entry.token, entry), release: entry => held.delete(entry.token) };
    const charged = () => [...held.values()].filter(entry => entry.kind === 'original-ump-recording-metadata-estimate').reduce((sum, entry) => sum + entry.bytes, 0);
    const ports = createProcgenMidiPorts({ now: () => 1000, resourceBudget: budget, maxRecordedEvents: 8 });
    ports.configure({ recording: true }); ports.sendEvent(event()); const first = ports.createRecordingExportSource();
    ports.clearRecording(); expect(first.isCurrent()).to.equal(false); expect(charged()).to.be.greaterThan(0); first.release(); expect(charged()).to.equal(0);
    ports.sendEvent(event()); const second = ports.createRecordingExportSource(); ports.dispose();
    expect(ports.getRecording()).to.have.length(0); expect(charged()).to.be.greaterThan(0); second.release(); expect(charged()).to.equal(0);
    expect(held.size).to.equal(0);
  });
  it('defers early source release until its snapshot producer has actually settled', async () => {
    const held = new Map(), budget = { reserve: entry => held.set(entry.token, entry), release: entry => held.delete(entry.token) };
    const ports = createProcgenMidiPorts({ now: () => 1000, resourceBudget: budget, maxRecordedEvents: 8 });
    ports.configure({ recording: true }); ports.sendEvent(event()); const source = ports.createRecordingExportSource(), preparing = source.prepareInput();
    ports.clearRecording(); expect(source.release()).to.equal(false);
    expect([...held.values()].some(entry => entry.kind === 'original-ump-recording-metadata-estimate')).to.equal(true);
    let error; try { await preparing; } catch (caught) { error = caught; } expect(error.message).to.include('changed');
    expect([...held.values()].some(entry => entry.kind === 'original-ump-recording-metadata-estimate')).to.equal(false); ports.dispose(); expect(held.size).to.equal(0);
  });
  it('bounds retained source leases and retires their budget only after the last acknowledgement', () => {
    let charged = 0; const capture = createOriginalUmpCapture({ resourceBudget: { reserve: entry => { charged = entry.bytes; }, release: () => { charged = 0; } } });
    capture.record(event(), route, () => true); const leases = Array.from({ length: 32 }, () => capture.retain());
    expect(() => capture.retain()).to.throw('retention'); expect(() => capture.clear()).to.throw('quiescent'); capture.dispose(); expect(charged).to.be.greaterThan(0);
    leases.slice(0, -1).forEach(lease => lease.release()); expect(charged).to.be.greaterThan(0); leases.at(-1).release(); expect(charged).to.equal(0);
    expect(leases.at(-1).release()).to.equal(false);
  });
});
