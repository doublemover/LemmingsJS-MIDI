import { expect } from 'chai';
import { createInstrumentMotionPolicy } from '../js/app/resources/InstrumentMotionPolicy.js';
import { ProcgenActorEffectDisplay } from '../js/app/procgen/ProcgenActorEffectDisplay.js';
import { createActorEffectVisualPreset } from '../js/app/procgen/ActorEffectVisualProfile.js';

const fixture = (options = {}) => {
  let time = 0, timers = 0;
  const document = new globalThis.EventTarget(), media = new globalThis.EventTarget(); document.hidden = false; media.matches = false;
  const window = { performance: { now: () => time }, matchMedia: () => media, setTimeout() { timers++; throw new Error('Motion must use an existing display owner'); }, requestAnimationFrame() { timers++; throw new Error('Motion must use an existing frame owner'); } };
  const policy = createInstrumentMotionPolicy({ document, window, ...options });
  return { policy, document, media, setTime: value => { time = value; }, timers: () => timers, reduced(value) { media.matches = value; media.dispatchEvent(new globalThis.Event('change')); }, hidden(value) { document.hidden = value; document.dispatchEvent(new globalThis.Event('visibilitychange')); } };
};

describe('shared instrument presentation motion', () => {
  it('reaches exact finite endpoints independently of intermediate display cadence', () => {
    const f = fixture(); try {
      f.policy.retarget('frequent', 1, { from: 0, durationMs: 100 }); f.policy.retarget('sparse', 1, { from: 0, durationMs: 100 });
      for (const timestamp of [10, 20, 35]) { f.setTime(timestamp); f.policy.sample('frequent', 1); }
      f.setTime(50); expect(f.policy.sample('frequent', 1)).to.equal(0.5); expect(f.policy.sample('sparse', 1)).to.equal(0.5);
      f.setTime(100); expect(f.policy.sample('frequent', 1)).to.equal(1); expect(f.policy.sample('sparse', 1)).to.equal(1); expect(f.policy.getState().activeTransitions).to.equal(0);
      f.policy.retarget('small endpoint', 1e-10, { from: 65536, durationMs: 10 }); f.setTime(110); expect(f.policy.sample('small endpoint', 1e-10)).to.equal(1e-10);
    } finally { f.policy.dispose(); }
  });
  it('reverses an interrupted transition from the exact currently presented value', () => {
    const f = fixture(); try {
      f.policy.retarget('cap', 1, { from: 0, durationMs: 100 }); f.setTime(40); const before = f.policy.sample('cap', 1);
      expect(before).to.be.closeTo(0.352, 1e-12); expect(f.policy.retarget('cap', 0, { from: 99, durationMs: 100 })).to.equal(before);
      expect(f.policy.sample('cap', 0)).to.equal(before); f.setTime(90); expect(f.policy.sample('cap', 0)).to.be.closeTo(before / 2, 1e-12); f.setTime(140); expect(f.policy.sample('cap', 0)).to.equal(0);
    } finally { f.policy.dispose(); }
  });
  it('freezes presentation time across world pause and resumes without catch-up', () => {
    const f = fixture(); try {
      f.policy.retarget('value', 1, { from: 0, durationMs: 100 }); f.setTime(40); f.policy.configure({ paused: true }); const held = f.policy.sample('value', 1);
      f.setTime(1040); expect(f.policy.sample('value', 1)).to.equal(held); expect(f.policy.matches).to.equal(true); expect(f.policy.automaticCamera).to.equal(false);
      f.setTime(2040); f.policy.configure({ paused: false }); expect(f.policy.sample('value', 1)).to.equal(held); f.setTime(2100); expect(f.policy.sample('value', 1)).to.equal(1);
    } finally { f.policy.dispose(); }
  });
  it('holds hidden and explicitly frozen transitions while preserving the selected preference', () => {
    const f = fixture(); try {
      f.policy.retarget('value', 1, { from: 0, durationMs: 100 }); f.setTime(40); f.hidden(true); f.setTime(5040); expect(f.policy.sample('value', 1)).to.be.closeTo(0.352, 1e-12);
      f.hidden(false); f.policy.configure({ mode: 'freeze' }); f.setTime(9040); expect(f.policy.sample('value', 1)).to.be.closeTo(0.352, 1e-12);
      f.policy.configure({ mode: 'system' }); f.setTime(9060); expect(f.policy.sample('value', 1)).to.be.closeTo(0.648, 1e-12);
    } finally { f.policy.dispose(); }
  });
  it('adopts live system reduction without an override that can silently re-enable motion', () => {
    const f = fixture(); try {
      f.policy.retarget('value', 1, { from: 0 }); f.reduced(true); expect(f.policy.getState()).to.include({ state: 'reduced', systemPreference: 'reduce', activeTransitions: 0 });
      expect(f.policy.retarget('value', 2, { from: 0 })).to.equal(2); f.policy.configure({ mode: 'system' }); expect(f.policy.matches).to.equal(true);
      f.policy.configure({ mode: 'freeze' }); f.reduced(false); expect(f.policy.getState()).to.include({ state: 'frozen', mode: 'freeze' });
    } finally { f.policy.dispose(); }
  });
  it('admits bounded targets and releases their exact reservation once without an animation timer', () => {
    const retained = [], released = [], f = fixture({ maxTransitions: 2, budget: { retain: (...args) => retained.push(args), release: key => released.push(key) } });
    try {
      f.policy.retarget('a', 1, { from: 0 }); f.policy.retarget('b', 1, { from: 0 }); expect(f.policy.retarget('c', 1, { from: 0 })).to.equal(0); expect(f.policy.getState()).to.include({ activeTransitions: 2, skipped: 1 });
      f.policy.release('a'); f.policy.retarget('c', 1, { from: 0 }); expect(f.policy.getState().activeTransitions).to.equal(2); expect(f.timers()).to.equal(0);
      f.policy.dispose(); f.policy.dispose(); expect(released).to.deep.equal([retained[0][0]]); expect(f.policy.getState()).to.include({ activeTransitions: 0, retainedBytes: 0, retired: true });
    } finally { f.policy.dispose(); }
  });
  it('does not let backward display timestamps reverse progress', () => {
    const f = fixture(); try { f.setTime(100); f.policy.retarget('value', 1, { from: 0, durationMs: 100 }); f.setTime(50); expect(f.policy.sample('value', 1)).to.equal(0); expect(f.policy.getState().regressions).to.equal(1); f.setTime(200); expect(f.policy.sample('value', 1)).to.equal(1); } finally { f.policy.dispose(); }
  });
  it('retains a small idle owner and refuses unadmitted animation growth without changing its shown value', () => {
    let released = 0; const f = fixture({ budget: { retain(key, bytes) { if (bytes > 4096) throw new Error('metadata budget'); }, release() { released++; } } });
    try {
      expect(f.policy.getState()).to.include({ retainedBytes: 4096, transitionCapacity: 0 }); expect(f.policy.retarget('new actor', 1, { from: 0 })).to.equal(0);
      expect(f.policy.getState()).to.include({ activeTransitions: 0, transitionCapacity: 0, retainedBytes: 4096, skipped: 1 });
    } finally { f.policy.dispose(); } expect(released).to.equal(1);
  });
  it('rejects unsupported, nonfinite or unbounded transition requests', () => {
    const f = fixture(); try {
      for (const value of [NaN, Infinity, -Infinity, 65537]) expect(() => f.policy.retarget('value', value)).to.throw();
      for (const durationMs of [-1, Infinity, 2001]) expect(() => f.policy.retarget('value', 1, { durationMs })).to.throw();
      expect(() => f.policy.retarget('', 1)).to.throw(); expect(() => f.policy.configure({ mode: 'unbounded' })).to.throw(); expect(() => f.policy.configure({ paused: 'false' })).to.throw();
      expect(f.policy.getState().activeTransitions).to.equal(0);
    } finally { f.policy.dispose(); }
  });
  it('keeps independent same-callback leases and fences release or replacement during notification', () => {
    const f = fixture(), calls = []; let releaseB, added = false;
    try {
      const repeated = () => calls.push('same'), first = f.policy.subscribe(repeated), second = f.policy.subscribe(repeated); first(); f.policy.configure({ paused: true }); expect(calls).to.deep.equal(['same']); second(); calls.length = 0;
      f.policy.subscribe(() => { calls.push('A'); releaseB(); if (!added) { added = true; f.policy.subscribe(() => calls.push('C')); } }); releaseB = f.policy.subscribe(() => calls.push('retired B'));
      f.policy.configure({ paused: false }); expect(calls).to.deep.equal(['A']); f.policy.configure({ paused: true }); expect(calls).to.deep.equal(['A', 'A', 'C']);
    } finally { f.policy.dispose(); }
  });
  it('contains failed observers and ignores disposed preference callbacks', () => {
    const f = fixture(); let delivered = 0;
    f.policy.subscribe(() => { throw new Error('presentation observer'); }); f.policy.subscribe(() => delivered++); f.reduced(true); expect(delivered).to.equal(1); expect(f.policy.getState().callbackFailures).to.equal(1);
    f.policy.dispose(); const revision = f.policy.revision; f.reduced(false); f.hidden(true); expect(f.policy.revision).to.equal(revision); expect(f.policy.configure({ mode: 'system' })).to.equal(false); expect(f.policy.getState().subscribers).to.equal(0);
  });
  it('holds automatic-view dwell time through live system reduction without a catch-up jump', () => {
    const f = fixture(); try {
      expect(f.policy.presentationTime()).to.equal(0); f.setTime(40); f.reduced(true); expect(f.policy.presentationTime()).to.equal(40);
      f.setTime(10040); expect(f.policy.presentationTime()).to.equal(40); f.reduced(false); f.setTime(10060); expect(f.policy.presentationTime()).to.equal(60);
    } finally { f.policy.dispose(); }
  });
  it('retires every later observer when an earlier callback disposes the shared owner', () => {
    const f = fixture(); let delivered = 0; f.policy.subscribe(() => f.policy.dispose()); f.policy.subscribe(() => delivered++);
    f.policy.configure({ paused: true }); expect(delivered).to.equal(0); expect(f.policy.getState()).to.include({ retired: true, subscribers: 0, activeTransitions: 0 });
  });
});

