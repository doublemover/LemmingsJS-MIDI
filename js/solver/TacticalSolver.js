import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createBudgetMeter,
  createSolverResult
} from './SolverTypes.js';

const BUILDER_SPAN_PIXELS = 12;
const DEFAULT_SAFE_FALL_DISTANCE = 60;
const MAX_SIMPLE_BARRIER_HEIGHT = 24;
const WALK_TICKS_PER_PIXEL = 2;

const SUPPORTED_MECHANICS = new Set([
  'walk',
  'gap',
  'builder-gap',
  'barrier',
  'bash-barrier',
  'dig-barrier',
  'mine-barrier',
  'floater-fall',
  'blocker-turnaround'
]);

const DESTRUCTIVE_SKILLS = Object.freeze(['basher', 'digger', 'miner']);

const isPlainObject = value => value != null && typeof value === 'object' && !Array.isArray(value);

const toFiniteNumber = (value, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const toInteger = (value, fallback = 0) => Math.floor(toFiniteNumber(value, fallback));

const maskData = mask => {
  if (mask == null) return null;
  if (mask.mask != null) return mask.mask;
  return mask;
};

const maskAt = (mask, width, height, x, y) => {
  const data = maskData(mask);
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (!data || px < 0 || py < 0 || px >= width || py >= height) return 0;
  return data[(py * width) + px] ? 1 : 0;
};

const hasAnyMaskInRect = (mask, width, height, rect) => {
  if (!rect) return false;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (maskAt(mask, width, height, x, y)) return true;
    }
  }
  return false;
};

const firstSupportedPoint = fixture => {
  if (Array.isArray(fixture.lemmings) && fixture.lemmings.length > 0) {
    return fixture.lemmings[0];
  }
  if (Array.isArray(fixture.entrances) && fixture.entrances.length > 0) {
    return fixture.entrances[0];
  }
  return null;
};

const firstExit = fixture => Array.isArray(fixture.exits) && fixture.exits.length > 0
  ? fixture.exits[0]
  : null;

const normalizeChallengeType = fixture => {
  const challenge = fixture.challenge ?? fixture.tacticalChallenge ?? null;
  if (typeof challenge === 'string') return challenge;
  if (isPlainObject(challenge)) {
    return challenge.type ?? challenge.mechanic ?? fixture.requiredMechanic ?? null;
  }
  return fixture.requiredMechanic ?? fixture.mechanic ?? null;
};

const challengeData = fixture => {
  const challenge = fixture.challenge ?? fixture.tacticalChallenge ?? null;
  return isPlainObject(challenge) ? challenge : {};
};

const findFallChallenge = fixture => {
  if (isPlainObject(fixture.fall)) return fixture.fall;
  const challenge = challengeData(fixture);
  if (challenge.type === 'floater-fall' || challenge.mechanic === 'floater-fall') {
    return challenge;
  }
  if (!Array.isArray(fixture.hazards)) return null;
  return fixture.hazards.find(hazard => hazard.type === 'fall' || hazard.type === 'drop') ?? null;
};

const findBlockerTurnaround = fixture => {
  if (isPlainObject(fixture.blockerTurnaround)) return fixture.blockerTurnaround;
  const challenge = challengeData(fixture);
  if (challenge.type === 'blocker-turnaround' || challenge.mechanic === 'blocker-turnaround') {
    return challenge;
  }
  return null;
};

const skillCount = (fixture, skill) => {
  const count = toInteger(fixture.skills?.[skill], 0);
  return Math.max(0, count);
};

const directionToExit = (start, exit) => exit.x >= start.x ? 1 : -1;

const targetSelector = (start, role = 'lead') => ({
  kind: 'lemming',
  id: start.id ?? 0,
  role
});

const tickForX = (fixture, start, x) => {
  const baseTick = toInteger(fixture.timer?.tick, 0);
  const distance = Math.abs(toFiniteNumber(x, start.x) - toFiniteNumber(start.x, 0));
  return baseTick + Math.max(0, Math.floor(distance * WALK_TICKS_PER_PIXEL));
};

const tickWindow = tick => ({
  start: Math.max(0, tick - 6),
  end: tick + 6
});

