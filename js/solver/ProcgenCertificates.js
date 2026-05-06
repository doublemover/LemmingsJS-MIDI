import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult
} from './SolverTypes.js';

const PROCGEN_CHALLENGE_TYPES = Object.freeze({
  WALK: 'walk',
  BRIDGE_GAP: 'bridge-gap',
  DIG_BARRIER: 'dig-barrier',
  BASH_BARRIER: 'bash-barrier',
  MINE_SLOPE: 'mine-slope',
  FALL_SURVIVAL: 'fall-survival',
  EXIT_ROUTE: 'exit-route',
  UNKNOWN: 'unknown'
});

const PROCGEN_FALLBACK_DECISIONS = Object.freeze({
  ACCEPT: 'accept',
  EXTEND: 'extend',
  REPLACE: 'replace',
  SIMPLIFY: 'simplify'
});

const TACTICAL_SOLVER_METHODS = [
  'verifyProcgenCertificate',
  'verifyChallengeCertificate',
  'solveChallenge',
  'solveTacticalChallenge',
  'solve',
  'run'
];

const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

const toNonNegativeInteger = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
};

const normalizeToken = (value, fallback = null) => {
  if (value == null) return fallback;
  const token = String(value).trim();
  return token || fallback;
};

const normalizeAssignmentWindow = value => {
  if (value == null) return null;
  const source = Array.isArray(value)
    ? { start: value[0], end: value[1] }
    : isPlainObject(value)
      ? value
      : {};
  const start = toNonNegativeInteger(source.start ?? source.from ?? source.tick, 0);
  const end = toNonNegativeInteger(source.end ?? source.to ?? source.tick, start);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end)
  };
};

const normalizeSegment = value => {
  if (value == null) return null;
  const source = Array.isArray(value)
    ? {
      x0: value[0],
      y0: value[1],
      x1: value[2],
      y1: value[3]
    }
    : isPlainObject(value)
      ? value
      : {};
  const start = isPlainObject(source.start) ? source.start : {};
  const end = isPlainObject(source.end) ? source.end : {};
  const x0 = Number(source.x0 ?? source.left ?? source.x ?? start.x);
  const y0 = Number(source.y0 ?? source.top ?? source.y ?? start.y);
  const rawX1 = source.x1 ?? source.right ?? end.x;
  const rawY1 = source.y1 ?? source.bottom ?? end.y;
  const x1 = Number(rawX1 ?? (Number.isFinite(x0) ? x0 : 0));
  const y1 = Number(rawY1 ?? (Number.isFinite(y0) ? y0 : 0));
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return null;
  }
  return {
    x0: Math.min(Math.floor(x0), Math.floor(x1)),
    y0: Math.min(Math.floor(y0), Math.floor(y1)),
    x1: Math.max(Math.floor(x0), Math.floor(x1)),
    y1: Math.max(Math.floor(y0), Math.floor(y1))
  };
};

const normalizeSolverLikeResult = value => {
  if (!isPlainObject(value)) {
    return createSolverResult({
      resultType: SOLVER_RESULT_TYPES.UNKNOWN,
      summary: 'No tactical solver result was returned',
      explanations: [SOLVER_EXPLANATION_CODES.STATE_EXPLOSION]
    });
  }
  if (value.resultType) return createSolverResult(value);
  if (value.solved === true) {
    return createSolverResult({
      resultType: SOLVER_RESULT_TYPES.SOLVED,
      summary: value.summary || 'Procgen certificate verified',
      actions: value.actions,
      explanations: value.explanations,
      budgetUsage: value.budgetUsage,
      replaySummary: value.replaySummary,
      captures: value.captures
    });
  }
  if (value.solved === false) {
    return createSolverResult({
      resultType: SOLVER_RESULT_TYPES.FAILED,
      summary: value.summary || 'Procgen certificate was rejected',
      explanations: value.explanations || [SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT],
      budgetUsage: value.budgetUsage,
      replaySummary: value.replaySummary,
      captures: value.captures
    });
  }
  return createSolverResult({
    resultType: SOLVER_RESULT_TYPES.UNKNOWN,
    summary: value.summary || 'Tactical solver result did not include a result type',
    explanations: value.explanations || [SOLVER_EXPLANATION_CODES.STATE_EXPLOSION],
    budgetUsage: value.budgetUsage,
    replaySummary: value.replaySummary,
    captures: value.captures
  });
};

const createUnavailableSolverResult = () => createSolverResult({
  resultType: SOLVER_RESULT_TYPES.UNSUPPORTED,
  summary: 'Tactical solver is not available for procgen certificate verification',
  explanations: [{
    code: SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC,
    detail: 'No TacticalSolver module or injected tactical solver was available.'
  }]
});

const createSolverErrorResult = error => createSolverResult({
  resultType: SOLVER_RESULT_TYPES.UNKNOWN,
  summary: 'Tactical solver could not verify the procgen certificate',
  explanations: [{
    code: SOLVER_EXPLANATION_CODES.STATE_EXPLOSION,
    detail: error?.message || String(error)
  }]
});

const callSolverFunction = (fn, chunk, certificate, options) => {
  if (fn.length >= 2) return fn(chunk, certificate, options);
  return fn({ chunk, certificate, options });
};

const invokeSolverObject = async (solver, chunk, certificate, options) => {
  for (const methodName of TACTICAL_SOLVER_METHODS) {
    if (typeof solver?.[methodName] === 'function') {
      return callSolverFunction(solver[methodName].bind(solver), chunk, certificate, options);
    }
  }
  return null;
};

