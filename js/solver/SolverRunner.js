import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult,
  normalizeActionScriptAction,
  normalizeSolverOptions
} from './SolverTypes.js';

const SYNTHETIC_RUNNER_KIND = 'synthetic';

const cloneRectList = value => Array.isArray(value)
  ? value.map(rect => ({ ...rect }))
  : [];

const toInteger = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.floor(next) : fallback;
};

const getSourceKind = source => {
  if (source?.kind === SYNTHETIC_RUNNER_KIND || source?.fixture?.kind === SYNTHETIC_RUNNER_KIND) {
    return SYNTHETIC_RUNNER_KIND;
  }
  const raw = String(source?.kind ?? source?.type ?? source?.sourceKind ?? '').trim().toLowerCase();
  if (raw === 'editor' || raw === 'editor-level') return 'editor';
  if (raw === 'procgen' || raw === 'procgen-chunk') return 'procgen';
  if (raw === 'builtin' || raw === 'built-in') return 'builtin';
  return raw || 'unknown';
};

const createUnsupportedRunnerResult = (sourceKind, detail = 'Solver runner source is not wired yet') => ({
  sourceKind,
  runner: null,
  result: createSolverResult({
    resultType: SOLVER_RESULT_TYPES.UNSUPPORTED,
    summary: `${sourceKind} solver runner is not supported yet`,
    explanations: [{
      code: SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC,
      detail
    }]
  })
});

const cloneMask = (mask, width, height) => {
  const size = Math.max(0, width * height);
  if (mask instanceof Uint8Array) return new Uint8Array(mask);
  if (Array.isArray(mask)) return Uint8Array.from(mask.slice(0, size));
  return new Uint8Array(size);
};

const cloneSkills = skills => {
  const out = {};
  if (skills == null || typeof skills !== 'object') return out;
  for (const [key, value] of Object.entries(skills)) {
    const count = Number(value);
    out[key] = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  }
  return out;
};

const cloneLemming = (lemming, index) => ({
  id: lemming?.id ?? index,
  x: toInteger(lemming?.x, 0),
  y: toInteger(lemming?.y, 0),
  lookRight: lemming?.lookRight !== false,
  action: String(lemming?.action || 'walking'),
  saved: Boolean(lemming?.saved),
  dead: Boolean(lemming?.dead),
  fallDistance: Math.max(0, toInteger(lemming?.fallDistance, 0)),
  lastSkill: lemming?.lastSkill == null ? null : String(lemming.lastSkill)
});

const hashSummary = value => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

class SyntheticSolverRunner {
  constructor(fixture = {}, options = {}) {
    const width = Math.max(1, toInteger(fixture.width, 1));
    const height = Math.max(1, toInteger(fixture.height, 1));
    this.kind = SYNTHETIC_RUNNER_KIND;
    this.id = String(fixture.id || SYNTHETIC_RUNNER_KIND);
    this.width = width;
    this.height = height;
    this.groundMask = cloneMask(fixture.groundMask, width, height);
    this.steelMask = cloneMask(fixture.steelMask, width, height);
    this.oneWay = cloneRectList(fixture.oneWay);
    this.hazards = cloneRectList(fixture.hazards);
    this.entrances = cloneRectList(fixture.entrances);
    this.exits = cloneRectList(fixture.exits);
    this.skills = cloneSkills(fixture.skills);
    this.lemmings = Array.isArray(fixture.lemmings)
      ? fixture.lemmings.map(cloneLemming)
      : [];
    this.needCount = Math.max(0, toInteger(fixture.needCount, 1));
    this.releaseCount = Math.max(0, toInteger(fixture.releaseCount, this.lemmings.length));
    this.tick = Math.max(0, toInteger(fixture.timer?.tick, 0));
    this.options = normalizeSolverOptions(options);
    this.builderLength = Math.max(1, toInteger(options.builderLength, 12));
    this.maxSurvivableFall = Math.max(1, toInteger(options.maxSurvivableFall, 12));
  }

