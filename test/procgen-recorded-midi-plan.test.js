import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { planRecordedMidiExport } from '../js/app/procgen/workstation/RecordedMidiExportPlan.js';
import { snapshotMidiRecording, recordingExportPeakBytes } from '../js/app/procgen/workstation/MidiRecordingExportSnapshot.js';
import { encodeRecordedMidi } from '../js/app/procgen/workstation/RecordedMidiEncoding.js';
import { parseSmf } from './support/smf.js';

const windowState = { recordingComplete: true, incompleteReason: null, incompleteReasons: [], retainedRange: {}, firstLostSequence: null, droppedRecords: 0, droppedCategories: {} };
const take = () => {
  const message = (outputId, data, beat = 0, evidence = 'api-accepted', direction = 'output') => ({ outputId, data, beat, evidence, direction });
  return [message('private-A', [0xc0, 10]), message('private-B', [0xc0, 45]),
    message('private-A', [0x90, 60, 100], 1), message('private-A', [0x90, 60, 80], 1), message('private-B', [0x90, 60, 70], 1),
    message('private-A', [0x80, 60, 0], 2), message('private-A', [0x80, 60, 0], 2), message('private-B', [0x80, 60, 0], 2),
    message('local-preview', [0x90, 60, 100], 1, 'intent-render'), message('local-preview', [0x80, 60, 0], 2, 'intent-render'),
    message('input-device', [0x90, 60, 100], 1, 'api-accepted', 'input'), message('input-device', [0x80, 60, 0], 2, 'api-accepted', 'input')];
};
const snapshot = records => snapshotMidiRecording({ records, count: records.length, isCurrent: () => true, yieldTask: async () => {} });
const encode = (data, options = {}) => encodeRecordedMidi({ snapshot: data, window: windowState, options }, { estimatedPeakBytes: recordingExportPeakBytes(data.count), yieldControl: async () => {} });
const errorFrom = async promise => { try { await promise; } catch (error) { return error; } throw Error('Expected an explicit export refusal.'); };

