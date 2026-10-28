import { runBoundedTimingSearch } from './SolverTimingSearch.js';

const DEFAULT_SKILL_FOR_EDGE = Object.freeze({
  build: 'builder',
  basher: 'basher',
  digger: 'digger',
  miner: 'miner',
  fall: 'floater',
  'blocker-turn': 'blocker'
});

const mutationBoundsForSegment = segment => segment?.mutation?.affectedBounds ?? null;

const windowForSegment = (segment, fallbackTick) => {
  const raw = segment.roughActionWindow;
  if (raw) {
    if (!Number.isSafeInteger(raw.start) || !Number.isSafeInteger(raw.end) || raw.start < 0 || raw.end < 0 || raw.end < raw.start) return { start: raw.start, end: raw.end };
    const mutationBounds = mutationBoundsForSegment(segment);
    return {
      start: mutationBounds
        ? 0
        : Math.max(0, Math.floor(Number(raw.start) || 0)),
      end: Math.max(0, Math.floor(Number(raw.end) || 0))
    };
  }
  return {
    start: Math.max(0, fallbackTick - 6),
    end: fallbackTick + 6
  };
};

const spatialPreconditionsForSegment = segment => {
  const bounds = mutationBoundsForSegment(segment);
  if (!bounds) return [];
  const x = Math.max(0, Math.floor(Number(bounds.x) || 0));
  const margin = segment.type === 'build' ? 4 : 2;
  return [{
    type: 'lemmingXAtLeast',
    x: Math.max(0, x - margin)
  }];
};

const actionForSegment = (segment, tickCursor) => {
  const skillType = segment.requiredSkillFamilies?.[0] ?? DEFAULT_SKILL_FOR_EDGE[segment.type] ?? null;
  if (!skillType) return null;
  const window = windowForSegment(segment, tickCursor);
  return {
    skillType,
    target: segment.target ?? {
      kind: 'lemming',
      role: skillType === 'blocker' ? 'blocker-anchor' : 'frontier'
    },
    tick: null,
    window,
    preconditions: [
      { type: 'skillAvailable', skillType, count: 1 },
      'target-active',
      ...spatialPreconditionsForSegment(segment)
    ],
    expectedPostconditions: segment.expectedPostconditions ?? [],
    rationale: `Apply ${skillType} for ${segment.type} segment ${segment.index}.`
  };
};

const buildCandidateScript = (routeSkeleton, maximumActions) => {
  const actions = [];
  let tickCursor = 0;
  for (const segment of routeSkeleton.segments ?? []) {
    tickCursor += 12;
    const skill = segment.requiredSkillFamilies?.[0] ?? DEFAULT_SKILL_FOR_EDGE[segment.type];
    const required = segment.requiredSkillCounts ?? (skill ? { [skill]: segment.requiredSkillCount ?? 1 } : {});
    for (const [family, count] of Object.entries(required)) {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid route skill requirement.');
      for (let index = 0; index < count; index++) {
        const action = actionForSegment({ ...segment, requiredSkillFamilies: [family] }, tickCursor); actions.push(action);
        if (actions.length > maximumActions) return actions;
      }
    }
    if (actions.length) tickCursor = Math.max(tickCursor, actions.at(-1).window.end);
  }
  return actions;
};

const searchActionTiming = (runnerOrSource, routeOrInput = null, options = {}) =>
  runBoundedTimingSearch(runnerOrSource, routeOrInput, options, buildCandidateScript);

export {
  searchActionTiming
};
