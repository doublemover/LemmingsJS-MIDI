import { expect } from 'chai';
import JZZ from 'jzz';
import installSmf from 'jzz-midi-smf';
import { createHash } from 'node:crypto';
import { snapshotOriginalUmpRecording, planOriginalUmpClip, originalUmpExportPeakBytes } from '../js/app/procgen/workstation/OriginalUmpRecordingSnapshot.js';
import { encodeRecordedUmpClip } from '../js/app/procgen/workstation/RecordedUmpClipExport.js';
import { decodeMidiClipFile } from '../js/midi/protocol/MidiClipFile.js';
import { createProcgenMidiPorts } from '../js/app/procgen/workstation/ProcgenMidiPorts.js';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';
import { createTestBackgroundJobs } from './helpers/background-worker.js';
installSmf(JZZ);

const fast = { yieldControl: async () => {} }, window = { recordingComplete: true, originalComplete: true, incompleteReasons: [] };
const tempo = (beat = 8, bpm = 120) => ({ type: 'tempo', beat, bpm });
const packet = (words, beat, extra = {}) => ({ type: 'umpIntent', publication: 'authored-not-submitted', timeDomain: 'recorded-score-beat',
  umpWords: words, beat, outputId: 'A', connectionEpoch: 1, routeRevision: 1, intentId: 12, ...extra });
const records = () => [tempo(), packet([0x4f923c00, 0x12340000], 8), packet([0x4f923c00, 0x12340000], 8, { actorId: 'second' }),
  tempo(8.5, 90), packet([0x4f623c00, 0x89abcdef], 8.75), packet([0x4f823c00, 0xabcd0000], 9)];
const snapshot = source => snapshotOriginalUmpRecording({ records: source, count: source.length, isCurrent: () => true, yieldTask: async () => {} });
const encode = async (source, options = {}, coverage = window) => {
  const value = await snapshot(source);
  return encodeRecordedUmpClip({ snapshot: value, options: { sourceLayer: 'authored-intent', tempoSource: 'captured-transport', placement: 'rebase-recording-start', ...options }, window: coverage },
    { ...fast, estimatedPeakBytes: originalUmpExportPeakBytes(value.metadataBytes) });
};
const rejects = async (work, text) => { let error; try { await work; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); if (text) expect(error.message).to.include(text); return error; };