const supportYFor = start => toInteger(start.y, 0) + 1;

const hasSupportAt = (fixture, x, footY) => {
  const y = footY + 1;
  return maskAt(fixture.groundMask, fixture.width, fixture.height, x, y) === 1;
};

const barrierHeightAt = (fixture, x, footY) => {
  let height = 0;
  for (let y = footY; y >= 0; y -= 1) {
    if (!maskAt(fixture.groundMask, fixture.width, fixture.height, x, y)) break;
    height += 1;
  }
  return height;
};

class TacticalSolver {
  constructor(fixture, options = {}, deps = {}) {
    this.fixture = fixture ?? {};
    this.meter = createBudgetMeter(options, deps.now ?? options.now ?? (() => 0));
    this.options = this.meter.options;
    this.allowedSkills = new Set(this.options.skillSubset);
  }

  solve() {
    const timeout = this.recordNode('Solver budget exhausted while reading tactical fixture');
    if (timeout) return timeout;

    const unsupported = this.unsupportedMechanicResult();
    if (unsupported) return unsupported;

    const required = this.validateRouteEndpoints();
    if (required) return required;

    const fall = findFallChallenge(this.fixture);
    if (fall) return this.solveFloaterFall(fall);

    const turnaround = findBlockerTurnaround(this.fixture);
    if (turnaround) return this.solveBlockerTurnaround(turnaround);

    return this.solveLocalRoute();
  }

  recordNode(summary) {
    this.meter.recordNode();
    return this.timeoutIfExceeded(summary);
  }

  recordAction(summary) {
    this.meter.recordAction();
    return this.timeoutIfExceeded(summary);
  }

  recordTicks(count, summary) {
    this.meter.recordTick(count);
    return this.timeoutIfExceeded(summary);
  }

  timeoutIfExceeded(summary) {
    if (!this.meter.isExceeded()) return null;
    return createSolverResult({
      resultType: SOLVER_RESULT_TYPES.TIMEOUT,
      summary,
      explanations: [{
        code: SOLVER_EXPLANATION_CODES.BUDGET_EXHAUSTED,
        detail: 'Tactical solver stopped before exceeding configured node, tick, action, or wall-time budget.'
      }],
      budgetUsage: this.meter.usage()
    });
  }

  unsupportedMechanicResult() {
    const mechanic = normalizeChallengeType(this.fixture);
    if (!mechanic || SUPPORTED_MECHANICS.has(mechanic)) return null;
    return this.result(SOLVER_RESULT_TYPES.UNSUPPORTED, `Unsupported tactical mechanic: ${mechanic}`, [], [{
      code: SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC,
      detail: `The tactical solver does not model ${mechanic}.`,
      data: { mechanic }
    }]);
  }

  validateRouteEndpoints() {
    const start = firstSupportedPoint(this.fixture);
    const exit = firstExit(this.fixture);
    if (!start) {
      return this.result(SOLVER_RESULT_TYPES.FAILED, 'No entrance or lemming is available for tactical solving', [], [{
        code: SOLVER_EXPLANATION_CODES.MISSING_ENTRANCE,
        detail: 'Fixture has no lemming and no entrance.'
      }]);
    }
    if (!exit) {
      return this.result(SOLVER_RESULT_TYPES.FAILED, 'No exit is available for tactical solving', [], [{
        code: SOLVER_EXPLANATION_CODES.MISSING_EXIT,
        detail: 'Fixture has no exit target.'
      }]);
    }
    return null;
  }

