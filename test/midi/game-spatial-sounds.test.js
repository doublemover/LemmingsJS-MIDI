import { expect } from 'chai';
import { MidiMapping } from '../../js/midi/MidiMapping.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiScheduler } from '../../js/midi/MidiScheduler.js';
import { Lemming } from '../../js/lemmings/Lemming.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';
import { ActionCountdownSystem } from '../../js/actions/ActionCountdownSystem.js';
import { SoundEventBus, SoundEffectIds } from '../../js/game/SoundEvents.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';
import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';

describe('game position and contact voices', function() {
  it('clamps both coordinate modes and snapshots the camera at the event', function() {
    const mapping = new MidiMapping({ position: { viewPan: true, panMode: 'level' } });
    const context = { levelWidth: 1000, viewRect: { x: 300, w: 200 } };
    expect(mapping.mapEvent({ x: 0 }, context).pan).to.equal(-127);
    expect(mapping.mapEvent({ x: 500 }, context).pan).to.equal(0);
    expect(mapping.mapEvent({ x: 1500 }, context).pan).to.equal(127);
    mapping.config.position.panMode = 'viewport';
    const previous = mapping.mapEvent({ x: 400 }, context);
    expect(previous.pan).to.equal(0);
    context.viewRect.x = 400;
    expect(mapping.mapEvent({ x: 400 }, context).pan).to.be.below(0);
    expect(previous.pan).to.equal(0);
    mapping.config.position.panOffscreenRange = 0;
    expect(mapping.mapEvent({ x: 1500 }, context).pan).to.equal(127);
  });

  it('retains whole-level pan when saving and restoring a project', function() {
    const restored = createMidiProject(JSON.parse(JSON.stringify(createMidiProject({
      global: { position: { viewPan: true, panMode: 'level' } }
    }))));
    expect(projectToMidiConfig(restored).position).to.include({ viewPan: true, panMode: 'level' });
  });

  it('emits both voices only when a walker changes direction at the actual blocker', function() {
    const events = [];
    const runtime = { soundEvents: { emitSfx: (type, sfxId, data) => events.push({ type, sfxId, ...data }) } };
    const blocker = new Lemming(100, 50, 1, runtime);
    const walker = new Lemming(95, 50, 2, runtime);
    const trigger = { type: TriggerTypes.BLOCKER_LEFT };
    blocker.onTrigger(1, walker, trigger);
    walker.lookRight = false;
    blocker.onTrigger(2, walker, trigger);
    expect(events.map(event => event.sfxId)).to.deep.equal([SoundEffectIds.BLOCKER_TURN, SoundEffectIds.BLOCKER_CONTACT]);
    expect(events.map(event => event.x)).to.deep.equal([95, 100]);
  });

  it('emits five descending countdown steps without per-frame duplicates', function() {
    const events = [];
    const system = new ActionCountdownSystem({ GetMask: () => ({ GetMask: () => null }) });
    system.runtime = { soundEvents: { emitSfx: (type, sfxId, data) => events.push({ type, sfxId, ...data }) } };
    const lem = new Lemming(0, 0, 1);
    system.triggerLemAction(lem);
    for (let tick = 0; tick < 80; tick++) system.process({}, lem);
    const countdowns = events.filter(event => event.sfxId === SoundEffectIds.COUNTDOWN);
    expect(countdowns.map(event => event.countdownNumber)).to.deep.equal([5, 4, 3, 2, 1]);
    const mapping = new MidiMapping({ sfx: { [SoundEffectIds.COUNTDOWN]: { note: 60 } } });
    expect(countdowns.map(event => mapping.mapEvent(event).note)).to.deep.equal([72, 69, 66, 63, 60]);
  });

  it('rises on frequent real fire events, trills at the top, then resets after a quiet gap', function() {
    withFakeClockAndPerformance(() => {
      const calls = [];
      const router = new MidiEventRouter({ mpe: { enabled: false }, sfx: { 13: { note: 60, durationTicks: 1 } } });
      router.setOutput(makeOutput([1], calls));
      const bus = new SoundEventBus();
      router.attach(bus);
      for (let tick = 0; tick < 12; tick++) bus.emit({ type: 'lemming-fire', sfxId: 13, tick });
      const notes = calls.filter(call => call.type === 'noteOn').map(call => call.note);
      expect(notes).to.deep.equal([60, 63, 66, 69, 72, 75, 78, 81, 78, 81, 78, 81]);
      bus.emit({ type: 'lemming-fire', sfxId: 13, tick: 100 });
      expect(calls.filter(call => call.type === 'noteOn').at(-1).note).to.equal(60);
      router.detach();
      expect(router._arpStateBySfx.size).to.equal(0);
      router.dispose();
    });
  });

  it('does not change shared external channels for spatial pan but keeps explicit CC pan', function() {
    withFakeClockAndPerformance(() => {
      const calls = [];
      const scheduler = new MidiScheduler({ mpe: { enabled: false }, position: { panRange: { min: -127, max: 127 } } });
      scheduler.setOutput(makeOutput([1], calls));
      scheduler.sendNote({ note: 60, pan: -127, spatialPan: true, durationTicks: 2 });
      expect(calls.filter(call => call.type === 'cc' && call.cc === 10)).to.have.length(0);
      scheduler.sendNote({ note: 67, pan: 127, durationTicks: 2 });
      expect(calls.filter(call => call.type === 'cc' && call.cc === 10).at(-1).value).to.equal(127);
      scheduler.dispose();
    });
  });
});
