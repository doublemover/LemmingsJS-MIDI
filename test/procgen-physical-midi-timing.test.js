import { expect } from 'chai';
import { exportPhysicalProcgenMidi, exportProcgenMidi } from '../js/app/procgen/workstation/ProcgenMidiExport.js';
import { createProcgenPhysicalScoreClock } from '../js/app/procgen/workstation/ProcgenPhysicalScoreClock.js';
import { createCausalMusicEngine } from '../js/app/procgen/workstation/CausalMusicEngine.js';
import { parseSmf } from './support/smf.js';

const fixture = ({ lastTick = 30, duration = null } = {}) => {
  const clock = createProcgenPhysicalScoreClock(); let sourceTimeMs = 0;
  for (let tick = 1; tick <= lastTick; tick++) {
    const tickDurationMs = duration ?? (tick <= 10 ? 60 : 30); sourceTimeMs += tickDurationMs;
    clock.observe({ version: 1, worldId: 'source', generation: 1, tick, sourceTimeMs, tickDurationMs }, { bpm: tick < 20 ? 120 : 240 });
  }
  const epoch = clock.snapshot().timeline.currentEpoch, time = (simTick, subTick = 0) => ({ epoch, simTick, subTick, precision: subTick ? 'interpolated' : 'tick' });
  const source = { version: 1, domain: 'simulation-tick', clock: structuredClone(clock.snapshot()), origin: time(10), end: time(lastTick) };
  const event = (tick, causalSequence, overrides = {}) => ({ type: causalSequence % 2 ? 'noteOn' : 'noteOff', channel: 1, note: 60, velocity: 100,
    worldId: 'source', causalSequence, scoreTime: time(tick), ...overrides });
  return { clock, source, time, event };
};
const notes = bytes => parseSmf(bytes).filter(event => event.status < 0xf0);