  solveFloaterFall(fall) {
    const start = firstSupportedPoint(this.fixture);
    const fromY = toFiniteNumber(fall.fromY ?? fall.y ?? start.y, start.y);
    const toY = toFiniteNumber(fall.toY ?? fall.landingY ?? fall.y + fall.height, fromY);
    const fallDistance = Math.max(0, Math.floor(toY - fromY));
    const safeDistance = Math.max(0, toInteger(fall.safeFallDistance, DEFAULT_SAFE_FALL_DISTANCE));
    const timeout = this.recordNode('Solver budget exhausted while checking floater fall');
    if (timeout) return timeout;

    if (fallDistance <= safeDistance) {
      return this.result(SOLVER_RESULT_TYPES.SOLVED, 'Fall is survivable without a floater', [], []);
    }
    if (!this.canUseSkill('floater')) {
      return this.result(SOLVER_RESULT_TYPES.FAILED, 'Lethal fall requires a floater skill', [], [{
        code: SOLVER_EXPLANATION_CODES.HAZARD_UNAVOIDABLE,
        detail: 'The fall exceeds safe distance and no usable floater is available.',
        data: { fallDistance, safeDistance }
      }]);
    }

    const x = toFiniteNumber(fall.x ?? start.x, start.x);
    const tick = toInteger(fall.assignmentTick, tickForX(this.fixture, start, x));
    const action = {
      skillType: 'floater',
      targetSelector: targetSelector(start),
      tick,
      window: tickWindow(tick),
      preconditions: [
        `lemming is falling before ${fallDistance}px drop`,
        'floater skill is available'
      ],
      expectedPostconditions: [
        'lemming opens umbrella',
        'lemming survives landing'
      ],
      rationale: `Assign floater before a ${fallDistance}px drop that exceeds the ${safeDistance}px safe fall distance.`
    };
    return this.solvedWithActions('Floater action survives the local fall challenge', [action], fallDistance);
  }

  solveBlockerTurnaround(turnaround) {
    const start = firstSupportedPoint(this.fixture);
    const exit = firstExit(this.fixture);
    const timeout = this.recordNode('Solver budget exhausted while checking blocker turnaround');
    if (timeout) return timeout;

    if (!this.canUseSkill('blocker')) {
      return this.result(SOLVER_RESULT_TYPES.FAILED, 'Turnaround requires a blocker skill', [], [{
        code: SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT,
        detail: 'The local route requires a blocker turnaround and no usable blocker is available.'
      }]);
    }

    const x = toFiniteNumber(turnaround.x ?? start.x, start.x);
    const y = toFiniteNumber(turnaround.y ?? start.y, start.y);
    const tick = toInteger(turnaround.assignmentTick, tickForX(this.fixture, start, x));
    const direction = directionToExit(start, exit) > 0 ? 'right' : 'left';
    const action = {
      skillType: 'blocker',
      targetSelector: {
        ...targetSelector(start, 'turnaround-anchor'),
        x,
        y
      },
      tick,
      window: tickWindow(tick),
      preconditions: [
        'blocker skill is available',
        `crowd approaches blocker from the ${direction === 'right' ? 'left' : 'right'}`
      ],
      expectedPostconditions: [
        `crowd turns ${direction}`,
        'lead route continues toward exit'
      ],
      rationale: `Place a blocker at x=${Math.floor(x)} to reverse the crowd toward the exit.`
    };
    return this.solvedWithActions('Blocker action turns the local route toward the exit', [action], 12);
  }

  solveLocalRoute() {
    const start = firstSupportedPoint(this.fixture);
    const exit = firstExit(this.fixture);
    const route = this.scanRoute(start, exit);
    if (route.result) return route.result;

    const actions = [];
    for (const gap of route.gaps) {
      const gapResult = this.actionForGap(start, gap);
      if (gapResult.result) return gapResult.result;
      actions.push(...gapResult.actions);
    }
    for (const barrier of route.barriers) {
      const barrierResult = this.actionForBarrier(start, barrier);
      if (barrierResult.result) return barrierResult.result;
      actions.push(...barrierResult.actions);
    }

    if (actions.length === 0) {
      return this.result(SOLVER_RESULT_TYPES.SOLVED, 'Direct walking route reaches the local exit', [], []);
    }

    return this.solvedWithActions('Tactical actions connect the local route to the exit', actions, route.ticks);
  }