describe('motion policy consumes qualified actor presentation, not physical or audio clocks', () => {
  const epoch = { worldId: 'motion-world', generation: 1, executionEpoch: 2, graphRevision: 3, routeRevision: 4 };
  const correlation = { executionEpoch: 2, audioFrame: 48000, presentationMs: 100, sampleRate: 48000 };
  const sample = { version: 1, ...epoch, actorId: 2, owner: { kind: 'actor', actorId: 2 }, voiceId: 'voice2', onsetId: 'onset2', effectId: 'fx1', effectRevision: 1,
    quantity: 'pitch-modulation', value: 1, units: 'normalized-signed', evidenceClass: 'measured', muted: false, coverage: 'complete', appliedAudioFrame: 48000, window: { firstFrame: 47900, lastFrame: 48000 } };
  const actor = f => { const display = new ProcgenActorEffectDisplay({ motionPolicy: f.policy }); display.setEpoch(epoch); display.setProfile({ ...createActorEffectVisualPreset('pitch-shimmer', 'fx1'), intensity: 1, smoothingMs: 100 }); expect(display.ingest(sample, correlation)).to.equal(true); return display; };
  it('keeps static qualified evidence visible when paused and expires it using actual sample age', () => {
    const f = fixture(), display = actor(f); try {
      f.setTime(100); f.policy.configure({ paused: true }); const value = display.evaluate(2, 100); expect(value).to.include({ state: 'applied', x: 0, y: 0, scale: 1, inner: 0.5 }); expect(value.sources).to.have.length.greaterThan(0);
      const before = display.frameKey(100); f.setTime(10000); expect(display.evaluate(2, 10000)).to.include({ x: 0, y: 0, scale: 1, inner: 0, outer: 0 }); expect(display.frameKey(10000)).not.to.equal(before);
    } finally { display.dispose(); f.policy.dispose(); }
  });
  it('resumes from the actual static pose and releases transition keys on actor retirement', () => {
    const f = fixture(), display = actor(f); try {
      f.setTime(100); f.policy.configure({ mode: 'reduce' }); display.evaluate(2, 100); f.policy.configure({ mode: 'system' }); expect(display.evaluate(2, 100).x).to.equal(0);
      f.setTime(150); const moving = display.evaluate(2, 150); expect(moving.x).to.be.greaterThan(0); expect(moving.x).to.be.at.most(3);
      display.removeActor(2); expect(f.policy.getState().activeTransitions).to.equal(0); expect(display.evaluate(2, 150).sources).to.deep.equal([]);
    } finally { display.dispose(); f.policy.dispose(); }
  });
  it('keeps unconfirmed static evidence distinct and never animates an unknown or blocked route', () => {
    const f = fixture(), display = actor(f); try {
      f.policy.configure({ mode: 'reduce' });
      display.removeActor(2); expect(display.ingest({ ...sample, muted: null }, correlation)).to.equal(true);
      const unknown = display.evaluate(2, 100); expect(unknown).to.include({ state: 'route-unknown', x: 0, y: 0, scale: 1 }); expect(unknown.trails).to.deep.equal([]); expect(unknown.sources).to.have.length.greaterThan(0); expect(unknown.sources.every(source => source.state === 'route-unknown')).to.equal(true);
      for (const [patch, state] of [[{ pending: true }, 'pending'], [{ rejected: true }, 'rejected'], [{ muted: true }, 'muted']]) {
        display.removeActor(2); expect(display.ingest({ ...sample, ...patch }, correlation)).to.equal(true); expect(display.evaluate(2, 100)).to.include({ state, x: 0, inner: 0, outer: 0 });
      }
    } finally { display.dispose(); f.policy.dispose(); }
  });
  it('does not let a dense secondary view repeatedly restart the main actor transition', () => {
    const f = fixture(), display = actor(f); try {
      f.setTime(100); display.evaluate(2, 100); f.setTime(150); expect(display.evaluate(2, 150, { dense: true }).x).to.equal(0); expect(display.evaluate(2, 150).x).to.be.closeTo(1.5, 1e-12);
      f.setTime(200); expect(display.evaluate(2, 200, { dense: true }).x).to.equal(0); expect(display.evaluate(2, 200).x).to.equal(3);
    } finally { display.dispose(); f.policy.dispose(); }
  });
});