describe('captured physical time MIDI export', () => {
  it('lowers captured speed/tempo segments from an explicit crop instead of a current transport BPM', () => {
    const f = fixture(), events = [f.event(10, 1), f.event(12, 2), f.event(24, 3), f.event(30, 4)];
    const before = JSON.stringify({ events, source: f.source }), result = exportPhysicalProcgenMidi(events, f.source, { bpm: 17 });
    expect(notes(result.bytes).map(event => event.tick)).to.deep.equal([0, 86, 547, 893]);
    const tempos = parseSmf(result.bytes).filter(event => event.type === 0x51);
    expect(tempos.map(event => [event.tick, event.data])).to.deep.equal([[0, [7, 161, 32]], [317, [3, 208, 144]]]);
    expect(parseSmf(result.bytes).at(-1)).to.include({ type: 0x2f, tick: 893 });
    expect(result.report).to.include({ mode: 'source-score', tempoChanges: 1, eventCount: 4, liveLatenessApplied: false });
    expect(result.report.quantization.maximumBeatError).to.be.closeTo(0.000833333333333, 1e-12);
    expect(result.report.quantization.maximumTimingErrorMs).to.be.closeTo(0.416666666666, 1e-9);
    expect(Object.isFrozen(result.report.quantization)).to.equal(true);
    expect(JSON.stringify({ events, source: f.source })).to.equal(before);
    expect(exportProcgenMidi(events, { sourceTime: f.source, bpm: 400 })).to.deep.equal(result.bytes);
    const embedded = parseSmf(result.bytes).find(event => event.type === 1);
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(embedded.data))).physicalTiming).to.deep.equal(result.report);
  });
  it('preserves canonical release/update/retrigger order when distinct source times quantize together', () => {
    const f = fixture(), events = [f.event(10, 1), f.event(10, 2, { scoreTime: f.time(10, 0.0001) }),
      f.event(10, 3, { type: 'cc', controller: 74, value: 91, scoreTime: f.time(10, 0.0002) }),
      f.event(10, 4, { type: 'noteOn', scoreTime: f.time(10, 0.0003) })];
    const result = exportPhysicalProcgenMidi(events, f.source);
    expect(notes(result.bytes).map(event => [event.tick, event.status])).to.deep.equal([[0, 0x90], [0, 0x80], [0, 0xb0], [0, 0x90]]);
    expect(result.report.quantization.collapsedDistinctTimes).to.equal(3);
  });
  it('keeps long leading and trailing silence and accepts a completely silent selected source range', () => {
    const f = fixture({ lastTick: 1000, duration: 60000 }); f.source.origin = f.time(0);
    const result = exportPhysicalProcgenMidi([f.event(900, 1), f.event(901, 2)], f.source);
    expect(notes(result.bytes)[0].tick).to.be.greaterThan(1000000);
    expect(parseSmf(result.bytes).at(-1).tick).to.equal(result.report.endTick);
    expect(parseSmf(exportPhysicalProcgenMidi([], f.source).bytes).at(-1).tick).to.equal(result.report.endTick);
  });
  it('rejects a long silence exceeding the SMF delta limit without compressing or retiming it', () => {
    const f = fixture({ lastTick: 10000, duration: 60000 }); f.source.origin = f.time(0);
    expect(() => exportPhysicalProcgenMidi([f.event(9999, 1)], f.source)).to.throw('four-byte SMF');
  });
  it('reports accumulated SMF tempo precision loss even when beat positions quantize exactly', () => {
    const clock = createProcgenPhysicalScoreClock();
    for (const tick of [1, 10000]) clock.observe({ version: 1, worldId: 'tempo', generation: 1, tick, sourceTimeMs: tick * 60, tickDurationMs: 60 }, { bpm: 123 });
    const epoch = clock.snapshot().timeline.currentEpoch, time = simTick => ({ epoch, simTick });
    const result = exportPhysicalProcgenMidi([], { version: 1, domain: 'simulation-tick', clock: clock.snapshot(), origin: time(0), end: time(10000) });
    expect(result.report.quantization.maximumBeatError).to.equal(0);
    expect(result.report.quantization.maximumTimingErrorMs).to.be.closeTo(0.15, 1e-7);
  });
  for (const [label, change, message] of [
    ['unknown domain', f => { f.source.domain = 'performance-ms'; }, 'typed physical'],
    ['missing clock', f => { delete f.source.clock; }, 'checkpoint'],
    ['missing origin', f => { delete f.source.origin; }, 'epoch'],
    ['unknown epoch', f => { f.source.origin.epoch = f.source.end.epoch = 'missing'; }, 'epoch'],
    ['cross epoch', f => { f.source.end.epoch = 'another'; }, 'epoch'],
    ['uncovered end', f => { f.source.end.simTick = 31; }, 'boundary'],
    ['fraction past end', f => { f.source.end.subTick = 0.5; }, 'boundary'],
    ['backward crop', f => { f.source.origin.simTick = 25; f.source.end.simTick = 20; }, 'crop'],
    ['uncovered initial origin', f => { f.source.origin.simTick = -1; }, 'boundary'],
    ['invalid segment', f => { f.source.clock.timeline.epochs[0].segments[0].tempoBpm = NaN; }, 'segment']
  ]) it('rejects ' + label, () => { const f = fixture(); change(f); expect(() => exportPhysicalProcgenMidi([], f.source)).to.throw(message); });
  for (const [label, change, message] of [
    ['missing time', e => { delete e.scoreTime; }, 'boundary'],
    ['foreign world', e => { e.worldId = 'other'; }, 'world'],
    ['missing causal sequence', e => { delete e.causalSequence; }, 'sequence'],
    ['outside crop', e => { e.scoreTime.simTick = 9; }, 'crop'],
    ['nonfinite subtick', e => { e.scoreTime.subTick = NaN; }, 'simulation'],
    ['stale nested beat', e => { e.scoreTime.beat = 99; }, 'disagrees'],
    ['stale legacy beat', e => { e.beat = 99; }, 'disagrees'],
    ['caller tempo substitution', e => { e.type = 'tempo'; e.bpm = 17; }, 'sequence'],
    ['unsupported message', e => { e.type = 'missing'; }, 'representation']
  ]) it('rejects ' + label, () => { const f = fixture(), event = f.event(12, 1); change(event); expect(() => exportPhysicalProcgenMidi([event], f.source)).to.throw(message); });
  it('retains independent projected voices from one physical cause in canonical input order', () => {
    const f = fixture(), result = exportPhysicalProcgenMidi([f.event(12, 1), f.event(12, 1, { note: 64 })], f.source);
    expect(notes(result.bytes).map(event => [event.tick, event.data[0]])).to.deep.equal([[86, 60], [86, 64]]);
    expect(result.report.quantization.collapsedDistinctTimes).to.equal(0);
  });
  it('rejects decreasing causal order and interpolated time inversion before any global sorting', () => {
    const f = fixture();
    expect(() => exportPhysicalProcgenMidi([f.event(12, 2), f.event(13, 1)], f.source)).to.throw('sequence');
    expect(() => exportPhysicalProcgenMidi([f.event(12, 1), f.event(11, 2)], f.source)).to.throw('causality');
    expect(() => exportPhysicalProcgenMidi([f.event(12, 1, { scoreTime: f.time(12, 0.5) }), f.event(12, 2)], f.source)).to.throw('causality');
  });
  it('selects an explicit captured generation epoch without flattening reset score origins', () => {
    const f = fixture(); f.clock.observe({ version: 1, worldId: 'source', generation: 2, tick: 30, sourceTimeMs: 1200, tickDurationMs: 30 }, { bpm: 120 });
    f.clock.observe({ version: 1, worldId: 'source', generation: 2, tick: 31, sourceTimeMs: 1230, tickDurationMs: 30 }, { bpm: 120 });
    f.source.clock = f.clock.snapshot();
    expect(exportPhysicalProcgenMidi([f.event(12, 1)], f.source).report.epoch).to.equal(f.source.origin.epoch);
    const epoch = f.clock.snapshot().timeline.currentEpoch; f.source.origin = { epoch, simTick: 30 }; f.source.end = { epoch, simTick: 31 };
    expect(() => exportPhysicalProcgenMidi([f.event(30, 1)], f.source)).to.throw('boundary');
    const event = f.event(30, 1, { scoreTime: { epoch, simTick: 30 } });
    expect(notes(exportPhysicalProcgenMidi([event], f.source).bytes)[0].tick).to.equal(0);
  });
  it('exports committed engine events identically across catch-up groups and unrelated host-arrival gaps', () => {
    const run = batchSize => {
      const clock = createProcgenPhysicalScoreClock(), graph = { version: 1, revision: 1, instruments: [{ id: 'wall', sourceKind: 'ContactResolved', causeKind: 'wall', pitchCents: 6000, velocity01: 0.5, route: 'local', role: 'percussion' }] };
      const engine = createCausalMusicEngine({ getGraph: () => graph, scoreTimeline: clock }), events = [];
      for (let start = 1; start <= 20; start += batchSize) for (let tick = start; tick < start + batchSize && tick <= 20; tick++) {
        const batch = { version: 1, worldId: 'source', generation: 1, tick, batchId: 'batch:' + tick, sourceTimeMs: tick * 60, tickDurationMs: 60,
          completeness: { status: 'complete', dropped: 0 }, facts: [10, 12].includes(tick) ? [{ causalSequence: tick, eventId: 'event:' + tick, kind: 'ContactResolved', actorId: tick, causeKind: 'wall', precision: 'tick', subTick: 0 }] : [] };
        clock.observe(batch, { bpm: 120 });
        for (const intent of engine.processBatch(batch)) if (intent.kind === 'begin') events.push({ type: 'noteOn', note: intent.pitch.cents / 100, velocity: Math.round(intent.velocity01 * 127), worldId: intent.worldId,
          causalSequence: intent.causalSequence, scoreTime: intent.scoreTime, timestamp: tick > 10 ? 5000 : 0 });
      }
      const epoch = clock.snapshot().timeline.currentEpoch;
      return exportPhysicalProcgenMidi(events, { version: 1, domain: 'simulation-tick', clock: clock.snapshot(), origin: { epoch, simTick: 0 }, end: { epoch, simTick: 20 } });
    };
    const single = run(1); expect(notes(single.bytes).map(event => event.tick)).to.deep.equal([576, 691]);
    expect(run(4).bytes).to.deep.equal(single.bytes); expect(run(10).bytes).to.deep.equal(single.bytes);
  });
});