  getSavedCount() {
    return this.lemmings.filter(lemming => lemming.saved).length;
  }

  getDeadCount() {
    return this.lemmings.filter(lemming => lemming.dead).length;
  }

  getActiveLemmings() {
    return this.lemmings.filter(lemming => !lemming.saved && !lemming.dead);
  }

  getSkillCount(skillType) {
    return this.skills[String(skillType || '')] ?? 0;
  }

  selectLemming(target) {
    const active = this.getActiveLemmings();
    if (target == null) return active[0] ?? this.lemmings[0] ?? null;
    if (typeof target === 'number') return this.lemmings.find(lemming => lemming.id === target) ?? null;
    if (typeof target === 'string') {
      if (target === 'first' || target === 'lead') return active[0] ?? null;
      return this.lemmings.find(lemming => String(lemming.id) === target) ?? null;
    }
    if (typeof target === 'object') {
      if (target.id != null) {
        return this.lemmings.find(lemming => String(lemming.id) === String(target.id)) ?? null;
      }
      if (target.index != null) return this.lemmings[toInteger(target.index, -1)] ?? null;
    }
    return active[0] ?? null;
  }

  isTerminal() {
    return this.getActiveLemmings().length === 0;
  }

  step(count = 1) {
    const safeCount = Math.max(1, toInteger(count, 1));
    for (let i = 0; i < safeCount; i += 1) {
      this.#stepOneTick();
    }
    return this.getFinalStateSummary();
  }

  applyAction(action) {
    const normalized = normalizeActionScriptAction(action);
    const lemming = this.selectLemming(normalized.target);
    if (!lemming || lemming.saved || lemming.dead) {
      return {
        ok: false,
        detail: `No active target lemming for ${normalized.skillType || 'action'}`
      };
    }

    const skillType = String(normalized.skillType || 'wait').toLowerCase();
    if (skillType === 'wait' || skillType === 'noop') {
      lemming.lastSkill = skillType;
      return { ok: true, lemmingId: lemming.id, skillType };
    }
    if (this.getSkillCount(skillType) <= 0) {
      return {
        ok: false,
        detail: `No ${skillType} skill remains`
      };
    }

    if (skillType === 'builder') return this.#applyBuilder(lemming, skillType);
    if (skillType === 'basher') return this.#applyBasher(lemming, skillType);
    if (skillType === 'digger') return this.#applyDigger(lemming, skillType);
    if (skillType === 'miner') return this.#applyMiner(lemming, skillType);
    if (skillType === 'blocker') return this.#applyBlocker(lemming, skillType);

    return {
      ok: false,
      detail: `Synthetic runner does not support ${skillType}`
    };
  }

  getFinalStateSummary() {
    const lemmings = this.lemmings.map(lemming => ({
      id: lemming.id,
      x: lemming.x,
      y: lemming.y,
      lookRight: lemming.lookRight,
      action: lemming.action,
      saved: lemming.saved,
      dead: lemming.dead,
      fallDistance: lemming.fallDistance,
      lastSkill: lemming.lastSkill
    }));
    const summary = {
      sourceKind: this.kind,
      id: this.id,
      tick: this.tick,
      width: this.width,
      height: this.height,
      savedCount: this.getSavedCount(),
      deadCount: this.getDeadCount(),
      activeCount: this.getActiveLemmings().length,
      needCount: this.needCount,
      releaseCount: this.releaseCount,
      skills: { ...this.skills },
      lemmings
    };
    return { ...summary, stateHash: hashSummary(summary) };
  }