describe('explicit recorded MIDI output plan', () => {
  it('requires one endpoint before writing conflicting channels and distinguishes source layers from input copies', async () => {
    const data = await snapshot(take());
    expect(Array.from(data.routeCounts)).to.deep.equal([5, 0, 3, 0, 0, 2]);
    const error = await errorFrom(encode(data)); expect(error.code).to.equal('midi-export-route-selection-required');
    expect(error.routes.map(route => route.outputId)).to.deep.equal(['private-A', 'private-B']); expect(error.evidence).to.equal('api-accepted');
    expect(Object.isFrozen(error.routes)).to.equal(true);
  });
  for (const [outputRouteId, program, onsets] of [['private-A', 10, 2], ['private-B', 45, 1]]) it('exports independent same-channel source ' + outputRouteId, async () => {
    const data = await snapshot(take()), before = structuredClone(data), result = await encode(data, { outputRouteId }), events = parseSmf(result.bytes);
    expect(events.filter(event => event.status === 0xc0).map(event => event.data[0])).to.deep.equal([program]);
    expect(events.filter(event => event.status === 0x90)).to.have.length(onsets); expect(events.filter(event => event.status === 0x80)).to.have.length(onsets);
    expect(events.filter(event => event.status === 0x90).every(event => event.tick === 480)).to.equal(true);
    expect(result.manifest.exportPlan).to.include({ sourceLayer: 'api-accepted', routeCount: 2, includedMessages: 1 + onsets * 2, excludedOtherLayerMessages: 2 });
    expect(result.manifest.exportPlan.selectedOutputHash).to.equal(createHash('sha256').update(JSON.stringify({ outputId: outputRouteId })).digest('hex'));
    const text = new TextDecoder().decode(result.bytes); for (const id of data.outputIds) expect(text).not.to.include(id);
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(events.find(event => event.type === 1).data)))).to.deep.equal(result.manifest);
    expect(data).to.deep.equal(before); expect((await encode(data, { outputRouteId })).bytes).to.deep.equal(result.bytes);
  });
  it('exports authored intent only under an explicit source-layer choice when submitted output exists', async () => {
    const result = await encode(await snapshot(take()), { sourceLayer: 'intent-render' });
    expect(result.manifest.evidence).to.equal('intent-render'); expect(result.manifest.exportPlan.excludedOtherLayerMessages).to.equal(8);
    expect(parseSmf(result.bytes).filter(event => event.status === 0x90)).to.have.length(1);
  });
  it('does not trust forged host-side route counts in the worker', async () => {
    const data = await snapshot(take()); data.routeCounts.fill(0);
    expect((await errorFrom(encode(data))).code).to.equal('midi-export-route-selection-required');
  });
  it('rejects absent or foreign source routes and unknown evidence policies', async () => {
    const data = await snapshot(take());
    for (const options of [{ outputRouteId: 'missing' }, { outputRouteId: 'local-preview' }, { sourceLayer: 'input' }]) expect(await errorFrom(encode(data, options))).to.be.instanceOf(RangeError);
    const planned = await snapshot(take().filter(event => event.evidence === 'intent-render'));
    expect(await errorFrom(encode(planned, { sourceLayer: 'api-accepted' }))).to.be.instanceOf(RangeError);
  });
  it('keeps explicit empty route identity distinct from unspecified output selection', async () => {
    const records = take().filter(event => event.direction === 'output' && event.evidence === 'api-accepted').map(event => ({ ...event, outputId: event.outputId === 'private-A' ? '' : event.outputId }));
    const data = await snapshot(records), result = await encode(data, { outputRouteId: '' });
    expect(result.manifest.exportPlan.selectedRouteOrdinal).to.equal(1); expect(parseSmf(result.bytes).filter(event => event.status === 0x90)).to.have.length(2);
  });
  it('retains canonical release before retrigger order and never pairs across endpoints', async () => {
    const records = [
      { outputId: 'A', data: [0x90, 60, 90], beat: 0 }, { outputId: 'B', data: [0x80, 60, 0], beat: 1 },
      { outputId: 'A', data: [0x80, 60, 0], beat: 1 }, { outputId: 'A', data: [0x90, 60, 70], beat: 1 }, { outputId: 'A', data: [0x80, 60, 0], beat: 2 }
    ].map(event => ({ ...event, direction: 'output', evidence: 'api-accepted' }));
    const data = await snapshot(records), result = await encode(data, { outputRouteId: 'A' });
    expect(parseSmf(result.bytes).filter(event => event.status < 0xf0).map(event => event.status)).to.deep.equal([0x90, 0x80, 0x90, 0x80]);
    const other = await encode(data, { outputRouteId: 'B' }); expect(other.manifest.omittedReleases).to.equal(1); expect(other.manifest.complete).to.equal(false);
  });
  it('validates the bounded route summary and permits a silent tempo-only take', async () => {
    const data = await snapshot([{ type: 'tempo', beat: 0, bpm: 120 }]); expect(planRecordedMidiExport(data).routeCount).to.equal(0);
    expect((await encode(data)).manifest.exportPlan.selectedOutputHash).to.equal(null);
    for (const invalid of [{ ...data, routeCounts: [] }, { ...data, outputIds: ['a', 'a'], routeCounts: new Uint32Array(4) }, { ...data, outputIds: [null], routeCounts: new Uint32Array(2) },
      { ...data, outputIds: ['a'], routeCounts: new Uint32Array([10, 0]) }])
      expect(() => planRecordedMidiExport(invalid)).to.throw('inventory');
  });
  it('derives initial tempo from the recorded boundary and reports an unobserved retained-position prefix', async () => {
    const records = [{ type: 'tempo', beat: 8, bpm: 90 }, { type: 'tempo', beat: 10, bpm: 180 },
      { direction: 'output', evidence: 'api-accepted', outputId: 'A', data: [0x90, 60, 100], beat: 9 },
      { direction: 'output', evidence: 'api-accepted', outputId: 'A', data: [0x80, 60, 0], beat: 11 }];
    const result = await encode(await snapshot(records), { bpm: 400 }), parsed = parseSmf(result.bytes);
    const tempos = parsed.filter(event => event.type === 0x51);
    expect(tempos.map(event => event.tick)).to.deep.equal([0, 3840, 4800]);
    expect(tempos[0].data.reduce((value, byte) => value * 256 + byte, 0)).to.equal(Math.round(60000000 / 90));
    expect(result.manifest.exportPlan.initialTempo).to.deep.equal({ source: 'captured-boundary', bpm: 90, firstCapturedBeat: 8, unobservedPrefixBeats: 8 });
    expect(parsed.filter(event => event.status === 0x90)[0].tick).to.equal(4320);
  });
  it('labels a caller-declared tempo when the provided trace has no captured tempo boundary', async () => {
    const result = await encode(await snapshot(take().filter(event => event.outputId === 'private-A')), { bpm: 90 });
    expect(result.manifest.exportPlan.initialTempo).to.deep.equal({ source: 'caller-declared', bpm: 90, firstCapturedBeat: null, unobservedPrefixBeats: null });
  });
  it('separates reused output IDs by actual connection epoch and route revision', async () => {
    const records = [7, 8].flatMap(connectionEpoch => [
      { data: [0x90, 60, 100], beat: 9 }, { data: [0x90, 60, 100], beat: 9 },
      { data: [0x80, 60, 0], beat: 11 }, { data: [0x80, 60, 0], beat: 11 }
    ].map(event => ({ ...event, outputId: 'same-device', connectionEpoch, routeRevision: connectionEpoch + 10, direction: 'output', evidence: 'api-accepted' })));
    const data = await snapshot(records); expect(data.outputIds).to.deep.equal(['same-device', 'same-device']);
    expect(Array.from(data.outputEpochs)).to.deep.equal([7, 17, 8, 18]);
    const ambiguous = await errorFrom(encode(data, { outputRouteId: 'same-device' }));
    expect(ambiguous.code).to.equal('midi-export-route-selection-required'); expect(ambiguous.routes).to.have.length(2);
    for (const outputRouteIndex of [0, 1]) {
      const result = await encode(data, { outputRouteIndex }), parsed = parseSmf(result.bytes);
      expect(result.manifest.exportPlan).to.include({ connectionEpoch: outputRouteIndex + 7, routeRevision: outputRouteIndex + 17, includedMessages: 4, excludedRouteMessages: 4 });
      expect(parsed.filter(event => event.status === 0x90)).to.have.length(2); expect(parsed.filter(event => event.status === 0x80)).to.have.length(2);
      expect(result.manifest.complete).to.equal(true);
    }
    const changedRevision = records.map((event, index) => ({ ...event, connectionEpoch: 7, routeRevision: index < 4 ? 17 : 18 }));
    expect((await snapshot(changedRevision)).outputIds).to.have.length(2);
  });
  it('does not pair held notes across known or unknown connection boundaries', async () => {
    const records = [{ data: [0x90, 60, 100], beat: 0, connectionEpoch: 7 }, { data: [0x80, 60, 0], beat: 1, connectionEpoch: 8 },
      { data: [0x80, 60, 0], beat: 1 }].map(event => ({ ...event, outputId: 'same-device', direction: 'output', evidence: 'api-accepted' }));
    const data = await snapshot(records); expect(data.outputIds).to.have.length(3);
    for (const outputRouteIndex of [0, 1, 2]) {
      const result = await encode(data, { outputRouteIndex }); expect(parseSmf(result.bytes).filter(event => event.status < 0xf0)).to.have.length(0);
      expect(result.manifest.complete).to.equal(false);
      if (outputRouteIndex === 2) expect(result.manifest.exportPlan).not.to.have.property('connectionEpoch');
    }
  });
  it('rebases only from the captured boundary while preserving relative silence and tempo history', async () => {
    const records = [{ type: 'tempo', beat: 8, bpm: 90 }, { type: 'tempo', beat: 10, bpm: 180 },
      { direction: 'output', evidence: 'api-accepted', outputId: 'A', data: [0x90, 60, 100], beat: 9 },
      { direction: 'output', evidence: 'api-accepted', outputId: 'A', data: [0x80, 60, 0], beat: 11 }];
    const data = await snapshot(records), before = structuredClone(data), result = await encode(data, { placement: 'rebase-recording-start', bpm: 400 });
    expect(data).to.deep.equal(before); expect(result.manifest.exportPlan).to.include({ placement: 'rebase-recording-start', originBeat: 8 });
    expect(result.manifest.exportPlan.initialTempo).to.deep.equal({ source: 'captured-boundary', bpm: 90, firstCapturedBeat: 8, unobservedPrefixBeats: 0 });
    expect(parseSmf(result.bytes).filter(event => event.type === 0x51).map(event => event.tick)).to.deep.equal([0, 0, 960]);
    expect(parseSmf(result.bytes).filter(event => event.status < 0xf0).map(event => event.tick)).to.deep.equal([480, 1440]);
    const absolute = await encode(data); expect(absolute.manifest.exportPlan.originBeat).to.equal(0);
    expect(parseSmf(absolute.bytes).find(event => event.status === 0x90).tick).to.equal(4320);
  });
  it('independently rejects forged origins, invalid epoch tables and unknown placement/selection', async () => {
    const data = await snapshot(take().filter(event => event.outputId === 'private-A')); data.firstTempoBeat = 7;
    expect(await errorFrom(encode(data, { placement: 'rebase-recording-start' }))).to.be.instanceOf(RangeError);
    for (const options of [{ placement: 'current-ui-beat' }, { outputRouteIndex: -1 }, { outputRouteIndex: 99 }, { outputRouteIndex: 0.5 }, { outputRouteId: 'missing', outputRouteIndex: 0 }])
      expect(await errorFrom(encode(data, options))).to.be.instanceOf(RangeError);
    const epochData = await snapshot(take().filter(event => event.outputId === 'private-A'));
    for (const outputEpochs of [[], new Float64Array(1), new Float64Array([NaN, 0]), new Float64Array([-2, 0]), new Float64Array([0.5, 0]), new Float64Array(new SharedArrayBuffer(16))])
      expect(() => planRecordedMidiExport({ ...epochData, outputEpochs })).to.throw('epoch inventory');
    const duplicate = { ...epochData, outputIds: ['A', 'A'], routeCounts: new Uint32Array([1, 0, 1, 0]), outputEpochs: new Float64Array([1, 2, 1, 2]) };
    expect(() => planRecordedMidiExport(duplicate)).to.throw('unique');
    for (const connectionEpoch of [-2, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1, '7'])
      expect(await errorFrom(snapshot([{ direction: 'output', evidence: 'api-accepted', outputId: 'A', data: [0xb0, 1, 1], beat: 0, connectionEpoch }]))).to.be.instanceOf(RangeError);
    const predates = await snapshot([{ type: 'tempo', beat: 8, bpm: 120 }, { direction: 'output', evidence: 'api-accepted', outputId: 'A', data: [0xb0, 1, 1], beat: 7 }]);
    expect(await errorFrom(encode(predates, { placement: 'rebase-recording-start' }))).to.be.instanceOf(RangeError);
  });
});
