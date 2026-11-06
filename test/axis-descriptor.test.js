import { expect } from 'chai';
import { createAxisDescriptor, axisBindingKey, projectAxisValue, convertAxisValue, formatAxisDescriptor, capturedScoreAxis, axisTickMarks, describeCapturedCoordinateSample } from '../js/app/procgen/workstation/AxisDescriptor.js';
const axis = extra => createAxisDescriptor({ domain: 'world-distance', origin: 128, extent: 480, authorityId: 'world:1', generation: 1, confidence: 'authoritative', ...extra });
const glyph = (value, epoch = null) => ({ axis: { status: 'known', value, epoch } });

describe('explicit display axes and captured history', () => {
  for (const [domain, unit] of [['world-distance', 'px'], ['simulation-time', 'ms'], ['musical-beat', 'quarters'], ['event-ordinal', 'events']]) it('names ' + domain + ' in its own units', () => {
    const value = axis({ domain }); expect(value.unit).to.equal(unit); expect(Object.isFrozen(value)).to.equal(true); expect(formatAxisDescriptor(value).compact).to.include(unit);
  });
  for (const patch of [{ domain: 'bpm' }, { origin: NaN }, { origin: Infinity }, { extent: 0 }, { extent: -1 }, { extent: Infinity }, { authorityId: '' }, { generation: -1 }, { epoch: 7 }, { revision: '' }, { confidence: 'acoustic-confirmed' }, { historical: 'yes' }, { paused: 'paused' }]) it('rejects malformed fields ' + JSON.stringify(patch), () => {
    expect(() => axis(patch)).to.throw(TypeError);
  });
  it('projects world coordinates without clamping away historical out-of-view positions', () => {
    const value = axis(); expect(projectAxisValue(value, 368)).to.include({ fraction: 0.5, outside: false }); expect(projectAxisValue(value, 8)).to.include({ value: 8, fraction: -0.25, outside: true });
    expect(projectAxisValue(value, NaN).status).to.equal('unavailable'); expect(projectAxisValue(axis({ confidence: 'unavailable' }), 128).status).to.equal('unavailable');
  });
  it('keeps a coordinate unchanged through camera pan/zoom on the same bound axis', () => {
    const first = axis(), moved = axis({ origin: 512, extent: 240 }); expect(axisBindingKey(first)).to.equal(axisBindingKey(moved)); expect(convertAxisValue(256, first, moved)).to.include({ value: 256, method: 'exact' });
    expect(projectAxisValue(first, 256).fraction).not.to.equal(projectAxisValue(moved, 256).fraction);
  });
  it('requires independently supplied conversion evidence bound to both exact identities', () => {
    const from = axis(), to = axis({ domain: 'musical-beat', authorityId: 'captured:clock', epoch: 'clock:7', origin: 0, extent: 4 });
    expect(convertAxisValue(200, from, to)).to.include({ status: 'unavailable', reason: 'verified-conversion-unavailable' });
    const receipt = { schema: 'verified-axis-conversion/v1', from: axisBindingKey(from), to: axisBindingKey(to), method: 'sampled', evidenceId: 'observed:pair:1', scale: 0.01, offset: -1 };
    expect(convertAxisValue(200, from, to, receipt)).to.include({ value: 1, method: 'sampled', evidenceId: 'observed:pair:1' });
    for (const changed of [axis({ generation: 2 }), axis({ authorityId: 'world:2' }), axis({ epoch: 'other' }), axis({ revision: '2' })]) expect(convertAxisValue(200, changed, to, receipt).status).to.equal('unavailable');
    expect(() => convertAxisValue(200, from, { ...to, unit: 'milliseconds' }, receipt)).to.throw(TypeError);
  });
  it('does not promote estimated displays to an exact cross-domain conversion or accept overflow', () => {
    const from = axis({ confidence: 'estimated' }), to = axis({ domain: 'musical-beat', authorityId: 'clock:1' });
    const receipt = { schema: 'verified-axis-conversion/v1', from: axisBindingKey(from), to: axisBindingKey(to), method: 'exact', evidenceId: 'correlation', scale: 1, offset: 0 };
    expect(convertAxisValue(128, from, to, receipt).reason).to.equal('estimated-axis-needs-sampled-conversion');
    expect(convertAxisValue(128, from, to, { ...receipt, method: 'sampled', scale: Number.MAX_SAFE_INTEGER }).reason).to.equal('axis-conversion-overflow');
    expect(formatAxisDescriptor(from).details).to.include('Estimated display; not a scheduled note');
  });
  for (const [timeDomain, domain] of [['physical-source-time', 'simulation-time'], ['causal-order', 'event-ordinal'], ['musical-score-time', 'musical-beat']]) it('retains captured ' + timeDomain + ' values independently of live view controls', () => {
    const result = capturedScoreAxis({ timeDomain, glyphs: [glyph(10, 'captured:1'), glyph(30, 'captured:1')], takeId: 'one', takeRevision: 2, generation: 7 });
    expect(result).to.include({ domain, origin: 10, extent: 20, confidence: 'captured', historical: true, epoch: 'captured:1', revision: '2', generation: 7 });
    expect(formatAxisDescriptor(result).details).to.include('Historical marks do not follow current tempo or camera');
  });
  it('reports missing or mixed-epoch score coordinates instead of fabricating one axis', () => {
    const input = { timeDomain: 'musical-score-time', takeId: 'one', takeRevision: 1, generation: 1 };
    for (const glyphs of [[], [{ axis: { status: 'unknown', value: null } }], [glyph(0, 'first'), glyph(0, 'second')]]) {
      const result = capturedScoreAxis({ ...input, glyphs }); expect(result.confidence).to.equal('unavailable'); expect(formatAxisDescriptor(result).compact).to.equal('Musical position · quarters unavailable'); expect(formatAxisDescriptor(result).compact).not.to.include('0–1');
    }
  });
  it('keeps a bounded tick ruler aligned to the same exact viewport and avoids fractional event ordinals', () => {
    const ticks = axisTickMarks(axis()); expect(ticks.map(value => value.value)).to.deep.equal([128, 248, 368, 488, 608]); expect(ticks.map(value => value.fraction)).to.deep.equal([0, 0.25, 0.5, 0.75, 1]); expect(ticks.every(value => Object.isFrozen(value))).to.equal(true);
    const ordinal = axisTickMarks(axis({ domain: 'event-ordinal', origin: 6, extent: 3 })); expect(ordinal.map(value => value.value)).to.deep.equal([6, 7, 8, 9]);
    expect(axisTickMarks(axis({ confidence: 'unavailable' }))).to.deep.equal([]); expect(() => axisTickMarks(axis(), 13)).to.throw(RangeError);
  });
  it('uses all aggregate coordinate extrema and refuses a mixed-epoch aggregate axis', () => {
    const input = { timeDomain: 'musical-score-time', takeId: 'one', takeRevision: 1, generation: 1 }, range = { minimum: 0.125, maximum: 4, known: 3, epoch: 'recorded:1', ambiguous: false };
    expect(capturedScoreAxis({ ...input, glyphs: [{ kind: 'aggregate', axisRange: range }] })).to.include({ origin: 0.125, extent: 3.875, confidence: 'captured' });
    expect(capturedScoreAxis({ ...input, glyphs: [{ kind: 'aggregate', axisRange: { ...range, ambiguous: true } }] }).confidence).to.equal('unavailable');
  });
  it('shows only the co-observed coordinates of the selected recorded cause', () => {
    const selected = { kind: 'source-event', source: { eventId: 'cause:7', causalSequence: 6, sourceTimeMs: 60, precision: 'tick' }, intents: [{ scoreTime: { beat: 0.375, epoch: 'score:1' } }] };
    const value = describeCapturedCoordinateSample(selected); expect(value).to.include({ sourceEventId: 'cause:7', method: 'sampled-at-recorded-cause' }); expect(value.text).to.include('Source time 60 milliseconds').and.include('Event order 6 causal-sequence').and.include('Musical position 0.375 beats').and.include('conversion between causes is unavailable'); expect(Object.isFrozen(value.readings[0])).to.equal(true);
    expect(describeCapturedCoordinateSample({ ...selected, intents: [...selected.intents, { scoreTime: { beat: 1, epoch: 'other' } }] }).text).to.include('Musical position unavailable');
    expect(describeCapturedCoordinateSample({ ...selected, intents: Array(1025).fill(selected.intents[0]) }).text).to.include('Musical position unavailable');
    expect(describeCapturedCoordinateSample({ kind: 'aggregate' }).method).to.equal('unavailable');
  });
  it('rejects incomplete or wrong-unit public descriptor consumers', () => {
    expect(() => projectAxisValue({ domain: 'world-distance' }, 1)).to.throw(TypeError); expect(() => formatAxisDescriptor({ ...axis(), unit: 'beats' })).to.throw(TypeError);
  });
});
