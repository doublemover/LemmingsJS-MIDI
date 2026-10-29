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
});
