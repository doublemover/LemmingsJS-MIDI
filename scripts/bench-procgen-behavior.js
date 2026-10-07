import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as ActualEngine from '../js/exports.js';
import { getAppContext, setAppContext, getDependency, setDependency, clearDependency } from '../js/core/dependencies.js';
import { Level } from '../js/level/Level.js';
import { LemmingManager } from '../js/lemmings/LemmingManager.js';
import { LemmingStateType } from '../js/lemmings/LemmingStateType.js';
import { TriggerManager } from '../js/level/TriggerManager.js';
import { GameVictoryCondition } from '../js/game/GameVictoryCondition.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import { ProcgenController } from '../js/app/procgenController.js';
import { createSeededRandom } from '../js/core/seededRandom.js';
import { procgenAiDirectorMethods as baseline } from '../test/fixtures/procgen/ProcgenAiDirector.baseline.js';
import { loadProcgenMasks } from './bench-procgen-lanes.js';

const runBehaviorFixtureImpl = ({ masks, fixture = 'retired-blocker', policy = 'current', ticks = 600, seed = 42 } = {}) => {
  const level = new Level(640, 160);
  level.groundImage = new Uint8ClampedArray(level.width * level.height * 4);
  level.colorPalette = new ColorPalette(); level.releaseCount = 1; level.releaseRate = 50;
  level.setGroundRect(0, 100, 640, 12, 1);
  if (fixture === 'shallow-step') { level.setGroundRect(0, 99, 70, 1, 1); }
  if (fixture === 'pit') { level.setGroundRect(50, 60, 10, 40, 1); level.setGroundRect(108, 60, 10, 40, 1); }
  let tick = 0;
  const timer = { getGameTicks: () => tick };
  const triggers = new TriggerManager(timer, level.width, level.height);
  const victory = new GameVictoryCondition(level); victory.leftCount = 0;
  const manager = new LemmingManager(level, null, triggers, victory, masks, null);
  manager.addLemming(fixture === 'shallow-step' ? 74 : 86, 99);
  const actor = manager.lemmings[0]; actor.lookRight = fixture !== 'shallow-step';
  manager.setLemmingState(actor, fixture === 'retired-blocker' ? LemmingStateType.BLOCKING : LemmingStateType.WALKING);
  const game = { getLemmingManager: () => manager, getGameTimer: () => timer };
  const controller = new ProcgenController({ game, level, options: { rng: createSeededRandom(seed), rngSeed: seed } });
  if (policy === 'baseline') Object.assign(controller, baseline);
  controller._initAiDirector(); controller._rebuildHazardIndex();
  const startX = actor.x;
  let farthestX = actor.x, stoppedTicks = 0, lastX = actor.x, goal = false;
  const start = performance.now();
  for (tick = 1; tick <= ticks; tick++) {
    controller._updateAiDirector(); if (tick % 17 === 0) controller._updateAiBudget(1);
    manager.tick();
    if (!actor.removed) { farthestX = Math.max(farthestX, actor.x); stoppedTicks = actor.x <= lastX ? stoppedTicks + 1 : 0; lastX = actor.x; }
    if (actor.x > 240) { goal = true; break; }
    if (actor.removed) break;
  }
  const result = { fixture, seed, policy, rendered: false, ticks: Math.min(tick, ticks), elapsedMs: performance.now() - start,
    distance: farthestX - startX, reachedGoal: goal, survival: +!actor.removed,
    stoppedTicks, action: actor.action?.getActionName?.() || 'removed', assists: controller._recentAssists.filter(a => a.type === 'skill').map(a => ({ action: a.action, reason: a.reason })) };
  manager.dispose(); return result;
};
const runBehaviorFixture = options => {
  const previous = getAppContext(), absent = Symbol('absent'), overrides = [];
  for (const [key, value] of Object.entries(ActualEngine)) if (key.startsWith('Action') || key === 'Lemming') {
    overrides.push([key, getDependency(key, absent)]); setDependency(key, value);
  }
  setAppContext({ gameSpeedFactor: 1 });
  try { return runBehaviorFixtureImpl(options); } finally {
    setAppContext(previous);
    for (const [key, value] of overrides) { if (value === absent) clearDependency(key); else setDependency(key, value); }
  }
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const masks = await loadProcgenMasks();
  const results = [];
  for (const fixture of ['retired-blocker', 'shallow-step', 'pit']) for (const policy of ['baseline', 'current']) results.push(runBehaviorFixture({ masks, fixture, policy }));
  console.log(JSON.stringify({ baselineCommit: '059a4cab7cbe9c6bc3adda17036590d19d1a5248', physics: 'real Level + LemmingManager + original action systems', results }, null, 2));
}
export { runBehaviorFixture };