  scanRoute(start, exit) {
    const timeout = this.recordNode('Solver budget exhausted while scanning local route');
    if (timeout) return { result: timeout };

    const direction = directionToExit(start, exit);
    const xStart = Math.max(0, Math.min(this.fixture.width - 1, toInteger(start.x, 0)));
    const xEnd = Math.max(0, Math.min(this.fixture.width - 1, toInteger(exit.x, 0)));
    const footY = toInteger(start.y, 0);
    const gaps = [];
    const barriers = [];
    let activeGap = null;
    let activeBarrier = null;

    for (let x = xStart; direction > 0 ? x <= xEnd : x >= xEnd; x += direction) {
      const supported = hasSupportAt(this.fixture, x, footY);
      const barrierHeight = supported ? barrierHeightAt(this.fixture, x, footY) : 0;

      if (!supported && activeGap == null) {
        activeGap = { startX: x, endX: x, y: supportYFor(start) };
      } else if (!supported) {
        activeGap.endX = x;
      } else if (activeGap) {
        gaps.push(this.finalizeSpan(activeGap, direction));
        activeGap = null;
      }

      if (barrierHeight > 0 && activeBarrier == null) {
        activeBarrier = { startX: x, endX: x, footY, height: barrierHeight };
      } else if (barrierHeight > 0) {
        activeBarrier.endX = x;
        activeBarrier.height = Math.max(activeBarrier.height, barrierHeight);
      } else if (activeBarrier) {
        barriers.push(this.finalizeSpan(activeBarrier, direction));
        activeBarrier = null;
      }
    }

    if (activeGap) gaps.push(this.finalizeSpan(activeGap, direction));
    if (activeBarrier) barriers.push(this.finalizeSpan(activeBarrier, direction));

    if (gaps.length > 0) {
      const timeoutAfterGap = this.recordNode('Solver budget exhausted while classifying gaps');
      if (timeoutAfterGap) return { result: timeoutAfterGap };
    }
    if (barriers.length > 0) {
      const timeoutAfterBarrier = this.recordNode('Solver budget exhausted while classifying barriers');
      if (timeoutAfterBarrier) return { result: timeoutAfterBarrier };
    }

    return {
      gaps,
      barriers,
      ticks: Math.abs(xEnd - xStart) * WALK_TICKS_PER_PIXEL
    };
  }

  finalizeSpan(span, direction) {
    const minX = Math.min(span.startX, span.endX);
    const maxX = Math.max(span.startX, span.endX);
    return {
      ...span,
      direction,
      minX,
      maxX,
      width: (maxX - minX) + 1
    };
  }

  actionForGap(start, gap) {
    const builderBudget = this.skillBudget('builder');
    const neededBuilders = Math.max(1, Math.ceil(gap.width / BUILDER_SPAN_PIXELS));
    if (builderBudget <= 0) {
      return {
        result: this.result(SOLVER_RESULT_TYPES.FAILED, 'No route to exit through unbridged gap', [], [{
          code: SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT,
          detail: 'The route has a gap and no usable builder skill.'
        }])
      };
    }
    if (neededBuilders > builderBudget) {
      return {
        result: this.result(SOLVER_RESULT_TYPES.FAILED, 'Gap exceeds available builder budget', [], [{
          code: SOLVER_EXPLANATION_CODES.GAP_EXCEEDS_BUILDER_BUDGET,
          detail: `Gap width ${gap.width}px requires ${neededBuilders} builders but only ${builderBudget} are usable.`,
          data: { gapWidth: gap.width, neededBuilders, builderBudget }
        }])
      };
    }

    const actions = [];
    for (let i = 0; i < neededBuilders; i += 1) {
      const targetX = gap.direction > 0
        ? gap.minX - 1 + (i * BUILDER_SPAN_PIXELS)
        : gap.maxX + 1 - (i * BUILDER_SPAN_PIXELS);
      const tick = tickForX(this.fixture, start, targetX) + (i * 14);
      const action = {
        skillType: 'builder',
        targetSelector: {
          ...targetSelector(start),
          x: targetX,
          y: gap.y
        },
        tick,
        window: tickWindow(tick),
        preconditions: [
          'builder skill is available',
          'lemming is walking at the gap edge'
        ],
        expectedPostconditions: [
          `bridge covers gap x=${gap.minX}..${gap.maxX}`,
          'lemming reaches the far-side landing'
        ],
        rationale: `Bridge ${gap.width}px gap with builder ${i + 1} of ${neededBuilders}.`
      };
      const timeout = this.recordAction('Solver budget exhausted while adding builder action');
      if (timeout) return { result: timeout };
      actions.push(action);
    }
    return { actions };
  }

