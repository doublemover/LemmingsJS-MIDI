import { expect } from 'chai';
import { MidiEventRouter, MidiMapping, makeSchedulerStub, makeRateSnapshot, makeRateRouter, makePlan, makeRouter } from '../helpers/midi-router-fixtures.js';
import { createMidiProjectFromMidiConfig, projectToMidiConfig, reduceMidiProject } from '../../js/midi/project/MidiProject.js';

describe('MidiEventRouter 7', function() {
  it('shouldSend accounts for higher-priority traffic', function() {
    const bySfx = new Map([
      [2, { count: 2, bytes: 6, priority: 2 }]
    ]);
    const snapshot = makeRateSnapshot({ count: 2, bytes: 6, bySfx }, {}, 100);
    const usageShare = [{ sfxId: 2, count: 2, bytes: 6, priority: 2, percentCount: 1, percentBytes: 1 }];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 100 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1, bytes: 3 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('priority-saturated');
  });

  it('onEvent applies repeat amount and boost settings', function() {
    const { router } = makeRouter({
      enabled: true,
      timing: { bpmBase: 120 },
      repeat: { amount: 0.5, target: 'velocity', maxRepeats: 2, windowBeats: 1 },
      sfx: { '1': { note: 60 } }
    });
    const output = { channels: { 1: { sendNoteOn() {}, sendNoteOff() {}, sendPitchBend() {}, sendControlChange() {}, sendAllNotesOff() {}, sendPitchBendRange() {} } } };
    router.scheduler.setOutput(output);
    router._shouldSend = () => true;
    router.scheduler.sendNote = () => {};

    router._onEvent({ sfxId: 1, tick: 1, tps: 50, timeMs: 0 });
    router._onEvent({ sfxId: 1, tick: 2, tps: 50, timeMs: 20 });

    const { router: boostRouter } = makeRouter({
      enabled: true,
      timing: { bpmBase: 120 },
      repeat: { velocityBoost: 0.2, durationBoost: 0.1, maxRepeats: 2, windowBeats: 1 },
      sfx: { '1': { note: 60 } }
    });
    boostRouter.scheduler.setOutput(output);
    boostRouter._shouldSend = () => true;
    boostRouter.scheduler.sendNote = () => {};
    boostRouter._onEvent({ sfxId: 1, tick: 1, tps: 50, timeMs: 0 });
  });

  it('onEvent fills defaults when repeat boosts are missing', function() {
    const { router, sent } = makeRouter({
      enabled: true,
      limits: null,
      timing: null,
      repeat: null,
      triggers: null,
      sfx: { '1': { note: 60, repeat: { maxRepeats: 2, windowBeats: 1 } } }
    }, { mapEvent: () => ({ note: 60 }) });
    router.context = { level: { width: 200, height: 100 } };
    router._nowMs = () => 0;

    router._onEvent({ sfxId: 1, tick: 1, triggerType: 5, timeMs: 0, tps: 50 });

    expect(sent.length).to.equal(1);
    expect(sent[0].velocity).to.equal(64);
    expect(sent[0].durationTicks).to.equal(1);
  });

  it('forwards track output metadata to the scheduler', function() {
    const sent = [];
    const metas = [];
    const scheduler = makeSchedulerStub(sent);
    scheduler.hasAnyOutput = () => true;
    scheduler.hasOutput = outputId => outputId === 'track-out';
    scheduler.sendNote = (spec, meta = {}) => {
      sent.push({ ...spec });
      metas.push({ ...meta });
    };
    const { router } = makeRouter({
      enabled: true,
      sfx: {
        '1': {
          note: 60,
          outputId: 'track-out',
          trackId: 'track-1',
          voiceBudget: 5
        }
      }
    }, { scheduler });
    router._shouldSend = () => true;
    router._nowMs = () => 0;

    router._onEvent({ sfxId: 1, tick: 1, timeMs: 0, tps: 50 });

    expect(sent).to.have.lengthOf(1);
    expect(sent[0]).to.include({ outputId: 'track-out', trackId: 'track-1', voiceBudget: 5 });
    expect(metas[0]).to.include({ outputId: 'track-out', trackId: 'track-1', voiceBudget: 5 });
  });

  it('dispatches project-lowered clip mappings through the router', function() {
    let project = createMidiProjectFromMidiConfig({
      enabled: true,
      sfx: { '1': { name: 'skill-select', note: 60 } },
      triggers: {}
    });
    project = reduceMidiProject(project, { type: 'clip.add', clip: { id: 'riff', name: 'Riff', lengthSteps: 4 } });
    project = reduceMidiProject(project, {
      type: 'clip.step.update',
      clipId: 'riff',
      stepIndex: 0,
      patch: { note: 64, velocity: 90, durationTicks: 5 }
    });
    project = reduceMidiProject(project, {
      type: 'clip.step.update',
      clipId: 'riff',
      stepIndex: 1,
      patch: { note: 67, velocity: 70, durationTicks: 4 }
    });
    project = reduceMidiProject(project, {
      type: 'clip.step.update',
      clipId: 'riff',
      stepIndex: 2,
      patch: { note: 70, tie: true }
    });
    project = reduceMidiProject(project, {
      type: 'clip.step.update',
      clipId: 'riff',
      stepIndex: 3,
      patch: { note: 72, probability: 0 }
    });
    project = reduceMidiProject(project, { type: 'source.clip.assign', sourceId: 'sfx-1', clipId: 'riff' });

    const sent = [];
    const { router } = makeRouter(projectToMidiConfig(project, {}), { sent });
    router.scheduler.sendNote = spec => sent.push({ ...spec });
    router._shouldSend = () => true;
    router._nowMs = () => 0;

    router._onEvent({ sfxId: 1, tick: 1, timeMs: 0, tps: 50 });

    expect(sent.map(spec => spec.note)).to.deep.equal([64, 67]);
    expect(sent[0]).to.include({ velocity: 90, durationTicks: 5, channel: 1 });
    expect(sent[0].notes).to.deep.equal([64, 67]);
  });

  it('covers attach cleanup and tick defaults', function() {
    const { router: routerA, mapping } = makeRouter({ timing: { bpmBase: 10 } });
    const routerB = new MidiEventRouter({ timing: { bpmBase: 120 } });
    expect(routerA.mapping).to.equal(mapping);
    expect(routerB.mapping).to.be.instanceOf(MidiMapping);

    let onCalls = 0;
    let offCalls = 0;
    const onEvent = { on() { onCalls += 1; }, off() { offCalls += 1; } };
    const bus = { onEvent };
    routerA.attach(bus, {});
    routerA.attach(bus, {});
    routerA.detach();
    expect(onCalls).to.equal(2);
    expect(offCalls).to.equal(2);

    routerA.context = { game: { getGameTimer() { return { frameTime: 30, speedFactor: 1 }; } } };
    expect(routerA._tickMsFromEvent({ tps: 50 })).to.equal(20);
    expect(routerA._tickMsFromEvent({ frameMs: 40 })).to.equal(40);
    expect(routerA._tickMsFromEvent({})).to.equal(30);
    routerA.context = {};
    expect(routerA._tickMsFromEvent({})).to.equal(60);
    expect(routerA._getBpm()).to.equal(20);
  });

  it('covers density and schedule base resets', function() {
    const { router } = makeRouter({ density: { windowTicks: 4 } });
    expect(router._densityForEvent({})).to.equal(0);
    router._lastTickBySfx.set(1, 5);
    expect(router._densityForEvent({ sfxId: 1, tick: 5 })).to.equal(1);
    expect(router._densityForEvent({ sfxId: 1, tick: 9 })).to.equal(0);
    expect(router._densityForEvent({ sfxId: 1, tick: 7 })).to.be.closeTo(0.5, 0.01);

    const originalPerf = globalThis.performance;
    globalThis.performance = undefined;
    const now = router._nowMs();
    globalThis.performance = originalPerf;
    expect(Number.isFinite(now)).to.equal(true);

    router.scheduler = null;
    expect(router._resolveScheduleBase(NaN, 0, 0)).to.equal(null);

    router._clockFrameMs = 10;
    router._clockSpeedFactor = 1;
    router._nowMs = () => 1000;
    router._resolveScheduleBase(100, 20, 1);

    let cleared = 0;
    router.scheduler = { allNotesOff() { cleared += 1; }, clearQueue() { cleared += 1; } };
    router._resolveScheduleBase(200, 21, 2);
    expect(cleared).to.equal(2);
  });

  it('covers repeat target fallbacks and plan entries', function() {
    const { router, mapping } = makeRouter({ repeat: { maxRepeats: 2, spacingTicks: 2 } });
    const bpm = 60;
    expect(router._getRepeatFactor('sfx:1', 0, mapping.config.repeat, bpm)).to.equal(0);
    expect(router._getRepeatFactor('sfx:1', 1000, mapping.config.repeat, bpm)).to.be.greaterThan(0);

    const spec = { note: 60, velocity: 64, durationTicks: 2, pitchBend: 0.2, releaseVelocity: 64 };
    const notes = [60, 64];
    const noAmount = router._applyRepeatTarget(spec, notes, { target: 'velocity', amount: 'bad' }, 1);
    expect(noAmount.spec).to.equal(spec);
    const zeroAmount = router._applyRepeatTarget(spec, notes, { target: 'velocity', amount: 0 }, 1);
    expect(zeroAmount.spec).to.equal(spec);

    router._applyRepeatTarget(spec, notes, { target: 'accent', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'duration', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'note', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, timbre: 10 }, notes, { target: 'timbre', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, pan: 0 }, notes, { target: 'pan', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, pitchBend: 0.5 }, notes, { target: 'pitchBend', amount: 0.5 }, 1);
    router._applyRepeatTarget({ ...spec, pitchBend: NaN }, notes, { target: 'pitchBend', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'attack', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'decay', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'sustain', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'release', amount: 0.5 }, 1);
    router._applyRepeatTarget(spec, notes, { target: 'unknown', amount: 0.5 }, 1);

    const { router: mpeRouter } = makeRouter({ mpe: { enabled: true } });
    mpeRouter.scheduler.tickMs = 10;
    const planA = mpeRouter._planEntries({ note: 60, durationTicks: NaN }, 1000, 2);
    const planB = mpeRouter._planEntries({ note: 60, durationTicks: 1 }, 1000, 1);
    expect(planA.off.count).to.equal(0);
    expect(planB.off.count).to.equal(2);
  });

  it('shouldSend enforces hard caps', function() {
    const snapshot = makeRateSnapshot({ count: 10, bytes: 0 }, {}, 100);
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 10, hardMaxEventsPerSecond: 11, maxBytesPerSecond: 100 } },
      snapshot
    );
    const plan = makePlan({ on: { count: 2 } });
    const ok = router._shouldSend({ sfxId: 1, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('count-limit');
  });

  it('shouldSend throttles on byte budgets and priorities', function() {
    const bySfx = new Map([
      [1, { count: 1, bytes: 0, priority: 1 }],
      [2, { count: 1, bytes: 5, priority: 2 }]
    ]);
    const snapshot = makeRateSnapshot({ count: 2, bytes: 5, bySfx }, {}, 5);
    const usageShare = [
      { sfxId: 1, count: 1, bytes: 0, priority: 1, percentCount: 0.5, percentBytes: 0 },
      { sfxId: 2, count: 1, bytes: 5, priority: 2, percentCount: 0.5, percentBytes: 1 }
    ];
    const { router } = makeRateRouter(
      { limits: { maxEventsPerSecond: 2, hardMaxEventsPerSecond: 10, maxBytesPerSecond: 5 } },
      snapshot,
      usageShare
    );
    const plan = makePlan({ on: { count: 1 }, off: { timeMs: 500 } });
    const ok = router._shouldSend({ sfxId: 3, priority: 1 }, { timeMs: 0 }, plan, 0);
    expect(ok).to.equal(false);
    expect(router.getRateReport().reason).to.equal('byte-limit');
  });

  it('setMapping accepts MidiMapping instances', function() {
    const mapping = new MidiMapping({ timing: { bpmBase: 90 } });
    let configured = null;
    const { router } = makeRouter({}, {
      scheduler: { setConfig(cfg) { configured = cfg; } }
    });
    router.setMapping(mapping);
    expect(router.mapping).to.equal(mapping);
    expect(configured).to.equal(mapping.config);
  });

  it('returns zero density when window ticks are disabled', function() {
    const { router } = makeRouter({ density: null });
    expect(router._densityForEvent({ sfxId: 1, tick: 10 })).to.equal(0);
  });

  it('resolves arpeggio keys to unknown when sfxId is missing', function() {
    const { router } = makeRouter();
    const key = router._resolveArpKey({}, {});
    expect(key).to.equal('sfx:unknown');
  });

  it('merges trigger config into sfx overrides on events', function() {
    let captured = null;
    const { router, sent } = makeRouter({
      enabled: true,
      limits: { maxEventsPerSecond: 1000 },
      sfx: { '1': { velocity: 10 } },
      triggers: { '7': { velocity: 20 } }
    }, {
      mapEvent: (event, context, density, sfx) => {
        captured = sfx;
        return { note: 60, velocity: sfx.velocity, durationTicks: 1 };
      }
    });
    router.scheduler.output = {};

    router._onEvent({ sfxId: 1, tick: 1, tps: 50, triggerType: 7 });

    expect(captured.velocity).to.equal(20);
    expect(sent.length).to.equal(1);
  });

  it('returns zero repeat factors when repeats are disabled or invalid', function() {
    const { router } = makeRouter();
    const repeatCfg = { maxRepeats: 0, windowBeats: 0 };
    expect(router._getRepeatFactor('sfx:1', NaN, repeatCfg, 0)).to.equal(0);
  });
});