  #stepOneTick() {
    for (const lemming of this.lemmings) {
      if (lemming.saved || lemming.dead) continue;
      this.#maybeExit(lemming);
      if (lemming.saved) continue;
      if (this.#isInHazard(lemming.x, lemming.y)) {
        lemming.dead = true;
        lemming.action = 'dead';
        continue;
      }

      const supported = this.#hasSupport(lemming.x, lemming.y);
      if (!supported) {
        this.#fall(lemming);
        continue;
      }

      lemming.fallDistance = 0;
      const dx = lemming.lookRight ? 1 : -1;
      const nextX = lemming.x + dx;
      if (this.#isBlocked(nextX, lemming.y)) {
        lemming.action = 'stopped';
        continue;
      }
      lemming.x = nextX;
      lemming.action = 'walking';
      if (!this.#hasSupport(lemming.x, lemming.y)) this.#fall(lemming);
      this.#maybeExit(lemming);
    }
    this.tick += 1;
  }

  #fall(lemming) {
    lemming.y += 1;
    lemming.fallDistance += 1;
    lemming.action = 'falling';
    if (lemming.y >= this.height || lemming.fallDistance > this.maxSurvivableFall) {
      lemming.dead = true;
      lemming.action = 'dead';
    }
  }

  #applyBuilder(lemming, skillType) {
    this.#consumeSkill(skillType);
    const dx = lemming.lookRight ? 1 : -1;
    const y = lemming.y + 1;
    for (let step = 1; step <= this.builderLength; step += 1) {
      this.#setGround(lemming.x + (dx * step), y, true);
    }
    lemming.action = 'building';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyBasher(lemming, skillType) {
    this.#consumeSkill(skillType);
    const dx = lemming.lookRight ? 1 : -1;
    for (let step = 1; step <= 10; step += 1) {
      const x = lemming.x + (dx * step);
      for (let y = lemming.y - 8; y <= lemming.y + 1; y += 1) {
        if (!this.#isSteel(x, y)) this.#setGround(x, y, false);
      }
    }
    lemming.action = 'bashing';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyDigger(lemming, skillType) {
    this.#consumeSkill(skillType);
    for (let y = lemming.y + 1; y <= lemming.y + 12; y += 1) {
      for (let x = lemming.x - 2; x <= lemming.x + 2; x += 1) {
        if (!this.#isSteel(x, y)) this.#setGround(x, y, false);
      }
    }
    lemming.action = 'digging';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyMiner(lemming, skillType) {
    this.#consumeSkill(skillType);
    const dx = lemming.lookRight ? 1 : -1;
    for (let step = 1; step <= 12; step += 1) {
      const x = lemming.x + (dx * step);
      const y = lemming.y + Math.floor(step / 2);
      for (let dy = -1; dy <= 2; dy += 1) {
        if (!this.#isSteel(x, y + dy)) this.#setGround(x, y + dy, false);
      }
    }
    lemming.action = 'mining';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #applyBlocker(lemming, skillType) {
    this.#consumeSkill(skillType);
    lemming.lookRight = !lemming.lookRight;
    lemming.action = 'blocking';
    lemming.lastSkill = skillType;
    return { ok: true, lemmingId: lemming.id, skillType };
  }

  #consumeSkill(skillType) {
    this.skills[skillType] = Math.max(0, this.getSkillCount(skillType) - 1);
  }

  #hasSupport(x, y) {
    return this.#isGround(x, y + 1);
  }

  #isBlocked(x, y) {
    return this.#isGround(x, y) || this.#isSteel(x, y);
  }

  #isGround(x, y) {
    return this.#maskValue(this.groundMask, x, y) > 0;
  }

  #isSteel(x, y) {
    return this.#maskValue(this.steelMask, x, y) > 0;
  }

  #setGround(x, y, value) {
    const index = this.#maskIndex(x, y);
    if (index < 0) return;
    this.groundMask[index] = value ? 1 : 0;
  }

  #maskValue(mask, x, y) {
    const index = this.#maskIndex(x, y);
    return index < 0 ? 0 : mask[index];
  }

  #maskIndex(x, y) {
    const ix = toInteger(x, -1);
    const iy = toInteger(y, -1);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return -1;
    return (iy * this.width) + ix;
  }

  #maybeExit(lemming) {
    for (const exit of this.exits) {
      const exitX = toInteger(exit.x, 0);
      const exitY = toInteger(exit.y, 0);
      const radius = Math.max(1, toInteger(exit.radius, 1));
      if (Math.abs(lemming.x - exitX) <= radius && Math.abs(lemming.y - exitY) <= 2) {
        lemming.saved = true;
        lemming.action = 'exiting';
        return;
      }
    }
  }

  #isInHazard(x, y) {
    return this.hazards.some(rect => (
      x >= toInteger(rect.x, 0) &&
      x < toInteger(rect.x, 0) + Math.max(0, toInteger(rect.width, 0)) &&
      y >= toInteger(rect.y, 0) &&
      y < toInteger(rect.y, 0) + Math.max(0, toInteger(rect.height, 0))
    ));
  }
}

