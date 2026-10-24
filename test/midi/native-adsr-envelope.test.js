import { expect } from 'chai';
import { scheduleNativeHeldEnvelope } from '../../js/app/midi-ui/NativeAdsrEnvelope.js';
import { releaseNativeVoice } from '../../js/app/midi-ui/NativeVoiceLifetime.js';

class TimelineParam {
  events = [];
  get value() { throw new Error('A future envelope must not read AudioParam.value.'); }
  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); this.events.sort((a, b) => a.time - b.time); }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'linear', value, time }); this.events.sort((a, b) => a.time - b.time); }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
  at(time) {
    let previous = { time: 0, value: 0 };
    for (const event of this.events) {
      if (event.time > time) return event.type === 'linear' ? previous.value + (event.value - previous.value) * (time - previous.time) / (event.time - previous.time) : previous.value;
      previous = event;
    }
    return previous.value;
  }
}
const held = (voice, time) => {
  const elapsed = time - voice.start;
  if (elapsed < 0) return 0;
  if (elapsed < voice.attack) return voice.peak * elapsed / voice.attack;
  if (elapsed < voice.attack + voice.decay) return voice.peak * (1 - (1 - voice.sustain) * (elapsed - voice.attack) / voice.decay);
  return voice.peak * voice.sustain;
};
const setup = (options = {}) => {
  const param = new TimelineParam(), voice = { start: 0, end: 10, releaseAt: 9.9, release: 0.1, peak: 0.8, attack: 0.1, decay: 0.1, sustain: 0.5,
    released: false, gain: { gain: param }, oscillator: { stop() {} }, startMs: 0, ...options };
  const host = { _voices: new Set([voice]), _observe() {}, _emitPlayback() {}, _destroyVoice() { this._voices.delete(voice); } };
  scheduleNativeHeldEnvelope(voice); return { voice, host, param };
};
describe('native ADSR release frontiers (#1256)', () => {
  for (const start of [0, 3]) for (const attack of [0, 0.1]) for (const decay of [0, 0.1]) for (const sustain of [0, 0.5]) {
    it(`preserves attack/decay before release at future start ${start}, A=${attack}, D=${decay}, S=${sustain}`, () => {
      for (const relative of [0, 0.025, 0.05, attack, attack + decay, 0.15, 0.25]) {
        const { voice, host, param } = setup({ start, attack, decay, sustain }), frontier = start + relative, expected = held(voice, frontier);
        releaseNativeVoice.call(host, voice, frontier);
        for (let index = 0; index < 100; index++) {
          const time = start + relative * index / 100;
          expect(param.at(time), 'pre-release at ' + time).to.be.closeTo(held(voice, time), 1e-10);
        }
        expect(param.at(frontier)).to.be.closeTo(expected, 1e-10);
        expect(param.at(frontier + 0.05)).to.be.closeTo(expected / 2, 1e-10);
        expect(param.at(frontier + 0.1)).to.be.closeTo(0, 1e-10);
      }
    });
  }
  it('preserves a truncated lease envelope and restores its original decay on renewal', () => {
    const { voice, param } = setup({ attack: 0.2, decay: 1.4, releaseAt: 0.5, end: 0.6 });
    for (const time of [0.1, 0.25, 0.49]) expect(param.at(time)).to.be.closeTo(held(voice, time), 1e-10);
    voice.releaseAt = 3; voice.end = 3.1; scheduleNativeHeldEnvelope(voice, 0.3);
    for (const time of [0.1, 0.25, 0.4, 1, 2]) expect(param.at(time)).to.be.closeTo(held(voice, time), 1e-10);
  });
  it('handles an earlier repeated end and a forced shortening without restarting the envelope', () => {
    const { voice, host, param } = setup(); releaseNativeVoice.call(host, voice, 0.15);
    releaseNativeVoice.call(host, voice, 0.05); const events = param.events.slice();
    releaseNativeVoice.call(host, voice, 0.1); expect(param.events).to.deep.equal(events);
    voice.release = 0.02; const before = param.at(0.075); releaseNativeVoice.call(host, voice, 0.075, true, 'panic');
    expect(param.at(0.075)).to.be.closeTo(before, 1e-10); expect(param.at(0.085)).to.be.closeTo(before / 2, 1e-10);
  });
});
