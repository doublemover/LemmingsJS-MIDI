import { SOLVER_EXPLANATION_CODES } from './SolverTypes.js';
import { analyzeSolverGeometry } from './SolverGeometry.js';
import { extractSolverState, isSolverState, stableHash } from './SolverState.js';

const SUPPORTED_HAZARD_KINDS = new Set([
  'fall',
  'frying',
  'hazard',
  'kill',
  'lethal-fall',
  'trap',
  'water',
  'drown'
]);

const DESTRUCTIVE_SKILLS = Object.freeze(['basher', 'digger', 'miner']);

const rectRight = rect => rect.x + rect.width - 1;
const rectBottom = rect => rect.y + rect.height - 1;

const rectsOverlap = (left, right) => (
  left.x <= rectRight(right) &&
  rectRight(left) >= right.x &&
  left.y <= rectBottom(right) &&
  rectBottom(left) >= right.y
);

const toCount = value => {
  const next = Number(value);
  return Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
};

const getSkillCount = (snapshot, skill) => toCount(snapshot.skills?.counts?.[skill]);

const normalizeHazardKind = kind => {
  const key = String(kind || 'hazard').trim().toLowerCase();
  if (key === 'drowning') return 'drown';
  if (key === 'fire' || key === 'fryer') return 'frying';
  if (key === 'drop') return 'fall';
  return key || 'hazard';
};

const blockedByOneWay = (snapshot, rect, skill, direction = null) => {
  if (!DESTRUCTIVE_SKILLS.includes(skill)) return [];
  return snapshot.oneWay.filter(oneWay => {
    if (!rectsOverlap(rect, oneWay)) return false;
    if (!direction || oneWay.direction === 'unknown') return true;
    return oneWay.direction !== direction;
  });
};

const steelInRect = (snapshot, rect) => snapshot.steel.constraints
  .filter(steel => rectsOverlap(rect, steel));

const createExplanation = (code, detail, data = undefined) => ({
  code,
  detail,
  ...(data ? { data } : {})
});

const createHazardRecords = (snapshot, geometry) => {
  const records = snapshot.hazards.map((hazard, index) => {
    const kind = normalizeHazardKind(hazard.kind);
    return {
      id: `hazard:${index}`,
      source: 'snapshot',
      kind,
      rect: {
        x: hazard.x,
        y: hazard.y,
        width: hazard.width,
        height: hazard.height
      },
      supported: SUPPORTED_HAZARD_KINDS.has(kind),
      explanation: SUPPORTED_HAZARD_KINDS.has(kind)
        ? null
        : createExplanation(
          SOLVER_EXPLANATION_CODES.UNSUPPORTED_MECHANIC,
          `Unsupported hazard mechanic: ${kind}`,
          { kind }
        )
    };
  });
  for (const cliff of geometry.cliffs) {
    if (cliff.safe || cliff.fallDistance == null) continue;
    records.push({
      id: `lethal-fall:${cliff.surfaceId}:${cliff.side}`,
      source: 'geometry',
      kind: 'lethal-fall',
      rect: {
        x: cliff.x,
        y: cliff.y,
        width: 1,
        height: Math.max(1, cliff.fallDistance)
      },
      supported: true,
      explanation: createExplanation(
        SOLVER_EXPLANATION_CODES.HAZARD_UNAVOIDABLE,
        `Fall distance ${cliff.fallDistance}px exceeds the configured safe fall bound.`,
        { fallDistance: cliff.fallDistance }
      )
    });
  }
  return records.sort((a, b) => (
    a.rect.y - b.rect.y ||
    a.rect.x - b.rect.x ||
    a.kind.localeCompare(b.kind) ||
    a.id.localeCompare(b.id)
  ));
};

const builderAffordances = (snapshot, geometry) => geometry.gaps.map((gap, index) => {
  const requiredSkillCount = Math.max(1, Math.ceil(gap.width / 12));
  return {
    id: `builder:${index}`,
    type: 'builder-bridge',
    skillType: 'builder',
    fromSurfaceId: gap.fromSurfaceId,
    toSurfaceId: gap.toSurfaceId,
    rect: {
      x: gap.x,
      y: gap.y,
      width: gap.width,
      height: 2
    },
    requiredSkillCount,
    availableSkillCount: getSkillCount(snapshot, 'builder'),
    blocked: false,
    blockers: [],
    roughTimingWindow: {
      start: Math.max(0, gap.x - 12),
      end: gap.x + Math.max(6, gap.width * 2)
    }
  };
});

