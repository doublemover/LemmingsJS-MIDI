import { expect } from 'chai';
import { Game } from '../js/game/Game.js';
import { GameMusicObservations } from '../js/game/GameMusicObservations.js';
import { GameTimer } from '../js/game/GameTimer.js';
import { GameVictoryCondition } from '../js/game/GameVictoryCondition.js';
import { HistoryStore } from '../js/game/HistoryStore.js';
import { TimeTravelController } from '../js/game/TimeTravelController.js';
import { CommandManager } from '../js/commands/CommandManager.js';
import { Level } from '../js/level/Level.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerManager } from '../js/level/TriggerManager.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { LemmingManager } from '../js/lemmings/LemmingManager.js';
import * as actualDependencies from '../js/lemmings/lemming-manager/LemmingManagerShared.js';
import { clearDependency, getDependency, setDependency, getAppContext, setAppContext } from '../js/core/dependencies.js';
import { MidiLaneMusicTension } from '../js/midi/router/MidiLaneMusicTension.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const tensionSettings = { enabled: true, amount: 1, healthyPopulation: 8, healthyTicks: 0, fadeTicks: 4,
  collapseRatio: 0.25, recoveryRatio: 0.6, breakthroughPixels: 48, breakthroughHoldTicks: 12 };

describe('Game completed music observations', function () {
  let masks, previous, priorApp, games;
  const absent = Symbol('absent dependency');
  before(async function () { masks = await loadProcgenMasks(); });
  beforeEach(function () {
    previous = new Map(); priorApp = getAppContext(); setAppContext(null); games = [];
    for (const [key, value] of Object.entries(actualDependencies)) if (key === 'Lemming' || key.startsWith('Action') && key.endsWith('System')) {
      previous.set(key, getDependency(key, absent)); setDependency(key, value);
    }
  });
  afterEach(function () {
    try { for (const game of games) game.stop(); }
    finally {
      for (const [key, value] of previous) { if (value === absent) clearDependency(key); else setDependency(key, value); }
      setAppContext(priorApp);
    }
  });
  const makeGame = ({ trigger = null, positions = 4096 } = {}) => {
    const game = new Game({}), level = new Level(256, 96); games.push(game);
    Object.assign(level, { needCount: 8, releaseCount: 8, releaseRate: 50, timeLimit: 2 });
    level.groundMask.mask.fill(1, 72 * level.width);
    game.level = level; game.gameTimer = new GameTimer(level, { window: {}, document: {} });
    game.gameVictoryCondition = new GameVictoryCondition(level);
    game.commandManager = new CommandManager(game, game.gameTimer);
    game.triggerManager = new TriggerManager(game.gameTimer, level.width, level.height);
    if (trigger != null) game.triggerManager.add(new Trigger(trigger, 20, 60, 24, 78));
    game.lemmingManager = new LemmingManager(level, null, game.triggerManager, game.gameVictoryCondition, masks, null);
    game.musicObservations = new GameMusicObservations({ maxActorPositions: positions });
    game.gameTimer.onGameTick.on(game._boundTick); game.start();
    return game;
  };
  const addActor = (game, x = 12) => {
    game.gameVictoryCondition.releaseOne(); game.lemmingManager.addLemming(x, 72);
    return game.lemmingManager.lemmings[game.lemmingManager.lemmings.length - 1];
  };
  const observeTension = game => {
    const tension = new MidiLaneMusicTension(tensionSettings);
    game.gameTimer.onGameTick.on(() => {
      const tick = game.gameTimer.getGameTicks(); tension.synchronize(game.generation, tick);
      tension.updateLane(0, game.getLaneMusicSignals(0), tick);
    });
    return tension;
  };

  it('publishes real live positions only after a completed tick; lookups preserve the completed snapshot', function () {
    const game = makeGame(), actor = addActor(game), generation = game.generation;
    expect(game.getLaneMusicSignals(0)).to.equal(null); expect(game.getLaneMusicActorPosition(actor.id, 0)).to.equal(null);
    game.gameTimer.tick(3);
    const signal = game.getLaneMusicSignals(0), position = game.getLaneMusicActorPosition(actor.id, 0);
    expect(game.generation).to.equal(generation);
    expect(signal).to.include({ alive: 1, spawned: 1, saved: 0, lowestSurvivingActorId: actor.id, tick: 3 });
    expect(position).to.include({ x: actor.x, y: actor.y, tick: 3, generation });
    Object.defineProperty(game.lemmingManager.activeLemmings, Symbol.iterator, { configurable: true,
      value() { throw new Error('music getters must not scan actors'); } });
    try {
      for (let i = 0; i < 32; i++) { expect(game.getLaneMusicSignals()).to.equal(signal); expect(game.getLaneMusicActorPosition(actor.id)).to.equal(position); }
    } finally { delete game.lemmingManager.activeLemmings[Symbol.iterator]; }
    const oldX = position.x; actor.x += 3;
    expect(game.getLaneMusicActorPosition(actor.id).x).to.equal(oldX);
    expect(game.getLaneMusicActorPosition(actor.id, 1)).to.equal(null); expect(game.getLaneMusicSignals(1)).to.equal(null);
    game.gameTimer.tick(); expect(game.getLaneMusicActorPosition(actor.id).x).to.equal(actor.x);
    expect(game.gameTimer.getGameTicks()).to.equal(4);
  });

  it('treats actual exit transitions and delayed survivor tallies as successful departures without collapse', function () {
    const game = makeGame({ trigger: TriggerTypes.EXIT_LEVEL }), tension = observeTension(game);
    for (let i = 0; i < 8; i++) addActor(game);
    game.gameTimer.tick(3); expect(tension.snapshot().established).to.equal(true);
    let exitSeen = false;
    for (let i = 0; i < 24; i++) {
      game.gameTimer.tick(); const signal = game.getLaneMusicSignals();
      if (signal.exiting && !signal.saved) {
        exitSeen = true; expect(signal).to.include({ alive: 0, exiting: 8, successfulDepartures: 8, dead: 0 });
        expect(game.getLaneMusicActorPosition(0)).to.equal(null);
        expect(tension.snapshot()).to.include({ baseline: 0, strength: 0, survival: 1 });
      }
      expect(tension.snapshot().strength).to.equal(0);
    }
    expect(exitSeen).to.equal(true); expect(game.gameVictoryCondition.getSurvivorsCount()).to.equal(8);
    expect(game.getLaneMusicSignals()).to.include({ active: 0, alive: 0, saved: 8, successfulDepartures: 8, dead: 0 });
  });

  it('thins after real shared lethal actions while preserving the actual lowest survivor; a small startup crew stays uncollapsed', function () {
    const game = makeGame({ trigger: TriggerTypes.KILL }), tension = observeTension(game);
    const survivor = addActor(game, 100);
    for (let i = 0; i < 7; i++) addActor(game);
    game.gameTimer.tick(3); expect(tension.snapshot().established).to.equal(true);
    game.gameTimer.tick(18);
    const signal = game.getLaneMusicSignals();
    expect(signal).to.include({ alive: 1, successfulDepartures: 0, lowestSurvivingActorId: survivor.id });
    expect(signal.dead + signal.dying).to.equal(7);
    expect(tension.snapshot()).to.include({ strength: 1, reason: 'population-decline', soloActorId: survivor.id, baseline: 8 });
    expect(game.getLaneMusicActorPosition(1)).to.equal(null);
    const small = makeGame(), smallTension = observeTension(small); addActor(small);
    small.gameTimer.tick(20); expect(smallTension.snapshot()).to.include({ established: false, strength: 0, reason: 'startup' });
  });

  it('bounds position storage, reuses retired records and retains actual crew aggregates beyond the position cap', function () {
    const game = makeGame({ positions: 2 });
    for (let i = 0; i < 8; i++) addActor(game);
    game.gameTimer.tick(3);
    expect(game.getLaneMusicSignals()).to.include({ alive: 8, positionCount: 2, positionsTruncated: true });
    const oldRecord = game.musicObservations.positions.get(0);
    game.lemmingManager.removeOne(game.lemmingManager.getLemming(0)); game.gameTimer.tick();
    expect(game.musicObservations.positions.size).to.equal(2);
    expect([...game.musicObservations.positions.values()]).to.include(oldRecord);
    expect(game.getLaneMusicActorPosition(0)).to.equal(null);
    expect(game.musicObservations.positions.size + game.musicObservations.positionPool.length).to.equal(2);
    game.invalidateMusicObservations();
    expect(game.musicObservations.positions.size).to.equal(0); expect(game.musicObservations.positionPool).to.have.length(2);
    expect(game.musicObservations.positionPool.every(record => record.actor === null)).to.equal(true);
  });

  it('invalidates rewind and same-tick seek restoration until a new completed observation, with level-relative beats', function () {
    const game = makeGame(); addActor(game);
    game.history = new HistoryStore({ keyframeInterval: 2 }); game.history.attach(game, { captureBaseline: false });
    game.timeTravel = new TimeTravelController(game, game.history); game.gameTimer.setTimeTravelController(game.timeTravel); game.history.start();
    game.gameTimer.tick(6); let generation = game.generation;
    const x = game.getLaneMusicActorPosition(0).x;
    game.timeTravel.stepBackward(); expect(game.gameTimer.getGameTicks()).to.equal(5);
    expect(game.generation).to.be.greaterThan(generation); expect(game.getLaneMusicActorPosition(0)).to.equal(null);
    game.gameTimer.tick(); expect(game.getLaneMusicActorPosition(0).x).to.equal(x);
    generation = game.generation;
    game.timeTravel.seekToTick(6); expect(game.gameTimer.getGameTicks()).to.equal(6);
    expect(game.generation).to.be.greaterThan(generation); expect(game.getLaneMusicSignals()).to.equal(null);
    expect(game.generationStartTick).to.equal(0);
    game.gameTimer.tick(); expect(game.getLaneMusicActorPosition(0).tick).to.equal(7);
    game.timeTravel.seekToTick(2); game.timeTravel.seekToTick(7); expect(game.getLaneMusicActorPosition(0)).to.equal(null);
    game.gameTimer.tick(); expect(game.getLaneMusicActorPosition(0).tick).to.equal(8);
  });

  it('binds new exact timer identities before start events and invalidates same-object level changes', function () {
    const game = makeGame(); addActor(game); game.gameTimer.tick(3); let generation = game.generation;
    const oldTimer = game.gameTimer; game.gameTimer = new GameTimer(game.level, { window: {}, document: {} });
    expect(game.getLaneMusicSignals()).to.equal(null); oldTimer.stop();
    game.gameTimer.onGameTick.on(game._boundTick); game.start();
    expect(game.generation).to.be.greaterThan(generation); generation = game.generation;
    game.gameTimer.tick(); expect(game.generation).to.equal(generation);
    const replacement = new Level(256, 96); replacement.groundMask.mask.fill(1, 72 * replacement.width);
    game.level = replacement; expect(game.getLaneMusicActorPosition(0)).to.equal(null);
    game.start(); expect(game.generation).to.be.greaterThan(generation); expect(game.getLaneMusicSignals()).to.equal(null);
  });

  it('rejects stale/removed/unavailable same-source observations and releases source identities on disposal', function () {
    const game = makeGame(), actor = addActor(game); game.gameTimer.tick(3);
    game.lemmingManager.removeOne(actor); expect(game.getLaneMusicActorPosition(0)).to.equal(null);
    game.lemmingManager.activeLemmings = null; expect(game.getLaneMusicSignals()).to.equal(null);
    game.musicObservations.update(game); expect(game.musicObservations.positions.size).to.equal(0);
    game._disposeCurrentLevel(); expect(game.getLaneMusicSignals()).to.equal(null);
    expect(game.musicObservations.manager).to.equal(null); expect(game.musicObservations.timer).to.equal(null);
    const minimal = new Game({}); games.push(minimal);
    minimal.level = {}; minimal.gameTimer = { getGameTicks: () => 1, stop() {} }; minimal.lemmingManager = { tick() {} };
    minimal.runGameLogic(); expect(minimal.getLaneMusicSignals()).to.equal(null);
  });
});
