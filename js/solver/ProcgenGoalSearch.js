import { ProcgenSolverAdapter, replayProcgenGoal } from './ProcgenSolverAdapter.js';
import { LemmingStateType as State } from '../lemmings/LemmingStateType.js';
import { createSolverResult } from './SolverTypes.js';

const bounded = (value, fallback, minimum, maximum) => Number.isSafeInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
const fingerprint = snapshot => {
  let hash = 2166136261;
  for (const bytes of [snapshot.groundMask, snapshot.steelMask]) for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16) + ':' + JSON.stringify([snapshot.sourceOffset, snapshot.width, snapshot.height, snapshot.lemmings, snapshot.exits, snapshot.skills, snapshot.hazards, snapshot.source, snapshot.workerLimits]);
};

/** Bounded fresh-world action search. No proposed route, catalogue action script or assistant planner is an input. */
const searchProcgenGoal = (factory, options = {}) => {
  if (typeof factory !== 'function') throw new TypeError('Independent procgen search requires a world factory');
  const limits = { maxNodes: bounded(options.maxNodes, 32, 1, 64), maxTicks: bounded(options.maxTicks, 1200, 1, 4096),
    maxActions: bounded(options.maxActions, 4, 0, 8), maxSimulatedTicks: bounded(options.maxSimulatedTicks, 32768, 1, 262144),
    maxWallTimeMs: bounded(options.maxWallTimeMs, 1000, 1, 10000), decisionStride: bounded(options.decisionStride, 8, 1, 16) };
  const started = performance.now(), worlds = new WeakSet(), queue = [[]], seen = new Set(['[]']);
  let initialFingerprint = null, nodes = 0, ticks = 0, actionsUsed = 0, lastSummary = null, timedOut = false;
  const fresh = () => {
    const adapter = factory();
    if (!(adapter instanceof ProcgenSolverAdapter)) throw new TypeError('Independent procgen search requires the real adapter');
    try {
      if (worlds.has(adapter.world) || adapter.tick !== 0 || adapter.bounds.width * adapter.bounds.height > 131072) throw new Error('Procgen search requires fresh bounded initial worlds');
      worlds.add(adapter.world);
      const key = fingerprint(adapter.snapshot());
      if (initialFingerprint != null && key !== initialFingerprint) throw new Error('Procgen search world factory changed its initial state');
      initialFingerprint = key;
      return adapter;
    } catch (error) { adapter.dispose(); throw error; }
  };
  const budgetAvailable = () => ticks < limits.maxSimulatedTicks && performance.now() - started < limits.maxWallTimeMs;
  while (queue.length && nodes < limits.maxNodes && budgetAvailable()) {
    const script = queue.shift(), adapter = fresh(); nodes++;
    let next = 0, rejected = false;
    try {
      while (adapter.tick <= limits.maxTicks && budgetAvailable()) {
        if (next < script.length && adapter.tick === script[next].tick) {
          actionsUsed++; if (!adapter.applyAction(script[next++]).ok) { rejected = true; break; }
        }
        if (adapter.getSavedCount() === adapter.crewCount) {
          if (ticks + adapter.tick > limits.maxSimulatedTicks) { timedOut = true; break; }
          const replay = replayProcgenGoal(fresh, script, { maxTicks: limits.maxTicks, maxNodes: limits.maxTicks, maxActions: limits.maxActions });
          return { ...replay, summary: 'Independent real-actor search ' + replay.resultType + ' the whole-crew physical goal',
            budgetUsage: { nodes, ticks: ticks + replay.budgetUsage.ticks, actions: actionsUsed + replay.budgetUsage.actions, wallTimeMs: performance.now() - started },
            search: { ...limits, intendedRouteHint: false, initialFingerprint } };
        }
        if (adapter.isTerminal() || adapter.tick === limits.maxTicks) break;
        if (next === script.length && script.length < limits.maxActions && adapter.tick % limits.decisionStride === 0 && queue.length + nodes < limits.maxNodes) {
          const actor = adapter.selectLemming('frontier'), world = adapter.world, bounds = adapter.bounds;
          if (actor?.action === world.actions[State.WALKING] && actor.x >= bounds.x + 4 && actor.x + 10 < bounds.x + bounds.width && actor.y >= bounds.y + 12 && actor.y + 4 < bounds.y + bounds.height && world.hasGroundAt(actor.x, actor.y)) {
            const ahead = actor.x + (actor.lookRight ? 1 : -1), obstacle = world.getColumnStepHeight(ahead, actor.y - 7, 8) >= 7 || world.getColumnGapDepth(ahead, actor.y + 1, 3) > 3;
            let descent = false;
            // Candidate discovery reads actual bounded geometry; it does not use
            // the assistant planner or a proposed route/action sequence.
            if (!obstacle && actor.y + 32 < bounds.y + bounds.height) {
              let air = false;
              for (let drop = 1; drop <= 32; drop++) {
                if (!world.hasGroundAt(actor.x, actor.y + drop)) air = true;
                else if (air) {
                  if (drop > 20) for (let dx = 2; dx <= 16; dx += 2) {
                    const x = actor.x + (actor.lookRight ? dx : -dx);
                    if (x < bounds.x || x >= bounds.x + bounds.width) break;
                    if (world.getColumnStepHeight(x, actor.y - 7, 8) >= 7) { descent = true; break; }
                  }
                  break;
                }
              }
            }
            if (obstacle || descent) for (const skillType of obstacle ? ['builder', 'basher', 'digger', 'miner'] : ['digger', 'miner']) {
              if (!adapter.getSkillCount(skillType) || queue.length + nodes >= limits.maxNodes) continue;
              const candidate = [...script, { tick: adapter.tick, target: actor.id, skillType }], key = JSON.stringify(candidate);
              if (!seen.has(key)) { seen.add(key); queue.push(candidate); }
            }
          }
        }
        adapter._advanceWithoutSummary(); ticks++;
      }
      lastSummary = { ...adapter.getFinalStateSummary(), protectedTerrainUnchanged: adapter.protectedTerrainUnchanged() };
      if (!rejected && !budgetAvailable()) timedOut = true;
    } finally { adapter.dispose(); }
  }
  timedOut ||= queue.length > 0 || !budgetAvailable();
  return { ...createSolverResult({ resultType: timedOut ? 'timeout' : 'unknown', summary: 'Bounded independent procgen search did not verify a whole-crew route',
    explanations: [{ code: timedOut ? 'budget-exhausted' : 'no-route-to-exit', detail: 'This finite search does not prove unsolvability.' }],
    budgetUsage: { nodes, ticks, actions: actionsUsed, wallTimeMs: performance.now() - started },
    replaySummary: lastSummary ? { ...lastSummary, authority: 'real-runtime', verifier: 'independent-procgen-search', verified: false } : null }),
  search: { ...limits, intendedRouteHint: false, initialFingerprint } };
};
export { searchProcgenGoal };