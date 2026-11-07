import { SOLVER_EXPLANATION_CODES as CODES, SOLVER_RESULT_TYPES as TYPES, createSolverResult, normalizeSolverOptions, createBudgetMeter } from './SolverTypes.js';
import { planSolverRoute } from './RoutePlanner.js';
import { validateSaveCountForResult } from './SolverCrowd.js';
import { stableHash } from './SolverState.js';
import { SyntheticSolverRunner, createRunnerFromSource, verifyActionReplay } from './SolverRunner.js';

const bounds = action => action.tick == null ? action.window : { start: action.tick, end: action.tick };
const scriptKey = actions => stableHash(actions.map(action => ({ skillType: action.skillType, target: action.target, bounds: bounds(action),
  preconditions: action.preconditions, expectedPostconditions: action.expectedPostconditions })));
const ownerOf = value => { const runner = value?.runner || value; return runner?.runtime || runner?.runner || runner; };

export function runBoundedTimingSearch(source, routeOrInput, options, buildScript) {
  const normalized = normalizeSolverOptions(options), meter = createBudgetMeter(normalized, options.now);
  const stats = { nodes: 0, ticksConsidered: 0, actionsConsidered: 0, candidatesVisited: 0, candidatesReplayed: 0,
    prunedEquivalentStates: 0, prunedImpossiblePreconditions: 0, prunedDominatedScripts: 0, retainedStates: 0, bestFailureReason: null };
  const planned = routeOrInput?.kind === 'solver-route-skeleton' || routeOrInput?.routeSkeleton ? null : planSolverRoute(routeOrInput ?? source, options);
  const route = routeOrInput?.kind === 'solver-route-skeleton' ? routeOrInput : routeOrInput?.routeSkeleton ?? planned?.routeSkeleton;
  if (planned) { meter.recordNode(planned.budgetUsage.nodes); stats.nodes += planned.budgetUsage.nodes; }
  const finish = result => { result.routeSkeleton = route || null; result.timingSearchStats = { ...stats, wallTimeMs: meter.usage().wallTimeMs };
    result.budgetUsage = { ...result.budgetUsage, nodes: stats.nodes, ticks: stats.ticksConsidered, wallTimeMs: meter.usage().wallTimeMs }; return result; };
  const result = (type, summary, code, actions = []) => finish(createSolverResult({ resultType: type, summary, actions, explanations: code ? [code] : [] }));
  const timeout = () => result(TYPES.TIMEOUT, 'Timing search exhausted a declared work budget', CODES.BUDGET_EXHAUSTED);
  if (!route) return planned ? finish(planned) : result(TYPES.FAILED, 'Timing search has no route skeleton', CODES.NO_ROUTE_TO_EXIT);
  let actions;
  try { actions = buildScript(route, normalized.maxActions); } catch (error) { return result(TYPES.UNSUPPORTED, error.message, CODES.UNSUPPORTED_MECHANIC); }
  if (actions.length > normalized.maxActions) return timeout();
  if (actions.some(action => !action.window || !Number.isSafeInteger(action.window.start) || !Number.isSafeInteger(action.window.end) || action.window.start < 0 || action.window.end < action.window.start)) {
    stats.prunedImpossiblePreconditions++; stats.bestFailureReason = CODES.TIMING_WINDOW_TOO_NARROW;
    return result(TYPES.FAILED, 'Timing search found an impossible action window', CODES.TIMING_WINDOW_TOO_NARROW, actions);
  }
  if (options.verify === false) {
    stats.nodes++; stats.candidatesVisited++; stats.actionsConsidered += actions.length;
    if (stats.nodes > normalized.maxNodes || meter.usage().wallTimeMs > normalized.maxWallTimeMs) return timeout();
    const candidate = result(TYPES.UNKNOWN, 'Timing candidate generated; runtime replay was explicitly skipped', null, actions);
    candidate.candidateScriptHash = stableHash(actions); return candidate;
  }

  let createTrial;
  if (typeof options.createRunner === 'function') createTrial = options.createRunner;
  else {
    const synthetic = source instanceof SyntheticSolverRunner ? source : (source?.kind === 'synthetic' || source?.fixture?.kind === 'synthetic') ? createRunnerFromSource(source, options).runner : null;
    if (!synthetic) return result(TYPES.UNSUPPORTED, 'Timing alternatives require an isolated runner factory for this runtime', CODES.MISSING_RUNTIME_ADAPTER);
    const initial = synthetic.forkForSearch(options); createTrial = () => initial.forkForSearch(options);
  }
  const seenScripts = new Set(), continuations = new Map(), owners = new WeakSet(), originalOwner = ownerOf(source);
  let labels = 0, best = null, baseline = null;
  const dominates = (a, b) => a.actions <= b.actions && [...new Set([...Object.keys(a.inventory), ...Object.keys(b.inventory)])].every(skill => (a.inventory[skill] || 0) >= (b.inventory[skill] || 0));
  const finalConditions = actions.map(action => action.expectedPostconditions);
  const observe = ({ runner, actionQueue, nextActionIndex, appliedActions }) => {
    const state = runner.getSearchState?.();
    if (!state || typeof state.key !== 'string' || state.key.length > 1024 || !state.inventory || Object.keys(state.inventory).length > 32 ||
        Object.values(state.inventory).some(value => !Number.isSafeInteger(value) || value < 0)) return null;
    const remaining = actionQueue.slice(nextActionIndex).map(item => ({ skillType: item.action.skillType, target: item.action.target,
      start: Math.max(runner.tick, item.start), end: item.end, preconditions: item.action.preconditions, expectedPostconditions: item.action.expectedPostconditions }));
    const key = stableHash([state.key, remaining, finalConditions]), current = { inventory: { ...state.inventory }, actions: appliedActions.length };
    const previous = continuations.get(key) || [], covering = previous.find(value => dominates(value, current));
    if (covering) {
      if (dominates(current, covering)) { stats.prunedEquivalentStates++; return 'equivalent'; }
      stats.prunedDominatedScripts++; return 'resource-dominated';
    }
    const retained = previous.filter(value => !dominates(current, value)); labels -= previous.length - retained.length;
    if (labels < normalized.maxNodes) { retained.push(current); labels++; continuations.set(key, retained); stats.retainedStates = labels; }
    return null;
  };

  const starts = actions.map(action => action.window.start), ends = actions.map(action => Math.min(action.window.end, normalized.maxTicks));
  if (starts.some((tick, index) => tick > ends[index])) return timeout();
  const ticks = [...starts]; let windowCandidate = true, exhausted = false;
  while (!exhausted) {
    if (stats.nodes >= normalized.maxNodes || stats.ticksConsidered >= normalized.maxTicks || meter.usage().wallTimeMs > normalized.maxWallTimeMs) return timeout();
    const candidate = windowCandidate ? actions : actions.map((action, index) => ({ ...action, tick: ticks[index], window: null }));
    if (windowCandidate) windowCandidate = false;
    else {
      let index = ticks.length - 1;
      while (index >= 0 && ticks[index] >= ends[index]) { ticks[index] = starts[index]; index--; }
      if (index < 0) exhausted = true; else ticks[index]++;
    }
    stats.nodes++; meter.recordNode(); stats.candidatesVisited++; stats.actionsConsidered += candidate.length;
    if (candidate.some((action, index) => index && bounds(action).start < bounds(candidate[index - 1]).start)) { stats.prunedImpossiblePreconditions++; continue; }
    const key = scriptKey(candidate);
    if (seenScripts.has(key)) { stats.prunedEquivalentStates++; continue; } seenScripts.add(key);
    let trial = null, owned = false, replay, retirementFailure = null;
    try {
      trial = createTrial({ attempt: stats.candidatesReplayed, candidateHash: key }); const owner = ownerOf(trial), runner = trial?.runner || trial;
      if (!owner || typeof owner !== 'object' || owner === originalOwner || owners.has(owner)) return result(TYPES.UNSUPPORTED, 'Runner factory reused a mutable source; no further replay was applied', CODES.MISSING_RUNTIME_ADAPTER);
      owners.add(owner); owned = true;
      const initial = runner.getSearchState?.();
      if (initial) { const identity = stableHash(initial); if (baseline != null && identity !== baseline) return result(TYPES.UNSUPPORTED, 'Runner factory changed the initial search state', CODES.REPLAY_DIVERGED); baseline = identity; }
      if (meter.usage().wallTimeMs > normalized.maxWallTimeMs) return timeout();
      const remainingNodes = normalized.maxNodes - stats.nodes;
      if (remainingNodes <= 0) return timeout();
      stats.candidatesReplayed++;
      replay = verifyActionReplay(trial, candidate, { ...normalized, maxSnapshotPixels: options.maxSnapshotPixels, now: options.now,
        maxNodes: remainingNodes, maxTicks: normalized.maxTicks - stats.ticksConsidered,
        maxWallTimeMs: Math.max(1, normalized.maxWallTimeMs - meter.usage().wallTimeMs), onSearchContinuation: observe });
    } catch (error) {
      replay = createSolverResult({ resultType: TYPES.UNSUPPORTED, summary: `Isolated replay could not run: ${String(error.message || error).slice(0, 256)}`,
        actions: candidate, explanations: [CODES.MISSING_RUNTIME_ADAPTER] });
    } finally {
      if (owned) {
        const dispose = trial?.dispose || trial?.runner?.dispose;
        if (dispose) { try { const receipt = dispose.call(trial.dispose ? trial : trial.runner);
          if (receipt?.then || receipt?.completion?.then && receipt.outcome !== 'complete') { Promise.resolve(receipt.completion || receipt).catch(() => {}); retirementFailure = 'asynchronous runner retirement'; }
        } catch { retirementFailure = 'runner retirement failed'; } }
      }
    }
    stats.nodes += replay.budgetUsage.nodes; stats.ticksConsidered += replay.budgetUsage.ticks;
    if (retirementFailure) return result(TYPES.UNSUPPORTED, retirementFailure, CODES.MISSING_RUNTIME_ADAPTER);
    if (stats.nodes > normalized.maxNodes || stats.ticksConsidered > normalized.maxTicks || meter.usage().wallTimeMs > normalized.maxWallTimeMs) return timeout();
    stats.bestFailureReason = replay.explanations[0]?.code || stats.bestFailureReason;
    if (options.crowd) replay = validateSaveCountForResult(replay, options.crowd, normalized);
    replay.candidateScriptHash = stableHash(candidate);
    if (replay.resultType === TYPES.SOLVED || replay.resultType === TYPES.UNKNOWN && !replay.searchPruned) return finish(replay);
    if (replay.resultType === TYPES.TIMEOUT || replay.resultType === TYPES.UNSUPPORTED) return finish(replay);
    if (!replay.searchPruned) {
      const quality = value => [value?.replaySummary?.savedCount || 0, value?.replaySummary?.appliedActions?.length || 0, value?.replaySummary?.tick || 0];
      const next = quality(replay), previous = quality(best), firstDifferent = next.findIndex((value, index) => value !== previous[index]);
      if (!best || firstDifferent >= 0 && next[firstDifferent] > previous[firstDifferent]) best = replay;
    }
  }
  return best ? finish(best) : result(TYPES.FAILED, 'All admissible timing alternatives were equivalent, dominated or impossible', stats.bestFailureReason || CODES.REPLAY_DIVERGED);
}
