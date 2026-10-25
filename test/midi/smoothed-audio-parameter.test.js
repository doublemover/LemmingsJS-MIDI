import { expect } from 'chai';
import { createSmoothedAudioParameter } from '../../js/app/midi-ui/SmoothedAudioParameter.js';

const parameter = () => ({ events: [], setValueAtTime(value, time) { this.events.push({ kind: 'set', value, time }); },
  linearRampToValueAtTime(value, time) { this.events.push({ kind: 'ramp', value, time }); },
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); } });

describe('Smoothed audio parameters', () => {
  it('reports queued future commands even when the latest declared target is neutral', () => {
    const curve = createSmoothedAudioParameter({ param: parameter(), initialValue: 0, startTime: 0, smoothingSeconds: 0 }); expect(curve.hasFutureEvents(0)).to.equal(false);
    curve.insert(1, 1, 0); curve.insert(0, 2, 0); expect(curve.valueAt(0)).to.equal(0); expect(curve.hasFutureEvents(0)).to.equal(true); expect(curve.hasFutureEvents(1.5)).to.equal(true); expect(curve.hasFutureEvents(2)).to.equal(false);
  });
  it('retains independent authored per-event slew durations across shuffled future insertion', () => {
    const make = reverse => { const param = parameter(), curve = createSmoothedAudioParameter({ param, initialValue: 0, startTime: 0 });
      const changes = [[1, 1, 0, 2], [0, 2, 0, 0.5]]; for (const change of reverse ? changes.reverse() : changes) expect(curve.insert(...change)).to.equal(true);
      return curve; };
    const first = make(false), second = make(true);
    for (const time of [0, 1, 1.5, 2, 2.25, 2.5, 3]) expect(first.valueAt(time)).to.equal(second.valueAt(time));
    expect(first.valueAt(1.5)).to.equal(0.25); expect(first.valueAt(2.25)).to.equal(0.25);
    expect(first.insert(1, 4, 0, NaN)).to.equal(false);
  });

  it('produces the same future automation for chronological and shuffled submission', () => {
    const render = reverse => {
      const param = parameter(), curve = createSmoothedAudioParameter({ param, initialValue: 1, startTime: 0 });
      const events = [[0.5, 1], [0.9, 1.004], [0.1, 2]];
      for (const [value, time] of reverse ? events.reverse() : events) curve.insert(value, time, 0);
      return { events: param.events, samples: [0.5, 1, 1.002, 1.004, 1.008, 1.012, 2.008].map(time => curve.valueAt(time)) };
    };
    expect(render(false)).to.deep.equal(render(true));
    expect(render(false).samples).to.deep.equal([1, 1, 0.875, 0.75, 0.825, 0.9, 0.1]);
  });

  it('holds the modeled in-flight value when retargeting without native hold support', () => {
    const param = parameter(), curve = createSmoothedAudioParameter({ param, initialValue: 1, startTime: 0 });
    curve.insert(0, 1, 0);
    curve.insert(0.5, 1.004, 1.004);
    expect(param.events.find(event => event.kind === 'set' && event.time === 1.004).value).to.be.closeTo(0.5, 1e-12);
    expect(curve.valueAt(1.012)).to.equal(0.5);
  });

  for (const sampleRate of [44100, 48000, 96000]) it('keeps its declared smoothing time at ' + sampleRate + ' Hz', () => {
    const curve = createSmoothedAudioParameter({ param: parameter(), initialValue: 0, startTime: 0 });
    curve.insert(1, 0.1, 0);
    expect(curve.valueAt(0.104)).to.be.closeTo(0.5, 1e-12);
    expect(curve.valueAt((Math.ceil(0.108 * sampleRate) + 1) / sampleRate)).to.equal(1);
  });

  it('bounds future controls, retains endpoints and reclaims elapsed history', () => {
    const curve = createSmoothedAudioParameter({ param: parameter(), initialValue: 0, startTime: 0, maxEvents: 2 });
    expect(curve.insert(1, 1, 0)).to.equal(true); expect(curve.insert(0.5, 2, 0)).to.equal(true);
    expect(curve.insert(0, 3, 0)).to.equal(false);
    expect(curve.insert(0.75, 3, 2.1)).to.equal(true);
    expect(curve.valueAt(3.008)).to.equal(0.75);
    expect(curve.diagnostics().queued).to.equal(1);
  });
});