  actionForBarrier(start, barrier) {
    const rect = {
      x: barrier.minX,
      y: Math.max(0, barrier.footY - barrier.height + 1),
      width: barrier.width,
      height: barrier.height
    };
    if (hasAnyMaskInRect(this.fixture.steelMask, this.fixture.width, this.fixture.height, rect)) {
      return {
        result: this.result(SOLVER_RESULT_TYPES.FAILED, 'Barrier is blocked by steel', [], [{
          code: SOLVER_EXPLANATION_CODES.BARRIER_BLOCKED_BY_STEEL,
          detail: 'The simple destructive tunnel intersects steel terrain.',
          data: { x: barrier.minX, width: barrier.width, height: barrier.height }
        }])
      };
    }
    if (barrier.height > MAX_SIMPLE_BARRIER_HEIGHT) {
      return {
        result: this.result(SOLVER_RESULT_TYPES.UNKNOWN, 'Barrier exceeds tactical solver bounds', [], [{
          code: SOLVER_EXPLANATION_CODES.STATE_EXPLOSION,
          detail: `Barrier height ${barrier.height}px exceeds the ${MAX_SIMPLE_BARRIER_HEIGHT}px simple local bound.`,
          data: { x: barrier.minX, width: barrier.width, height: barrier.height }
        }])
      };
    }

    const preferred = this.preferredBarrierSkill();
    if (!preferred) {
      return {
        result: this.result(SOLVER_RESULT_TYPES.FAILED, 'No route to exit through simple barrier', [], [{
          code: SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT,
          detail: 'The route has a simple barrier and no usable dig, bash, or mine skill.'
        }])
      };
    }

    const targetX = barrier.direction > 0 ? barrier.minX - 1 : barrier.maxX + 1;
    const tick = tickForX(this.fixture, start, targetX);
    const action = {
      skillType: preferred,
      targetSelector: {
        ...targetSelector(start),
        x: targetX,
        y: barrier.footY
      },
      tick,
      window: tickWindow(tick),
      preconditions: [
        `${preferred} skill is available`,
        'lemming is walking at the barrier face',
        'tunnel path does not intersect steel'
      ],
      expectedPostconditions: [
        `${preferred} clears simple barrier x=${barrier.minX}..${barrier.maxX}`,
        'lemming resumes route toward exit'
      ],
      rationale: `Use ${preferred} to clear a ${barrier.width}px wide, ${barrier.height}px high barrier.`
    };
    const timeout = this.recordAction('Solver budget exhausted while adding barrier action');
    if (timeout) return { result: timeout };
    return { actions: [action] };
  }

  preferredBarrierSkill() {
    const requested = normalizeChallengeType(this.fixture);
    if (requested === 'bash-barrier' && this.canUseSkill('basher')) return 'basher';
    if (requested === 'dig-barrier' && this.canUseSkill('digger')) return 'digger';
    if (requested === 'mine-barrier' && this.canUseSkill('miner')) return 'miner';
    return DESTRUCTIVE_SKILLS.find(skill => this.canUseSkill(skill)) ?? null;
  }

  skillBudget(skill) {
    if (this.allowedSkills.size > 0 && !this.allowedSkills.has(skill)) return 0;
    return skillCount(this.fixture, skill);
  }

  canUseSkill(skill) {
    return this.skillBudget(skill) > 0;
  }

  solvedWithActions(summary, actions, tickEstimate) {
    const timeout = this.recordTicks(tickEstimate, `Solver budget exhausted after ${summary}`);
    if (timeout) return timeout;
    return this.result(SOLVER_RESULT_TYPES.SOLVED, summary, actions, []);
  }

  result(resultType, summary, actions, explanations) {
    return createSolverResult({
      resultType,
      summary,
      actions,
      explanations,
      budgetUsage: this.meter.usage(),
      replaySummary: resultType === SOLVER_RESULT_TYPES.SOLVED
        ? { verifier: 'local-tactical-fixture', verified: true }
        : null
    });
  }
}

const solveTactical = (fixture, options = {}, deps = {}) => new TacticalSolver(fixture, options, deps).solve();

export {
  TacticalSolver,
  solveTactical
};
