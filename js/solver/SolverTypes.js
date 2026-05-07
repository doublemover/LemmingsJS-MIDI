const SOLVER_RESULT_TYPES = Object.freeze({
  SOLVED: 'solved',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  TIMEOUT: 'timeout',
  UNSUPPORTED: 'unsupported'
});

const SOLVER_MODES = Object.freeze({
  TACTICAL: 'tactical',
  ROUTE: 'route',
  FULL: 'full'
});

const SOLVER_EXPLANATION_CODES = Object.freeze({
  BARRIER_BLOCKED_BY_STEEL: 'barrier-blocked-by-steel',
  BUDGET_EXHAUSTED: 'budget-exhausted',
  GAP_EXCEEDS_BUILDER_BUDGET: 'gap-exceeds-builder-budget',
  HAZARD_UNAVOIDABLE: 'hazard-unavoidable',
  MISSING_ENTRANCE: 'missing-entrance',
  MISSING_EXIT: 'missing-exit',
  MISSING_LANDING: 'missing-landing',
  MISSING_RUNTIME_ADAPTER: 'missing-runtime-adapter',
  NO_ROUTE_TO_EXIT: 'no-route-to-exit',
  ONE_WAY_BLOCKED: 'one-way-blocked',
  REPLAY_DIVERGED: 'replay-diverged',
  SAVE_COUNT_UNREACHABLE: 'save-count-unreachable',
  STATE_EXPLOSION: 'state-explosion',
  ARTIFACT_WRITE_FAILED: 'artifact-write-failed',
  TIMING_WINDOW_TOO_NARROW: 'timing-window-too-narrow',
  UNSUPPORTED_MECHANIC: 'unsupported-mechanic'
});

const DEFAULT_SOLVER_OPTIONS = Object.freeze({
  seed: 0,
  mode: SOLVER_MODES.TACTICAL,
  skillSubset: Object.freeze([]),
  targetSaveCount: 1,
  maxTicks: 1200,
  maxNodes: 500,
  maxActions: 8,
  maxWallTimeMs: 250
});

const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

const toNonNegativeInteger = (value, fallback) => {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return fallback;
  return Math.floor(next);
};

const normalizeSkillSubset = value => {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const key = String(item || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
};

const normalizeSolverOptions = (options = {}) => {
  const source = isPlainObject(options) ? options : {};
  const mode = Object.values(SOLVER_MODES).includes(source.mode)
    ? source.mode
    : DEFAULT_SOLVER_OPTIONS.mode;
  return {
    seed: toNonNegativeInteger(source.seed, DEFAULT_SOLVER_OPTIONS.seed),
    mode,
    skillSubset: normalizeSkillSubset(source.skillSubset ?? source.skills),
    targetSaveCount: Math.max(0, toNonNegativeInteger(
      source.targetSaveCount,
      DEFAULT_SOLVER_OPTIONS.targetSaveCount
    )),
    maxTicks: Math.max(1, toNonNegativeInteger(source.maxTicks, DEFAULT_SOLVER_OPTIONS.maxTicks)),
    maxNodes: Math.max(1, toNonNegativeInteger(source.maxNodes, DEFAULT_SOLVER_OPTIONS.maxNodes)),
    maxActions: Math.max(0, toNonNegativeInteger(source.maxActions, DEFAULT_SOLVER_OPTIONS.maxActions)),
    maxWallTimeMs: Math.max(1, toNonNegativeInteger(
      source.maxWallTimeMs,
      DEFAULT_SOLVER_OPTIONS.maxWallTimeMs
    ))
  };
};

const normalizeExplanation = explanation => {
  if (typeof explanation === 'string') {
    return { code: explanation, detail: null };
  }
  if (!isPlainObject(explanation)) {
    return { code: SOLVER_EXPLANATION_CODES.STATE_EXPLOSION, detail: null };
  }
  return {
    code: String(explanation.code || SOLVER_EXPLANATION_CODES.STATE_EXPLOSION),
    detail: explanation.detail == null ? null : String(explanation.detail),
    data: isPlainObject(explanation.data) ? { ...explanation.data } : undefined
  };
};

const normalizeActionScriptAction = action => {
  const source = isPlainObject(action) ? action : {};
  const tick = Number.isFinite(source.tick) ? Math.max(0, Math.floor(source.tick)) : null;
  const window = isPlainObject(source.window)
    ? {
      start: Math.max(0, Math.floor(Number(source.window.start) || 0)),
      end: Math.max(0, Math.floor(Number(source.window.end) || 0))
    }
    : null;
  return {
    skillType: source.skillType ?? source.skill ?? null,
    target: source.target ?? source.targetSelector ?? null,
    tick,
    window,
    preconditions: Array.isArray(source.preconditions) ? [...source.preconditions] : [],
    expectedPostconditions: Array.isArray(source.expectedPostconditions)
      ? [...source.expectedPostconditions]
      : [],
    rationale: source.rationale == null ? null : String(source.rationale)
  };
};

const createSolverResult = ({
  resultType,
  summary = '',
  actions = [],
  explanations = [],
  budgetUsage = {},
  replaySummary = null,
  captures = []
} = {}) => {
  const type = Object.values(SOLVER_RESULT_TYPES).includes(resultType)
    ? resultType
    : SOLVER_RESULT_TYPES.UNKNOWN;
  return {
    resultType: type,
    summary: String(summary || type),
    actions: Array.isArray(actions) ? actions.map(normalizeActionScriptAction) : [],
    explanations: Array.isArray(explanations) ? explanations.map(normalizeExplanation) : [],
    budgetUsage: {
      ticks: toNonNegativeInteger(budgetUsage.ticks, 0),
      nodes: toNonNegativeInteger(budgetUsage.nodes, 0),
      actions: toNonNegativeInteger(budgetUsage.actions, 0),
      wallTimeMs: toNonNegativeInteger(budgetUsage.wallTimeMs, 0)
    },
    replaySummary,
    captures: Array.isArray(captures) ? captures.map(item => String(item)) : []
  };
};

const createBudgetMeter = (options = {}, now = () => Date.now()) => {
  const normalized = normalizeSolverOptions(options);
  const startedAt = now();
  let nodes = 0;
  let ticks = 0;
  let actions = 0;
  const usage = () => ({
    ticks,
    nodes,
    actions,
    wallTimeMs: Math.max(0, Math.floor(now() - startedAt))
  });
  return {
    options: normalized,
    recordNode(count = 1) {
      nodes += Math.max(0, Math.floor(count));
      return usage();
    },
    recordTick(count = 1) {
      ticks += Math.max(0, Math.floor(count));
      return usage();
    },
    recordAction(count = 1) {
      actions += Math.max(0, Math.floor(count));
      return usage();
    },
    usage,
    isExceeded() {
      const current = usage();
      return current.nodes > normalized.maxNodes ||
        current.ticks > normalized.maxTicks ||
        current.actions > normalized.maxActions ||
        current.wallTimeMs > normalized.maxWallTimeMs;
    },
    timeoutResult(summary = 'Solver budget was exhausted') {
      return createSolverResult({
        resultType: SOLVER_RESULT_TYPES.TIMEOUT,
        summary,
        explanations: [SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED],
        budgetUsage: usage()
      });
    }
  };
};

export {
  DEFAULT_SOLVER_OPTIONS,
  SOLVER_EXPLANATION_CODES,
  SOLVER_MODES,
  SOLVER_RESULT_TYPES,
  createBudgetMeter,
  createSolverResult,
  normalizeActionScriptAction,
  normalizeSolverOptions
};
