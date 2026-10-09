import { expect } from 'chai';
import { Game } from '../../js/game/Game.js';
import { GameTimer } from '../../js/game/GameTimer.js';
import { GameVictoryCondition } from '../../js/game/GameVictoryCondition.js';
import { GameSkills } from '../../js/game/GameSkills.js';
import { HistoryStore } from '../../js/game/HistoryStore.js';
import { TimeTravelController } from '../../js/game/TimeTravelController.js';
import { SoundEventBus, SoundEffectIds } from '../../js/game/SoundEvents.js';
import { createGameRuntime } from '../../js/game/GameRuntime.js';
import { Level } from '../../js/level/Level.js';
import { TriggerManager } from '../../js/level/TriggerManager.js';
import { LemmingManager } from '../../js/lemmings/LemmingManager.js';
import * as actualLemmingDependencies from '../../js/lemmings/lemming-manager/LemmingManagerShared.js';
import { clearDependency, getDependency, setDependency } from '../../js/core/dependencies.js';
import { LemmingStateType as State } from '../../js/lemmings/LemmingStateType.js';
import { MidiEventRouter } from '../../js/midi/MidiEventRouter.js';
import { MidiOutputCapture } from '../../js/midi/capture/MidiOutputCapture.js';
import { loadProcgenMasks } from '../../scripts/bench-procgen-lanes.js';
import { spriteStub, particleStub } from '../helpers/lemming-manager.js';
import { makeOutput } from '../support/midi-output.js';
import { withFakeClockAndPerformance } from '../support/timers.js';

const mapping = {
  enabled: true, mpe: { enabled: false }, noteRange: { min: 0, max: 127 }, velocityRange: { min: 1, max: 127, default: 80 },
  durationTicks: { min: 1, max: 960, default: 1 }, position: { mappings: [], viewPan: false, panRange: { min: -127, max: 127 } },
  density: { velocityBoost: 0, durationScale: 0 }, timing: { bpmBase: 120, scheduleAheadMs: 0 },
  limits: { maxEventsPerSecond: 1000, maxBytesPerSecond: 100000, maxEventsPerTick: 32 },
  sfx: { [SoundEffectIds.SPAWN]: { enabled: false }, [SoundEffectIds.LAND]: { notes: [60, 64, 67], durationTicks: 1, velocity: 80,
    phrase: { enabled: true, mode: 'up', spacingTicks: 2 } } },
  automationSpans: [{ id: 'travel', enabled: true, target: 'pan', min: -100, max: 100,
    span: { domain: 'distance', start: 0, duration: 100, shape: 'ramp', loop: false, condition: { sfxId: SoundEffectIds.LAND } } }]
};
// Legacy manager tests install root hooks with stationary actions. Pin only
// this fixture's real constructors, then restore each registry entry exactly.
const withActualLemmingDependencies = run => {
  const absent = Symbol('absent dependency'), previous = new Map();
  for (const [key, value] of Object.entries(actualLemmingDependencies)) {
    if (key !== 'Lemming' && !(key.startsWith('Action') && key.endsWith('System'))) continue;
    previous.set(key, getDependency(key, absent)); setDependency(key, value);
  }
  try { return run(); }
  finally {
    for (const [key, value] of previous) {
      if (value === absent) clearDependency(key);
      else setDependency(key, value);
    }
  }
};
const withGame = (masks, run) => withActualLemmingDependencies(() => withFakeClockAndPerformance(clock => {
  // Production Game, timer, manager, terrain and action owners; sprite drawing
  // and the MIDI API endpoint are the only presentation/output substitutes.
  const game = new Game({}), level = new Level(256, 96);
  Object.assign(level, { name: 'Main distance span fixture', releaseCount: 2, needCount: 1, timeLimit: 5 });
  for (let y = 72; y < 96; y++) for (let x = 0; x < 256; x++) level.groundMask.setGroundAt(x, y);
  game.level = level; game.gameTimer = new GameTimer(level); game.soundEvents = new SoundEventBus(game.gameTimer);
  game.runtime = createGameRuntime(game, null); level.setRuntime(game.runtime);
  game.gameVictoryCondition = new GameVictoryCondition(level); game.skills = new GameSkills(level);
  game.triggerManager = new TriggerManager(game.gameTimer, level.width, level.height, 16, game.runtime);
  game.lemmingManager = new LemmingManager(level, spriteStub, game.triggerManager, game.gameVictoryCondition, masks, particleStub, game.runtime);
  const timer = game.gameTimer, manager = game.lemmingManager;
  timer.onGameTick.on(game._boundTick); timer.tick(1); // One real empty completion binds the exact main source before release.
  manager.addLemming(10, 71); game.gameVictoryCondition.releaseOne(); const actor = manager.getLemming(0);
  game.history = new HistoryStore({ keyframeInterval: 5 }); game.history.attach(game, { captureBaseline: false }); game.soundEvents.setHistoryStore(game.history);
  game.timeTravel = new TimeTravelController(game, game.history); timer.setTimeTravelController(game.timeTravel); game.history.start();
  const calls = [], output = makeOutput([1, 2, 3, 4, 10], calls, 'fake-local'); output.supportsPerNoteInstrument = true; output.supportsPerNotePan = true;
  const router = new MidiEventRouter(mapping), capture = new MidiOutputCapture(); capture.start(); router.setCapture(capture); router.setOutput(output); router.attach(game.soundEvents, { game });
  const advance = count => { for (let index = 0; index < count; index++) { clock.tick(timer.frameTime); timer.tick(1); } };
  const records = () => capture.snapshot().records.filter(record => record.stage === 'api-dispatch' && record.type === 'noteOn');
  const ons = () => calls.filter(call => call.type === 'noteOn');
  try { run({ game, timer, manager, actor, router, capture, clock, advance, records, ons }); }
  finally { router.dispose(); game.stop(); }
}));