const invokeTacticalSolver = async (solver, chunk, certificate, options) => {
  if (typeof solver === 'function') {
    const source = Function.prototype.toString.call(solver);
    if (/^class\s/.test(source)) {
      return invokeSolverObject(new solver(options), chunk, certificate, options);
    }
    return callSolverFunction(solver, chunk, certificate, options);
  }
  return invokeSolverObject(solver, chunk, certificate, options);
};

const resolveTacticalSolver = async options => {
  if (Object.prototype.hasOwnProperty.call(options, 'tacticalSolver')) {
    return { solver: options.tacticalSolver };
  }
  if (Object.prototype.hasOwnProperty.call(options, 'TacticalSolver')) {
    return { solver: options.TacticalSolver };
  }
  try {
    const module = await import('./TacticalSolver.js');
    return {
      solver: module.TacticalSolver ??
        module.createTacticalSolver ??
        module.solveTacticalChallenge ??
        module.default ??
        null
    };
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return { solver: null };
    return { solver: null, error };
  }
};

const createProcgenChallengeCertificate = (input = {}) => {
  const source = isPlainObject(input) ? input : {};
  const expectedSegment = isPlainObject(source.expectedSegment) ? source.expectedSegment : {};
  const roughAssignmentWindow = normalizeAssignmentWindow(
    source.roughAssignmentWindow ??
      source.assignmentWindow ??
      source.expectedAssignmentWindow ??
      source.window
  );
  return {
    id: normalizeToken(source.id, null),
    challengeType: normalizeToken(
      source.challengeType ?? source.type,
      PROCGEN_CHALLENGE_TYPES.UNKNOWN
    ),
    expectedSkill: normalizeToken(source.expectedSkill ?? source.skill, null),
    roughAssignmentWindow,
    assignmentWindow: roughAssignmentWindow,
    expectedLandingSegment: normalizeSegment(
      source.expectedLandingSegment ?? source.landingSegment ?? expectedSegment.landing
    ),
    expectedExitSegment: normalizeSegment(
      source.expectedExitSegment ?? source.exitSegment ?? expectedSegment.exit
    ),
    minimalSkillCount: toNonNegativeInteger(
      source.minimalSkillCount ?? source.minimumSkillCount ?? source.skillCount,
      0
    ),
    verificationResult: source.verificationResult
      ? normalizeSolverLikeResult(source.verificationResult)
      : null
  };
};

const verifyProcgenChallengeCertificate = async (certificate, chunk, options = {}) => {
  const normalized = createProcgenChallengeCertificate(certificate);
  const resolved = await resolveTacticalSolver(options);
  let verificationResult;
  if (resolved.error) {
    verificationResult = createSolverErrorResult(resolved.error);
  } else if (!resolved.solver) {
    verificationResult = createUnavailableSolverResult();
  } else {
    try {
      const rawResult = await invokeTacticalSolver(resolved.solver, chunk, normalized, options);
      verificationResult = normalizeSolverLikeResult(rawResult);
    } catch (error) {
      verificationResult = createSolverErrorResult(error);
    }
  }
  return {
    ...normalized,
    verificationResult
  };
};

const getExplanationCodes = result => {
  const explanations = Array.isArray(result?.explanations) ? result.explanations : [];
  return new Set(explanations.map(explanation => {
    if (typeof explanation === 'string') return explanation;
    return explanation?.code;
  }).filter(Boolean));
};

const decideProcgenFallback = result => {
  const normalized = normalizeSolverLikeResult(result);
  const codes = getExplanationCodes(normalized);
  let decision = PROCGEN_FALLBACK_DECISIONS.SIMPLIFY;
  if (normalized.resultType === SOLVER_RESULT_TYPES.SOLVED) {
    decision = PROCGEN_FALLBACK_DECISIONS.ACCEPT;
  } else if (normalized.resultType === SOLVER_RESULT_TYPES.UNSUPPORTED) {
    decision = PROCGEN_FALLBACK_DECISIONS.REPLACE;
  } else if (
    codes.has(SOLVER_EXPLANATION_CODES.HAZARD_UNAVOIDABLE) ||
    codes.has(SOLVER_EXPLANATION_CODES.BARRIER_BLOCKED_BY_STEEL) ||
    codes.has(SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC)
  ) {
    decision = PROCGEN_FALLBACK_DECISIONS.REPLACE;
  } else if (
    codes.has(SOLVER_EXPLANATION_CODES.MISSING_LANDING) ||
    codes.has(SOLVER_EXPLANATION_CODES.MISSING_EXIT) ||
    codes.has(SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT)
  ) {
    decision = PROCGEN_FALLBACK_DECISIONS.EXTEND;
  } else if (
    codes.has(SOLVER_EXPLANATION_CODES.GAP_EXCEEDS_BUILDER_BUDGET) ||
    codes.has(SOLVER_EXPLANATION_CODES.TIMING_WINDOW_TOO_NARROW) ||
    codes.has(SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED) ||
    codes.has(SOLVER_EXPLANATION_CODES.SAVE_COUNT_UNREACHABLE)
  ) {
    decision = PROCGEN_FALLBACK_DECISIONS.SIMPLIFY;
  }
  return {
    decision,
    resultType: normalized.resultType,
    reasonCodes: Array.from(codes).sort(),
    summary: normalized.summary
  };
};

export {
  PROCGEN_CHALLENGE_TYPES,
  PROCGEN_FALLBACK_DECISIONS,
  createProcgenChallengeCertificate,
  decideProcgenFallback,
  verifyProcgenChallengeCertificate
};