describe('original recorded UMP Clip projection', () => {
  it('roundtrips through an independent reader with exact unisons, groups, release velocity and tempo; attribution stays external', async () => {
    const result = await encode(records()), independent = new JZZ.MIDI.Clip(String.fromCharCode(...result.bytes));
    const manifest = JSON.parse(new TextDecoder().decode(result.manifestBytes));
    expect(manifest.clipSha256).to.equal(createHash('sha256').update(result.bytes).digest('hex')); expect(manifest.clipBytes).to.equal(result.bytes.length);
    expect(independent.ppqn).to.equal(960);
    const raw = Array.from(independent).filter(message => message[0] >> 4 === 4);
    expect(raw.map(message => Array.from(message))).to.deep.equal(records().filter(row => row.type === 'umpIntent').map(row => row.umpWords.flatMap(word => [word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255])));
    expect(raw.map(message => message.tt)).to.deep.equal([0, 0, 720, 960]);
    expect(manifest.attribution[0].attribution.intentId).to.equal(12); expect(manifest.attribution[1].attribution.actorId).to.equal('second');
    expect(manifest.derivedTempoPackets).to.equal(2); expect(manifest.exportPlan.initialTempo.bpm).to.equal(120);
    expect(manifest.noteBoundaryCoverage).to.include('unverified'); expect(manifest.setupDisposition).to.equal('data-only-never-submitted');
    expect(new TextDecoder().decode(result.bytes)).not.to.include('second');
    expect((await encode(records())).bytes).to.deep.equal(result.bytes); expect((await encode(records())).manifestBytes).to.deep.equal(result.manifestBytes);
  });
  it('chooses one connection epoch instead of concatenating colliding endpoint groups', async () => {
    const source = [...records(), packet([0x4f923c00, 0xffff0000], 10, { connectionEpoch: 2, routeRevision: 3 })], value = await snapshot(source);
    const error = await rejects(Promise.resolve().then(() => planOriginalUmpClip(value, { tempoSource: 'captured-transport' })), 'Choose one recorded output');
    expect(error.routes.map(route => [route.connectionEpoch, route.routeRevision])).to.deep.equal([[1, 1], [2, 3]]);
    const result = await encode(source, { outputRouteIndex: 1 });
    expect(result.report.originalPackets).to.equal(1); expect(result.report.exportPlan.excludedRouteMessages).to.equal(4);
    expect(result.report.outputIdentity).to.deep.equal({ outputId: 'A', connectionEpoch: 2, routeRevision: 3 });
  });
  it('independently rebuilds route counts and the recording origin in the worker', async () => {
    const value = await snapshot(records()); value.routeCounts.fill(0); value.firstTempoBeat = 999;
    const result = await encodeRecordedUmpClip({ snapshot: value, window, options: { tempoSource: 'captured-transport', placement: 'rebase-recording-start' } }, { ...fast, estimatedPeakBytes: originalUmpExportPeakBytes(value.metadataBytes) });
    expect(result.report.originalPackets).to.equal(4); expect(result.report.exportPlan.originBeat).to.equal(8);
    expect(result.report.exportPlan.initialTempo.bpm).to.equal(120);
  });
  it('requires authored source selection and rejects unmapped clocks and backwards score segments', async () => {
    await rejects(encode(records(), { sourceLayer: 'api-accepted' }), 'authored intent only');
    await rejects(encode([tempo(), packet([0x40903c00, 0x80000000], null)]), 'explicitly mapped');
    await rejects(encode([...records(), packet([0x40903c00, 0x80000000], 0)]), 'moved backwards');
    await rejects(encode(records(), { tempoSource: 'current-ui' }), 'Choose captured');
  });
  it('keeps original Flex tempo and refuses an overlay or a missing origin tempo', async () => {
    const source = [tempo(), packet([0xd0100000, 50000000, 0, 0], 8), packet([0x40903c00, 0x80000000], 9)];
    await rejects(encode(source), 'Select original Flex tempo');
    const result = await encode(source, { tempoSource: 'original-flex' }), decoded = await decodeMidiClipFile(result.bytes, { ...fast, estimatedPeakBytes: 64 * 1048576 });
    expect(Array.from(decoded.sequence.words)).to.deep.equal(source.slice(1).flatMap(row => row.umpWords)); expect(decoded.configuration.ticks.length).to.equal(0);
    expect(result.report.derivedTempoPackets).to.equal(0);
    await rejects(encode(source, { tempoSource: 'original-flex', placement: 'retained-absolute-beat' }), 'at the selected Clip origin');
    await rejects(encode([packet([0x40903c00, 0x80000000], 0)], { placement: 'retained-absolute-beat' }), 'transport tempo is unavailable');
  });
  it('reports quantization and partial capture without inventing releases or a closed note lifecycle', async () => {
    const result = await encode([tempo(), packet([0x40903c00, 0x80000000], 8 + 1 / 2000, { sourceEventIds: ['source-1'], baselineRevision: 7 })], {},
      { ...window, originalComplete: false, originalReason: 'original-ump-record-capacity', originalDropped: 3 });
    expect(result.report.complete).to.equal(false); expect(result.report.originalPackets).to.equal(1); expect(result.report.quantization.quantizedEvents).to.equal(1);
    expect(result.report.quantization.maximumBeatError).to.be.lessThan(1 / 1920);
    expect(result.report.coverage.originalDropped).to.equal(3);
    expect(JSON.parse(new TextDecoder().decode(result.manifestBytes)).attribution[0].attribution.sourceEventIds).to.deep.equal(['source-1']);
  });
  it('rejects malformed words, forged attribution estimates, invalid epochs, resource limits and PPQ', async () => {
    for (const mutate of [value => { value.words[0] = 0; }, value => { value.metadataBytes--; }, value => { value.outputEpochs[0] = -2; },
      value => { value.attribution[0].extra = 'unbounded'; }, value => { value.sourceIndices[0] = value.tempoIndices[0]; }, value => { value.outputIds = new Array(4097).fill('x'); }]) {
      const value = await snapshot(records()); mutate(value);
      await rejects(encodeRecordedUmpClip({ snapshot: value, window, options: { tempoSource: 'captured-transport' } }, { ...fast, estimatedPeakBytes: 128 * 1048576 }));
    }
    await rejects(encode(records(), { ppq: 0 }), 'bounded original'); await rejects(encode([tempo(8, 0.1), ...records().slice(1)]), 'cannot be represented');
    await rejects(Promise.resolve().then(() => originalUmpExportPeakBytes(32 * 1048576 + 1)), 'Invalid');
    const value = await snapshot(records());
    await rejects(encodeRecordedUmpClip({ snapshot: value, window, options: { tempoSource: 'captured-transport' } }, { ...fast, estimatedPeakBytes: 4096 }), 'admitted workspace');
  });
  it('never reconstructs originals from MIDI1 aliases and cancels a yielded snapshot before publication', async () => {
    const value = await snapshot([{ type: 'note', direction: 'output', evidence: 'api-accepted', sourceUmp: [0x40903c00, 0x80000000], beat: 0 }]); expect(value.count).to.equal(0);
    const controller = new AbortController(), source = Array.from({ length: 8192 }, (_, index) => packet([0x40b04a00, index], index / 960)); let turns = 0;
    await rejects(snapshotOriginalUmpRecording({ records: source, count: source.length, signal: controller.signal, isCurrent: () => true,
      yieldTask: async () => { turns++; controller.abort(new Error('snapshot replaced')); } }), 'snapshot replaced'); expect(turns).to.equal(1);
  });
  it('snapshots the actual retained ports source and transfers Clip plus sidecar under one admitted result owner', async () => {
    const clock = { beat: 8, bpm: 120 }, ports = createProcgenMidiPorts({ transport: { getState: () => clock }, now: () => 0 }), jobs = createTestBackgroundJobs();
    ports.configure({ recording: true }); ports.recordTempo(120, 8, 0); ports.sendEvent({ umpWords: [0x40903c00, 0x80000000], beat: 8, timestamp: 0, actorId: 'retained' }); ports.configure({ recording: false });
    const source = ports.createRecordingExportSource({ protocol: 'ump' }); let computed;
    try {
      computed = await jobs.compute({ kind: 'encode-recorded-ump-clip', ownerId: 'recorded-original', ownerEpoch: 1, sourceRevision: '1', inputBytes: source.inputBytes,
        estimatedPeakBytes: source.estimatedPeakBytes, retainInput: true, releasePreparedInput: source.release, isCurrent: source.isCurrent,
        prepareInput: async () => ({ snapshot: await source.prepareInput({ yieldTask: async () => {} }), window, options: { tempoSource: 'captured-transport', placement: 'rebase-recording-start' } }) });
      expect(computed.value.report.originalPackets).to.equal(1); expect(computed.value.manifestBytes).to.be.instanceOf(Uint8Array);
      expect(computed.receipt.outputTransport.ownedTransferredBytes).to.equal(computed.value.bytes.byteLength + computed.value.manifestBytes.byteLength);
      const retainedBytes = computed.value.manifestBytes; ports.clearRecording(); expect(() => computed.value).to.throw('no longer belongs');
      expect(JSON.parse(new TextDecoder().decode(retainedBytes)).attribution[0].attribution.actorId).to.equal('retained');
    } finally { computed?.release(); source.release(); ports.dispose(); jobs.dispose(); }
  });
  it('requires admitted workers for original projection and data-only import inspection', async () => {
    const jobs = createBackgroundJobService({ Worker: null });
    try { for (const kind of ['encode-recorded-ump-clip', 'inspect-midi-clip']) {
      const error = await rejects(jobs.compute({ kind, ownerId: 'clip', ownerEpoch: 1, sourceRevision: '1', inputBytes: 100, estimatedPeakBytes: 64 * 1048576, prepareInput: () => ({}) }));
      expect(error.code).to.equal('worker-required');
    } } finally { jobs.dispose(); }
  });
});