describe('actual main Game queued distance spans', function() {
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('uses real landing origin then moving completed WALK positions for each queued cell without retaining live references', () => {
    withGame(masks, ({ game, actor, router, advance, records, ons }) => {
      expect(game.getLaneMusicActorPosition(actor.id)).to.equal(null); advance(1);
      expect(actor.action).to.equal(game.lemmingManager.actions[State.WALKING]); expect(actor).to.include({ x: 10, y: 72, canClimb: false, hasParachute: false });
      expect(game.getLaneMusicActorPosition(actor.id, 0)).to.include({ x: 10, y: 72, tick: 2, generation: game.generation }); advance(4);
      expect(actor.x).to.equal(14); expect(game.getLaneMusicActorPosition(actor.id, 1)).to.equal(null);
      expect(ons().map(call => Math.round(call.opts.pan * 127))).to.deep.equal([-80, -76, -72]);
      const sent = records(); expect(sent.map(record => record.eventType)).to.deep.equal(['lemming-land', 'lemming-land', 'lemming-land']);
      expect(sent.map(record => record.eventWorldX)).to.deep.equal([10, 10, 10]); expect(sent.map(record => record.automationDistance)).to.deep.equal([10, 12, 14]);
      expect(sent.map(record => record.distanceSource)).to.deep.equal(['event-origin', 'completed-actor', 'completed-actor']);
      expect(router.getAutomationSpanState('travel')).to.include({ eventCount: 1, originEventCount: 1, distance: 14, distanceSource: 'completed-actor' });
      advance(2); expect(actor.x).to.equal(16); expect(sent.map(record => record.automationDistance)).to.deep.equal([10, 12, 14]);
    });
  });
  it('keeps phase/positions static during real timer pause and removes queued cells on Panic', () => {
    withGame(masks, ({ game, actor, timer, router, advance, clock, records }) => {
      advance(1); timer.suspend(); const position = { ...game.getLaneMusicActorPosition(actor.id) }, phase = router.getAutomationSpanState('travel');
      clock.tick(5000); expect(game.getLaneMusicActorPosition(actor.id)).to.deep.equal(position); expect(router.getAutomationSpanState('travel')).to.deep.equal(phase);
      expect(records()).to.have.length(1); expect(router.scheduler.gamePhrases.voices.size).to.equal(1);
      advance(2);
      expect(records().map(record => record.automationDistance)).to.deep.equal([10, 12]);
      router.scheduler.allNotesOff(); expect(router.scheduler._activeNotes.size).to.equal(0); expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      advance(4); expect(records()).to.have.length(2);
    });
  });
  it('invalidates completed positions during actual history rewind and cancels old-generation queued tails on the next observed tick', () => {
    withGame(masks, ({ game, actor, timer, router, advance, records }) => {
      advance(3); const generation = game.generation; expect(actor.x).to.equal(12); expect(records()).to.have.length(2);
      timer.tick(-2); expect(timer.getGameTicks()).to.equal(2); expect(game.lemmingManager.getLemming(actor.id).x).to.equal(10);
      expect(game.generation).to.be.greaterThan(generation); expect(game.getLaneMusicActorPosition(actor.id)).to.equal(null);
      advance(1); expect(game.getLaneMusicActorPosition(actor.id)).to.include({ x: 11, tick: 3, generation: game.generation });
      expect(router.getAutomationSpanState('travel')).to.equal(null); expect(router.scheduler.gamePhrases.voices.size).to.equal(0);
      advance(4); expect(records()).to.have.length(2);
    });
  });
  it('labels original event distance when the actual queued actor has been removed', () => {
    withGame(masks, ({ game, actor, manager, advance, records, router }) => {
      advance(1); const id = actor.id; manager.removeOne(actor); expect(game.getLaneMusicActorPosition(id)).to.equal(null); advance(4);
      expect(manager.getLemming(id)).to.equal(null); expect(records().map(record => record.automationDistance)).to.deep.equal([10, 10, 10]);
      expect(records().every(record => record.distanceSource === 'event-origin')).to.equal(true);
      expect(router.getAutomationSpanState('travel')).to.include({ eventCount: 1, originEventCount: 1, distance: 10, distanceSource: 'event-origin' });
    });
  });
});