const createSyntheticRunner = (fixture, options = {}) => {
  const source = fixture?.fixture?.kind === SYNTHETIC_RUNNER_KIND ? fixture.fixture : fixture;
  return new SyntheticSolverRunner(source, options);
};

const createRunnerFromSyntheticFixture = (fixture, options = {}) => ({
  sourceKind: SYNTHETIC_RUNNER_KIND,
  runner: createSyntheticRunner(fixture, options),
  result: null
});

const createEditorLevelRunner = () => createUnsupportedRunnerResult(
  'editor',
  'Editor level sources need the editor-to-runtime loader before replay can run'
);

const createProcgenChunkRunner = () => createUnsupportedRunnerResult(
  'procgen',
  'Procgen chunks need a chunk-to-runtime adapter before replay can run'
);

const createBuiltInLevelRunner = () => createUnsupportedRunnerResult(
  'builtin',
  'Built-in level descriptors need the pack loader before replay can run'
);

const createRunnerFromSource = (source, options = {}) => {
  const kind = getSourceKind(source);
  if (kind === SYNTHETIC_RUNNER_KIND) {
    return createRunnerFromSyntheticFixture(source?.fixture ?? source, options);
  }
  if (kind === 'editor') return createEditorLevelRunner(source, options);
  if (kind === 'procgen') return createProcgenChunkRunner(source, options);
  if (kind === 'builtin') return createBuiltInLevelRunner(source, options);
  return createUnsupportedRunnerResult('unknown', 'Unknown solver runner source');
};

const isRunnerAdapter = value => (
  value != null &&
  typeof value.step === 'function' &&
  typeof value.applyAction === 'function' &&
  typeof value.getFinalStateSummary === 'function'
);

const resolveRunner = (runnerOrSource, options) => {
  if (isRunnerAdapter(runnerOrSource)) {
    return { sourceKind: runnerOrSource.kind || 'adapter', runner: runnerOrSource, result: null };
  }
  if (runnerOrSource?.runner || runnerOrSource?.result) return runnerOrSource;
  return createRunnerFromSource(runnerOrSource, options);
};

const getActionBounds = action => {
  if (action.tick != null) return { start: action.tick, end: action.tick, exact: true };
  if (action.window) {
    return {
      start: Math.min(action.window.start, action.window.end),
      end: Math.max(action.window.start, action.window.end),
      exact: false
    };
  }
  return { start: 0, end: 0, exact: true };
};

const prepareActionQueue = actions => actions
  .map((action, index) => {
    const normalized = normalizeActionScriptAction(action);
    return {
      action: normalized,
      index,
      ...getActionBounds(normalized)
    };
  })
  .sort((left, right) => left.start - right.start || left.index - right.index);

const toConditionCount = (condition, fallback) => Math.max(0, toInteger(
  condition.count ?? condition.value ?? condition.min,
  fallback
));

const conditionDetail = condition => {
  if (typeof condition === 'string') return condition;
  return JSON.stringify(condition);
};

