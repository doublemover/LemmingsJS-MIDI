import { expect } from 'chai';
import { GameTimer } from '../js/game/GameTimer.js';
import { HistoryStore } from '../js/game/HistoryStore.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { COUNTER_LIMIT } from '../js/core/constants.js';
import { createHistoryFixture } from './support/history-fixtures.js';
import { withGlobalLemmings } from './helpers/lemmings.js';

const fixture = () => {
  let now = 0, sequence = 0;
  const frames = new Map(), listeners = new Map();
  const window = { requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type) };
  const document = { visibilityState: 'visible', hasFocus: () => true,
    addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: type => listeners.delete(type) };
  const timer = new GameTimer({ timeLimit: 1 }, { window, document, performance: { now: () => now } });
  return { timer, frames, listeners, document, frame(time) { now = time; const entry = frames.entries().next().value;
    if (!entry) throw new Error('No owned animation frame.'); frames.delete(entry[0]); entry[1](time); } };
};

describe('finite GameTimer counter boundary', () => {
  it('bounds a delayed animation frame and drains every deferred tick at unchanged speed', () => {
    const f = fixture(), before = [], after = [], budget = f.timer.maxTicksPerFrame;
    f.timer.onBeforeGameTick.on(tick => before.push(tick)); f.timer.onGameTick.on(() => after.push(f.timer.tickIndex));
    f.timer.continue(); const end = (budget + 17) * f.timer.frameTime; f.frame(end);
    expect(f.timer.tickIndex).to.equal(budget); expect(f.timer.pendingCatchupTicks).to.equal(17);
    f.frame(end); expect(f.timer.tickIndex).to.equal(budget + 17); expect(f.timer.pendingCatchupTicks).to.equal(0);
    expect(before).to.deep.equal(Array.from({ length: budget + 17 }, (_, index) => index));
    expect(after).to.deep.equal(Array.from({ length: budget + 17 }, (_, index) => index + 1));
    f.frame(end); expect(f.timer.tickIndex).to.equal(budget + 17); f.timer.stop();
  });
  it('does not credit deferred ticks to the admitted benchmark startup budget', () => withGlobalLemmings({ bench: true }, () => {
    const f = fixture(), budget = f.timer.maxTicksPerFrame; f.timer.benchStartupFrames = 1000;
    f.timer.continue(); f.frame((budget + 500) * f.timer.frameTime);
    expect(f.timer.tickIndex).to.equal(budget); expect(f.timer.benchStartupFrames).to.equal(1000 - budget);
    expect(f.timer.pendingCatchupTicks).to.equal(500); f.timer.stop();
  }));
  it('retains admitted tick debt when the benchmark controller changes its future speed', () => withGlobalLemmings({ bench: true }, () => {
    const f = fixture(), requested = f.timer.maxTicksPerFrame + 500; f.timer.speedFactor = 10;
    f.timer.continue(); const end = requested * f.timer.frameTime; f.frame(end);
    expect(f.timer.speedFactor).to.be.lessThan(10); expect(f.timer.pendingCatchupTicks).to.equal(500);
    for (let index = 0; index < 6; index++) f.frame(end);
    expect(f.timer.tickIndex).to.equal(requested); expect(f.timer.pendingCatchupTicks).to.equal(0); f.timer.stop();
  }));
  it('clears wall-time catch-up debt on deliberate pause and reanchors a resumed clock', () => {
    const f = fixture(), budget = f.timer.maxTicksPerFrame; f.timer.continue();
    const end = (budget + 17) * f.timer.frameTime; f.frame(end); f.timer.suspend();
    expect(f.timer.pendingCatchupTicks).to.equal(0); f.timer.continue(); f.frame(end);
    expect(f.timer.tickIndex).to.equal(budget); f.timer.stop();
  });
  it('retires the old frame when a tick callback reanchors the running clock', () => {
    const f = fixture(); let callbacks = 0;
    f.timer.onGameTick.on(() => { if (++callbacks === 1) f.timer.speedFactor = 2; });
    f.timer.continue(); f.frame(600);
    expect(f.timer.tickIndex).to.equal(1); expect(f.frames.size).to.equal(1);
    expect(f.timer.pendingCatchupTicks).to.equal(0); f.frame(630);
    expect(f.timer.tickIndex).to.equal(2); expect(callbacks).to.equal(2); expect(f.frames.size).to.equal(1); f.timer.stop();
  });
  it('ignores a canceled prior-run frame without canceling or advancing its replacement clock', () => {
    const f = fixture(); f.timer.continue(); const stale = f.frames.values().next().value;
    f.timer.suspend(); f.timer.continue(); f.frame(60); stale(6000);
    expect(f.timer.tickIndex).to.equal(1); expect(f.frames.size).to.equal(1);
    expect(f.timer.pendingCatchupTicks).to.equal(0); f.timer.stop();
  });
  it('refuses invalid horizon assignments without changing time, seconds or remaining allowance', () => withGlobalLemmings({ endless: false }, () => {
    const { timer } = fixture(); timer.tickIndex = COUNTER_LIMIT - 2; const seen = [];
    timer.eachGameSecond.on(second => seen.push(second)); const before = timer.getGameTime();
    for (const value of [COUNTER_LIMIT, COUNTER_LIMIT + 1, Infinity]) {
      expect(() => { timer.tickIndex = value; }).to.throw(RangeError, 'counter exhausted');
      expect(timer.tickIndex).to.equal(COUNTER_LIMIT - 2); expect(timer.getGameTime()).to.equal(before);
      expect(timer.getGameLeftTime()).to.equal(0);
    }
    expect(seen).to.deep.equal([]); timer.stop();
  }));
  for (const steps of [1, 2, 20]) it('settles complete tick pairs at max−2 for a ' + steps + '-tick request', () => {
    const { timer } = fixture(), before = [], after = [];
    timer.tickIndex = COUNTER_LIMIT - 2;
    timer.onBeforeGameTick.on(tick => before.push(tick)); timer.onGameTick.on(() => after.push(timer.tickIndex));
    expect(timer.tick(steps)).to.equal(steps === 1);
    expect(before).to.deep.equal([COUNTER_LIMIT - 2]); expect(after).to.deep.equal([COUNTER_LIMIT - 1]);
    expect(timer.counterExhausted).to.equal(true); expect(timer.tick()).to.equal(false);
    expect(before).to.have.length(1); expect(after).to.have.length(1); timer.stop();
  });
  it('suspends catch-up at the terminal tick without scheduling another frame', () => {
    const f = fixture(), before = [], after = [];
    f.timer.tickIndex = COUNTER_LIMIT - 2;
    f.timer.onBeforeGameTick.on(tick => before.push(tick)); f.timer.onGameTick.on(() => after.push(f.timer.tickIndex));
    expect(f.timer.continue()).to.equal(true); f.frame(180);
    expect(before).to.deep.equal([COUNTER_LIMIT - 2]); expect(after).to.deep.equal([COUNTER_LIMIT - 1]);
    expect(f.timer.isRunning()).to.equal(false); expect(f.frames.size).to.equal(0);
    expect(f.timer.continue()).to.equal(false); expect(f.frames.size).to.equal(0); f.timer.stop();
    expect(f.listeners.size).to.equal(0);
  });
  it('refuses a foreground auto-resume after seeking to the exhausted boundary while hidden', () => {
    const f = fixture(); f.timer.continue(); f.document.visibilityState = 'hidden'; f.listeners.get('visibilitychange')();
    expect(f.timer.isRunning()).to.equal(false); f.timer.tickIndex = COUNTER_LIMIT - 1;
    f.document.visibilityState = 'visible'; f.listeners.get('visibilitychange')();
    expect(f.timer.isRunning()).to.equal(false); expect(f.frames.size).to.equal(0); f.timer.stop();
  });
  it('preserves real history transaction and cooldown chronology at exhaustion', () => withGlobalLemmings({ endless: false }, () => {
    const f = createHistoryFixture(); f.history.detach(); const { timer } = fixture();
    const history = new HistoryStore({ keyframeInterval: 5 });
    timer.tickIndex = COUNTER_LIMIT - 2; f.game.getGameTimer = () => timer;
    const trigger = new Trigger(TriggerTypes.TRAP, 0, 0, 10, 10, 20); trigger.runtime = { history };
    f.triggerManager.add(trigger); const activations = []; let commits = 0;
    timer.onGameTick.on(() => { activations.push(trigger.trigger(5, 6, timer.tickIndex), trigger.trigger(5, 6, timer.tickIndex)); commits++; });
    history.attach(f.game, { captureBaseline: true });
    expect(timer.tick(2)).to.equal(false); expect(commits).to.equal(1);
    expect(activations).to.deep.equal([TriggerTypes.TRAP, TriggerTypes.DISABLED]);
    expect(trigger.disabledUntilTick).to.equal(COUNTER_LIMIT);
    expect(history.getDelta(COUNTER_LIMIT - 2).triggerCooldownChanges.next).to.include(COUNTER_LIMIT);
    expect(history.getHistoryStats()).to.include({ maxTick: COUNTER_LIMIT - 2 });
    expect(timer.getGameLeftTime()).to.equal(0); expect(timer.tick()).to.equal(false);
    expect(commits).to.equal(1); history.detach(); timer.stop();
  }));
  it('keeps deliberate rewind, seek and restart distinct from exhaustion', () => {
    const { timer } = fixture(); timer.tickIndex = COUNTER_LIMIT - 1;
    expect(timer.tick(-1)).to.equal(true); expect(timer.counterExhausted).to.equal(false);
    expect(timer.tick()).to.equal(true); expect(timer.tickIndex).to.equal(COUNTER_LIMIT - 1);
    timer.tickIndex = 2; expect(timer.tick()).to.equal(true); expect(timer.tickIndex).to.equal(3);
    timer.stop(); const fresh = fixture().timer; expect(fresh.tickIndex).to.equal(0); expect(fresh.counterExhausted).to.equal(false); fresh.stop();
  });
  it('retains the time-travel owner result instead of claiming a refused rewind happened', () => {
    const { timer } = fixture(); timer.tickIndex = COUNTER_LIMIT - 1;
    timer.setTimeTravelController({ stepBackward: () => false });
    expect(timer.tick(-1)).to.equal(false); expect(timer.counterExhausted).to.equal(true); timer.stop();
  });
});