const destructiveAffordances = (snapshot, geometry) => {
  const out = [];
  for (const barrier of geometry.barriers) {
    const rect = {
      x: barrier.x,
      y: barrier.y,
      width: barrier.width,
      height: barrier.height
    };
    const direction = barrier.side === 'right' ? 'right' : 'left';
    for (const skill of DESTRUCTIVE_SKILLS) {
      const steelBlockers = steelInRect(snapshot, rect);
      const oneWayBlockers = blockedByOneWay(snapshot, rect, skill, direction);
      const blockers = [
        ...steelBlockers.map(steel => ({
          type: 'steel',
          rect: { x: steel.x, y: steel.y, width: steel.width, height: steel.height }
        })),
        ...oneWayBlockers.map(oneWay => ({
          type: 'one-way',
          direction: oneWay.direction,
          rect: { x: oneWay.x, y: oneWay.y, width: oneWay.width, height: oneWay.height }
        }))
      ];
      out.push({
        id: `${skill}:${barrier.id}`,
        type: `${skill}-tunnel`,
        skillType: skill,
        fromSurfaceId: barrier.surfaceId,
        toSurfaceId: null,
        rect,
        requiredSkillCount: 1,
        availableSkillCount: getSkillCount(snapshot, skill),
        blocked: blockers.length > 0,
        blockers,
        explanation: blockers.some(blocker => blocker.type === 'steel')
          ? createExplanation(SOLVER_EXPLANATION_CODES.BARRIER_BLOCKED_BY_STEEL, 'Destructive path intersects steel.')
          : blockers.some(blocker => blocker.type === 'one-way')
            ? createExplanation(SOLVER_EXPLANATION_CODES.ONE_WAY_BLOCKED, 'Destructive path conflicts with one-way terrain.')
            : null,
        roughTimingWindow: {
          start: Math.max(0, barrier.x - 8),
          end: barrier.x + barrier.width + 12
        }
      });
    }
  }
  return out;
};

const floaterAffordances = (snapshot, geometry) => geometry.cliffs
  .filter(cliff => !cliff.safe && cliff.landing)
  .map((cliff, index) => ({
    id: `floater:${index}`,
    type: 'floater-fall',
    skillType: 'floater',
    fromSurfaceId: cliff.surfaceId,
    toSurfaceId: cliff.landing.surfaceId,
    rect: {
      x: cliff.x,
      y: cliff.y,
      width: 1,
      height: Math.max(1, cliff.fallDistance ?? 1)
    },
    requiredSkillCount: 1,
    availableSkillCount: getSkillCount(snapshot, 'floater'),
    blocked: false,
    blockers: [],
    roughTimingWindow: {
      start: Math.max(0, cliff.x - 8),
      end: cliff.x + 8
    }
  }));

const blockerAffordances = (snapshot, geometry) => geometry.surfaces.map(surface => ({
  id: `blocker:${surface.id}`,
  type: 'blocker-turn',
  skillType: 'blocker',
  fromSurfaceId: surface.id,
  toSurfaceId: surface.id,
  rect: {
    x: surface.x,
    y: surface.y,
    width: surface.width,
    height: 1
  },
  requiredSkillCount: 1,
  availableSkillCount: getSkillCount(snapshot, 'blocker'),
  blocked: false,
  blockers: [],
  roughTimingWindow: {
    start: Math.max(0, surface.x),
    end: Math.max(0, surface.right)
  }
}));

const analyzeSolverAffordances = (input, options = {}) => {
  const snapshot = isSolverState(input) ? input : extractSolverState(input, options);
  const geometry = options.geometry ?? analyzeSolverGeometry(snapshot, options.geometryOptions ?? options);
  const hazards = createHazardRecords(snapshot, geometry);
  const skillAffordances = [
    ...builderAffordances(snapshot, geometry),
    ...destructiveAffordances(snapshot, geometry),
    ...floaterAffordances(snapshot, geometry),
    ...blockerAffordances(snapshot, geometry)
  ].sort((a, b) => (
    a.rect.y - b.rect.y ||
    a.rect.x - b.rect.x ||
    a.skillType.localeCompare(b.skillType) ||
    a.id.localeCompare(b.id)
  ));
  const explanations = hazards
    .map(hazard => hazard.explanation)
    .concat(skillAffordances.map(affordance => affordance.explanation))
    .filter(Boolean);
  const analysis = {
    kind: 'solver-analysis',
    stateHash: snapshot.snapshotHash,
    geometryHash: geometry.geometryHash,
    terrainMutationHash: snapshot.terrainMutationHash,
    hazards,
    skillAffordances,
    unsupportedMechanics: hazards
      .filter(hazard => !hazard.supported)
      .map(hazard => hazard.kind)
      .sort(),
    explanations
  };
  analysis.analysisHash = stableHash({
    stateHash: analysis.stateHash,
    geometryHash: analysis.geometryHash,
    terrainMutationHash: analysis.terrainMutationHash,
    hazards,
    skillAffordances
  });
  return analysis;
};

export {
  analyzeSolverAffordances
};