const checkCondition = (condition, runner, action = null) => {
  const summary = runner.getFinalStateSummary();
  if (typeof condition === 'string') {
    if (condition === 'target-active') {
      const target = runner.selectLemming(action?.target);
      return {
        ok: Boolean(target && !target.saved && !target.dead),
        detail: condition
      };
    }
    if (condition === 'saved') {
      return { ok: summary.savedCount > 0, detail: condition };
    }
    return { ok: false, detail: `Unknown replay condition: ${condition}` };
  }
  if (condition == null || typeof condition !== 'object') {
    return { ok: false, detail: 'Invalid replay condition' };
  }

  const type = String(condition.type ?? condition.kind ?? condition.code ?? '').trim();
  const lemming = condition.id == null
    ? runner.selectLemming(action?.target)
    : summary.lemmings.find(item => String(item.id) === String(condition.id));

  if (type === 'savedCountAtLeast') {
    return {
      ok: summary.savedCount >= toConditionCount(condition, 1),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'deadCountAtMost') {
    return {
      ok: summary.deadCount <= toConditionCount(condition, 0),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'activeCountAtLeast') {
    return {
      ok: summary.activeCount >= toConditionCount(condition, 1),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingSaved') {
    return {
      ok: Boolean(lemming?.saved),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingAlive') {
    return {
      ok: Boolean(lemming && !lemming.dead),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingXAtLeast') {
    return {
      ok: Boolean(lemming && lemming.x >= toInteger(condition.x, 0)),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'lemmingXAtMost') {
    return {
      ok: Boolean(lemming && lemming.x <= toInteger(condition.x, 0)),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'skillAvailable' || type === 'skillRemainingAtLeast') {
    const skillType = String(condition.skillType ?? condition.skill ?? '').trim();
    return {
      ok: runner.getSkillCount(skillType) >= toConditionCount(condition, 1),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'tickAtLeast') {
    return {
      ok: summary.tick >= toConditionCount(condition, 0),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'tickAtMost') {
    return {
      ok: summary.tick <= toConditionCount(condition, 0),
      detail: conditionDetail(condition)
    };
  }
  if (type === 'stateHash') {
    return {
      ok: summary.stateHash === String(condition.value ?? ''),
      detail: conditionDetail(condition)
    };
  }
  return { ok: false, detail: `Unknown replay condition: ${conditionDetail(condition)}` };
};

const firstFailedCondition = (conditions, runner, action = null) => {
  for (const condition of conditions) {
    const checked = checkCondition(condition, runner, action);
    if (!checked.ok) return checked;
  }
  return null;
};

const createReplayResult = ({
  resultType,
  summary,
  actions,
  explanations = [],
  budgetUsage,
  runner,
  appliedActions
}) => {
  const replaySummary = {
    ...runner.getFinalStateSummary(),
    appliedActions: appliedActions.map(item => ({ ...item }))
  };
  return createSolverResult({
    resultType,
    summary,
    actions,
    explanations,
    budgetUsage,
    replaySummary
  });
};

const createReplayFailure = ({
  summary,
  detail,
  actions,
  budgetUsage,
  runner,
  appliedActions,
  code = SOLVER_EXPLANATION_CODES.REPLAY_DIVERGED
}) => createReplayResult({
  resultType: SOLVER_RESULT_TYPES.FAILED,
  summary,
  actions,
  explanations: [{ code, detail }],
  budgetUsage,
  runner,
  appliedActions
});

const verifyActionReplay = (runnerOrSource, actions = [], options = {}) => {
  const normalizedOptions = normalizeSolverOptions(options);
  const created = resolveRunner(runnerOrSource, normalizedOptions);
  if (created.result) return created.result;

  const runner = created.runner;
  const actionQueue = prepareActionQueue(actions);
  const appliedActions = [];
  const budgetUsage = {
    ticks: 0,
    nodes: 0,
    actions: 0,
    wallTimeMs: 0
  };
  const targetSaveCount = Math.max(0, toInteger(options.targetSaveCount, runner.needCount || 1));
  let nextActionIndex = 0;

  const timeout = () => createReplayResult({
    resultType: SOLVER_RESULT_TYPES.TIMEOUT,
    summary: `Replay budget exhausted at tick ${budgetUsage.ticks}`,
    actions,
    explanations: [SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED],
    budgetUsage,
    runner,
    appliedActions
  });

  const checkFinalPostconditions = () => {
    for (const item of actionQueue) {
      const failed = firstFailedCondition(item.action.expectedPostconditions, runner, item.action);
      if (failed) {
        return createReplayFailure({
          summary: `Replay diverged after ${budgetUsage.ticks} ticks`,
          detail: failed.detail,
          actions,
          budgetUsage,
          runner,
          appliedActions
        });
      }
    }
    return null;
  };

  while (true) {
    while (nextActionIndex < actionQueue.length) {
      const item = actionQueue[nextActionIndex];
      if (runner.tick < item.start) break;
      if (runner.tick > item.end) {
        return createReplayFailure({
          summary: `Replay missed action ${item.index} at tick ${runner.tick}`,
          detail: `Action window ${item.start}-${item.end} expired`,
          actions,
          budgetUsage,
          runner,
          appliedActions
        });
      }

      const failedPrecondition = firstFailedCondition(
        item.action.preconditions,
        runner,
        item.action
      );
      if (failedPrecondition) {
        if (!item.exact && runner.tick < item.end) break;
        return createReplayFailure({
          summary: `Replay precondition failed at tick ${runner.tick}`,
          detail: failedPrecondition.detail,
          actions,
          budgetUsage,
          runner,
          appliedActions
        });
      }

      budgetUsage.actions += 1;
      if (budgetUsage.actions > normalizedOptions.maxActions) return timeout();
      const applied = runner.applyAction(item.action);
      if (!applied.ok) {
        return createReplayFailure({
          summary: `Replay action failed at tick ${runner.tick}`,
          detail: applied.detail,
          actions,
          budgetUsage,
          runner,
          appliedActions
        });
      }
      appliedActions.push({
        index: item.index,
        tick: runner.tick,
        skillType: item.action.skillType,
        target: item.action.target,
        lemmingId: applied.lemmingId
      });
      nextActionIndex += 1;
    }

    if (runner.getSavedCount() >= targetSaveCount) {
      const postconditionFailure = checkFinalPostconditions();
      if (postconditionFailure) return postconditionFailure;
      return createReplayResult({
        resultType: SOLVER_RESULT_TYPES.SOLVED,
        summary: `Replay solved ${runner.kind || 'runner'} ${runner.id || ''} in ${budgetUsage.ticks} ticks`.trim(),
        actions,
        budgetUsage,
        runner,
        appliedActions
      });
    }

    if (runner.isTerminal()) {
      return createReplayFailure({
        summary: `Replay failed to save ${targetSaveCount} lemming(s)`,
        detail: `Saved ${runner.getSavedCount()} of ${targetSaveCount}`,
        actions,
        budgetUsage,
        runner,
        appliedActions,
        code: SOLVER_EXPLANATION_CODES.SAVE_COUNT_UNREACHABLE
      });
    }

    if (
      budgetUsage.ticks >= normalizedOptions.maxTicks ||
      budgetUsage.nodes >= normalizedOptions.maxNodes
    ) {
      return timeout();
    }

    runner.step();
    budgetUsage.ticks += 1;
    budgetUsage.nodes += 1;
  }
};

export {
  SyntheticSolverRunner,
  createBuiltInLevelRunner,
  createEditorLevelRunner,
  createProcgenChunkRunner,
  createRunnerFromSource,
  createRunnerFromSyntheticFixture,
  createSyntheticRunner,
  verifyActionReplay
};
