import { expect } from 'chai';
import { createSmoothedAudioParameter } from '../../js/app/midi-ui/SmoothedAudioParameter.js';

const parameter = () => ({ events: [], setValueAtTime(value, time) { this.events.push({ kind: 'set', value, time }); },
  linearRampToValueAtTime(value, time) { this.events.push({ kind: 'ramp', value, time }); },
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); } });

describe('Smoothed audio parameters', () => {
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
