import { expect } from 'chai';
import { setup } from './helpers/workstation-fixture.js';
import { subscribeMidiPreviewRouter, notifyMidiPreviewRouter } from '../js/midi/MidiPreviewSubscriptions.js';
import { createMidiWorkstationAdapterOwner } from '../js/midi/router/MidiWorkstationAdapter.js';
import { MidiEventRouter } from '../js/midi/MidiEventRouter.js';
import { MidiScheduler } from '../js/midi/MidiScheduler.js';
import { makeOutput } from './support/midi-output.js';
import { withFakeClockAndPerformance } from './support/timers.js';

describe('owned workstation preview boundaries', () => {
  it('leases an actual router without replacing methods or stealing another workstation handler', () => {
    const router = new MidiEventRouter({ enabled: true }), original = router.getAutomationSpanState, state = Object.freeze({ active: true });
    let events = 0;
    try {
      const lease = router.bindWorkstationAdapter({ onEvent() { events++; return true; }, getAutomationSpanState: () => state });
      expect(router.getAutomationSpanState).to.equal(original); expect(router.getAutomationSpanState('curve', 0)).to.equal(state);
      expect(Object.hasOwn(router, 'getAutomationSpanState')).to.equal(false); expect('workstationEventHandler' in router).to.equal(false);
      expect(() => router.bindWorkstationAdapter({ onEvent: () => false, getAutomationSpanState: () => null })).to.throw('already has');
      router._onEvent({ sfxId: 0 }); expect(events).to.equal(1);
      expect(lease.release()).to.equal(true); expect(lease.release()).to.equal(false);
      expect(router.getAutomationSpanState('curve', 0)).to.equal(null);
      const next = router.bindWorkstationAdapter({ onEvent: () => true, getAutomationSpanState: () => null });
      router.dispose(); expect(next.release()).to.equal(false);
      expect(() => router.bindWorkstationAdapter({ onEvent: () => true, getAutomationSpanState: () => null })).to.throw('retired');
    } finally { router.dispose(); }
  });
  it('captures adapter callbacks once and never revives a retired lease', () => {
    const owner = createMidiWorkstationAdapterOwner(), callbacks = { onEvent: () => true, getAutomationSpanState: () => 'original' };
    const first = owner.bind(callbacks); callbacks.onEvent = () => false; callbacks.getAutomationSpanState = () => 'changed';
    expect(owner.handleEvent({})).to.equal(true); expect(owner.automationProvider()('x', 0)).to.equal('original');
    first.release(); const second = owner.bind(callbacks);
    expect(first.release()).to.equal(false); expect(owner.handleEvent({})).to.equal(false);
    owner.dispose(); expect(second.release()).to.equal(false); expect(owner.automationProvider()).to.equal(null);
  });
  it('suppresses an obsolete notification after reentrant router publication and isolates hosts', () => {
    const first = { midiPreviewRouter: 'old' }, second = { midiPreviewRouter: 'other' }, events = [], unrelated = [];
    const release = subscribeMidiPreviewRouter(first, router => {
      events.push('first:' + router);
      if (router === 'old') { first.midiPreviewRouter = 'new'; notifyMidiPreviewRouter(first); }
    });
    subscribeMidiPreviewRouter(first, router => events.push('second:' + router));
    subscribeMidiPreviewRouter(second, router => unrelated.push(router));
    notifyMidiPreviewRouter(first);
    expect(events).to.deep.equal(['first:old', 'first:new', 'second:new']); expect(unrelated).to.deep.equal([]);
    expect(release()).to.equal(true); expect(release()).to.equal(false);
    notifyMidiPreviewRouter(second); expect(unrelated).to.deep.equal(['other']);
  });
  it('retires listeners during notification and attempts healthy owners after a subscriber throws', () => {
    const host = { midiPreviewRouter: null }; let removed = 0, healthy = 0, release;
    subscribeMidiPreviewRouter(host, () => { release(); throw new Error('Observer failed'); });
    release = subscribeMidiPreviewRouter(host, () => { removed++; });
    subscribeMidiPreviewRouter(host, () => { healthy++; });
    expect(() => notifyMidiPreviewRouter(host)).to.throw('Observer failed'); expect(removed).to.equal(0); expect(healthy).to.equal(1);
  });
  it('bounds each preview host independently and makes released capacity reusable', () => {
    const host = { midiPreviewRouter: null }, releases = Array.from({ length: 32 }, () => subscribeMidiPreviewRouter(host, () => {}));
    expect(() => subscribeMidiPreviewRouter(host, () => {})).to.throw('capacity');
    releases[0](); const release = subscribeMidiPreviewRouter(host, () => {}); expect(release()).to.equal(true);
    expect(subscribeMidiPreviewRouter({ midiPreviewRouter: null }, () => {})()).to.equal(true);
  });
  it('keeps two injected workstations independent through rebinding and disposal', async () => {
    const first = setup(), second = setup(), replacement = new MidiEventRouter({ enabled: true });
    const one = first.runtime.view, two = second.runtime.view, originalOne = one.setMidiPreviewRouter, originalTwo = two.setMidiPreviewRouter;
    const old = one.midiPreviewRouter, other = two.midiPreviewRouter, adapter = { onEvent: () => true, getAutomationSpanState: () => null };
    try {
      first.studio.bindRuntime(); first.studio.bindRuntime(); second.studio.bindRuntime();
      expect(one.setMidiPreviewRouter).to.equal(originalOne); expect(two.setMidiPreviewRouter).to.equal(originalTwo);
      expect(() => old.bindWorkstationAdapter(adapter)).to.throw('already has'); expect(() => other.bindWorkstationAdapter(adapter)).to.throw('already has');
      one.setMidiPreviewRouter(replacement);
      const released = old.bindWorkstationAdapter(adapter); expect(released.release()).to.equal(true);
      expect(() => replacement.bindWorkstationAdapter(adapter)).to.throw('already has');
      await first.studio.dispose().completion;
      const after = replacement.bindWorkstationAdapter(adapter); expect(after.release()).to.equal(true);
      expect(() => other.bindWorkstationAdapter(adapter)).to.throw('already has');
      one.setMidiPreviewRouter(old); const obsolete = old.bindWorkstationAdapter(adapter); expect(obsolete.release()).to.equal(true);
      expect(second.studio.getDocumentState().editRevision).to.equal(0);
    } finally { await first.studio.dispose().completion; await second.studio.dispose().completion; replacement.dispose(); }
  });
  it('reads the public activity port without inspecting private scheduler maps', async () => {
    const f = setup(), scheduler = f.runtime.view.midiPreviewRouter.scheduler;
    scheduler.getOutputActivity = () => Object.freeze({ activeNotes: 7, pendingNotes: 3 });
    Object.defineProperty(scheduler, '_activeNotes', { get() { throw new Error('Private map accessed'); } });
    Object.defineProperty(scheduler, '_pendingNoteOns', { get() { throw new Error('Private map accessed'); } });
    try { f.studio.bindRuntime(); expect(f.studio.getPlaybackState()).to.include({ activeNotes: 7, pendingNotes: 3, noteActivityAvailable: true }); }
    finally { await f.studio.dispose().completion; }
  });
  it('reports immutable accepted ownership and pending counts from the real scheduler', () => {
    withFakeClockAndPerformance(clock => {
      const scheduler = new MidiScheduler({ mpe: { enabled: false } }), output = makeOutput([1], []);
      try {
        scheduler.setOutput(output); scheduler.setTickMs(10);
        expect(scheduler.sendNote({ note: 60, velocity: 64, durationTicks: 2, timeMs: performance.now() + 100 })).to.equal(true);
        const accepted = scheduler.getOutputActivity(); expect(Object.isFrozen(accepted)).to.equal(true);
        expect(accepted).to.include({ activeNotes: 1, pendingNotes: 1, disposed: false, scope: 'accepted-owned-voices-including-pending' });
        clock.tick(101); expect(scheduler.getOutputActivity()).to.include({ activeNotes: 1, pendingNotes: 0 });
        scheduler.allNotesOff(); expect(scheduler.getOutputActivity()).to.include({ activeNotes: 0, pendingNotes: 0 });
        scheduler.dispose(); expect(scheduler.getOutputActivity().disposed).to.equal(true); expect(accepted.pendingNotes).to.equal(1);
      } finally { scheduler.dispose(); }
    });
  });
});
