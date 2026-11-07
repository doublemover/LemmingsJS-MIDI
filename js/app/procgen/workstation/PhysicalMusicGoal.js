import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
const fail = message => { throw Object.assign(new Error(message), { code: 'physical-music-goal' }); };
const finite = (value, min = 0, max = 1000000) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min = 0, max = 1000000) => Number.isSafeInteger(value) && value >= min && value <= max;
const id = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
const keys = (value, allowed) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => allowed.includes(key));
const bounds = value => keys(value, ['x1', 'x2', 'y1', 'y2']) && Object.values(value).every(value => integer(value)) && value.x2 > value.x1 && value.y2 > value.y1;
const selector = value => {
  if (!keys(value, ['role', 'laneId', 'mappingId']) || !Object.keys(value).length || value.role != null && !id(value.role) || value.mappingId != null && !id(value.mappingId) || value.laneId != null && !integer(value.laneId, 0, 1023)) fail('Choose a bounded actual role, physical lane or mapping identity.');
  return value;
};
const matches = (onset, selection) => Object.entries(selection).every(([key, value]) => onset[key] === value);
const weights = Object.freeze({ missed: 4, extra: 2, timing: 1, period: 1, edits: .01 });
export function validatePhysicalMusicGoal(raw) {
  const goal = JSON.parse(canonicalDataText(raw, { maxBytes: 262144, maxNodes: 32768 }).text);
  if (!keys(goal, ['schema', 'id', 'revision', 'timeDomain', 'referenceTimeline', 'targetOnsets', 'periodGoals', 'periodRatios', 'requiredCauseKinds', 'forbiddenCauses', 'allowedEdits', 'crewConstraints', 'skillInventory', 'horizon', 'objectiveWeights', 'musicalInvariants', 'budgets']) ||
      goal.schema !== 'lemmings-physical-music-goal/v1' || !id(goal.id) || !integer(goal.revision, 1) || !['ticks', 'seconds', 'beats'].includes(goal.timeDomain) || !integer(goal.horizon, 1, 4096)) fail('Use a versioned finite physical-music goal and an explicit tick horizon.');
  if (goal.timeDomain !== 'ticks' && (!keys(goal.referenceTimeline, ['tickDurationMs', 'tempoBpm']) || !finite(goal.referenceTimeline.tickDurationMs, .001, 60000) || goal.timeDomain === 'beats' && !finite(goal.referenceTimeline.tempoBpm, .001, 1000000))) fail('Seconds or beats require an explicit fixed study clock; piecewise clocks need their own supported study.');
  if (goal.timeDomain === 'ticks' && goal.referenceTimeline != null) fail('A physical-tick goal does not imply a musical or wall-clock conversion.');
  const scale = goal.timeDomain === 'ticks' ? 1 : goal.timeDomain === 'seconds' ? 1000 / goal.referenceTimeline.tickDurationMs : 60000 / goal.referenceTimeline.tempoBpm / goal.referenceTimeline.tickDurationMs;
  const targets = goal.targetOnsets || [], periods = goal.periodGoals || [], ratios = goal.periodRatios || [];
  if (!Array.isArray(targets) || targets.length > 128 || !Array.isArray(periods) || periods.length > 16 || !Array.isArray(ratios) || ratios.length > 16 || !targets.length && !periods.length && !ratios.length) fail('Choose one to128 desired onsets or an observed period/ratio goal.');
  for (const target of targets) {
    if (!keys(target, ['time', 'tolerance', 'role', 'laneId', 'mappingId']) || !finite(target.time) || !finite(target.tolerance ?? 0) || target.time * scale > goal.horizon || (target.tolerance ?? 0) * scale > goal.horizon) fail('An onset goal/tolerance leaves the finite study horizon.');
    const selection = Object.fromEntries(Object.entries(target).filter(([key]) => !['time', 'tolerance'].includes(key))); if (Object.keys(selection).length) selector(selection);
  }
  for (const period of periods) if (!keys(period, ['selector', 'period', 'tolerance']) || !finite(period.period, .000001) || period.period * scale > goal.horizon || !finite(period.tolerance ?? 0) || !selector(period.selector)) fail('Period goals require an observed source selector, positive period and explicit tolerance.');
  for (const ratio of ratios) if (!keys(ratio, ['left', 'right', 'numerator', 'denominator', 'toleranceTicks']) || !integer(ratio.numerator, 1, 64) || !integer(ratio.denominator, 1, 64) || !finite(ratio.toleranceTicks ?? 0, 0, goal.horizon) || !selector(ratio.left) || !selector(ratio.right)) fail('A ratio needs two actual source selectors and bounded positive integer terms.');
  for (const list of [goal.requiredCauseKinds || [], goal.forbiddenCauses || []]) if (!Array.isArray(list) || list.length > 32 || new Set(list).size !== list.length || list.some(value => !id(value))) fail('Cause constraints must name distinct bounded physical/derived source kinds.');
  if (!Array.isArray(goal.allowedEdits) || goal.allowedEdits.length > 8 || new Set(goal.allowedEdits.map(edit => edit.id)).size !== goal.allowedEdits.length) fail('Choose at most eight distinct finite physical edit handles.');
  for (const edit of goal.allowedEdits) {
    if (!keys(edit, ['id', 'kind', 'laneId', 'bounds', 'pickupId', 'actorId', 'skillType', 'junctionId', 'junctionPolicy', 'eligibilityTicks', 'layerId', 'values']) || !id(edit.id) || !['right-wall-x', 'pickup-x', 'worker-tick', 'release-spread-ticks', 'release-clock-mode', 'junction-configuration', 'layer-muted'].includes(edit.kind) ||
        !Array.isArray(edit.values) || !edit.values.length || edit.values.length > 64 || edit.values.some(value => !integer(value, edit.kind === 'worker-tick' ? 1 : 0, edit.kind === 'worker-tick' ? goal.horizon : 1000000)) || new Set(edit.values).size !== edit.values.length) fail('Every physical handle needs a finite distinct integer domain.');
    if (edit.kind === 'release-spread-ticks' && edit.values.some(value => value > 53) || edit.kind === 'release-clock-mode' && edit.values.some(value => value !== 0 && value !== 1)) fail('Release samples use0..53 spread ticks or clock mode0=locked/1=adaptive.');
    if (edit.kind === 'junction-configuration' && (!id(edit.junctionId) || edit.values.some(value => value > 2) || !integer(edit.eligibilityTicks ?? 0, 0, 600) || !['rejectIfBusy', 'waitForSafeBoundary'].includes(edit.junctionPolicy ?? 'waitForSafeBoundary'))) fail('A junction sample needs an actual definition, configuration index and bounded eligibility window.');
    if (edit.kind === 'layer-muted' && (!id(edit.layerId) || edit.values.some(value => value !== 0 && value !== 1))) fail('A layer sample needs an actual layer identity and0=unmuted/1=muted.');
    if (edit.kind === 'right-wall-x' && (!integer(edit.laneId, 0, 1023) || !bounds(edit.bounds) || edit.values.some(value => value < edit.bounds.x1 || value > edit.bounds.x2))) fail('A wall domain needs its exact editable world rectangle.');
    if (edit.kind === 'pickup-x' && !id(edit.pickupId)) fail('A pickup domain needs the actual authored pickup identity.');
    if (edit.kind === 'worker-tick' && (!integer(edit.actorId) || !['builder', 'basher', 'digger', 'miner'].includes(edit.skillType))) fail('A skill-time domain needs one real actor and supported shared action.');
    edit.values.sort((a, b) => a - b);
  }
  const crew = goal.crewConstraints;
  if (!keys(crew, ['requireAllSurvive', 'maximumActors', 'containment', 'protectedRegions']) || crew.requireAllSurvive !== true || !integer(crew.maximumActors, 1, 64) || !bounds(crew.containment) || !Array.isArray(crew.protectedRegions) || crew.protectedRegions.length > 32 || crew.protectedRegions.some(region => !bounds(region))) fail('The first study domain needs a finite protected crew, containment and explicit protected terrain.');
  if (!keys(goal.skillInventory, ['builder', 'basher', 'digger', 'miner']) || Object.values(goal.skillInventory).some(value => !integer(value, 0, 64))) fail('Declare the finite joint skill inventory.');
  const budget = goal.budgets;
  if (!keys(budget, ['maximumCandidates', 'logicalTicks', 'wallTimeMs', 'maximumOnsets', 'maximumFacts', 'finalists']) || !integer(budget.maximumCandidates, 1, 64) || !integer(budget.logicalTicks, 1, 262144) ||
      budget.wallTimeMs != null && !integer(budget.wallTimeMs, 1, 60000) || !integer(budget.maximumOnsets ?? 2048, 1, 8192) || !integer(budget.maximumFacts ?? 65536, 1, 262144) || !integer(budget.finalists ?? 1, 1, 4)) fail('Choose explicit candidate/logical-work/trace/finalist bounds.');
  if (goal.objectiveWeights != null && (!keys(goal.objectiveWeights, Object.keys(weights)) || Object.values(goal.objectiveWeights).some(value => !finite(value, 0, 1000)))) fail('Goal weights must remain finite and bounded.');
  const invariants = goal.musicalInvariants || {};
  if (!keys(invariants, ['maximumSemanticPolyphony', 'maximumOnsetFreeGapTicks', 'minimumMotifCompletions']) || invariants.maximumSemanticPolyphony != null && !integer(invariants.maximumSemanticPolyphony, 0, 4096) || invariants.maximumOnsetFreeGapTicks != null && !finite(invariants.maximumOnsetFreeGapTicks, 0, goal.horizon) ||
      invariants.minimumMotifCompletions != null && (!Array.isArray(invariants.minimumMotifCompletions) || invariants.minimumMotifCompletions.length > 16 || invariants.minimumMotifCompletions.some(value => !keys(value, ['motifId', 'count']) || !id(value.motifId) || !integer(value.count, 0, 512)))) fail('Musical invariants need bounded semantic polyphony, onset-free gaps and actual motif completion counts.');
  goal.musicalInvariants = invariants;
  goal.objectiveWeights = { ...weights, ...goal.objectiveWeights }; if (!goal.objectiveWeights.missed || !goal.objectiveWeights.extra) fail('Missing and extra actual attacks must retain positive cost.');
  goal.targetOnsets = targets; goal.periodGoals = periods; goal.periodRatios = ratios; goal.requiredCauseKinds ||= []; goal.forbiddenCauses ||= [];
  return freezeData(goal);
}
export function enumeratePhysicalMusicCandidates(raw) {
  const goal = validatePhysicalMusicGoal(raw), edits = [...goal.allowedEdits].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), count = edits.reduce((total, edit) => total * edit.values.length, 1), candidates = [];
  const visit = (index, values) => {
    if (candidates.length >= goal.budgets.maximumCandidates) return;
    if (index === edits.length) { candidates.push(freezeData({ id: goal.id + ':candidate:' + candidates.length, values: { ...values }, edits: edits.map(edit => { const { values: _domain, ...definition } = edit; return { ...definition, value: values[edit.id] }; }) })); return; }
    for (const value of edits[index].values) { values[edits[index].id] = value; visit(index + 1, values); if (candidates.length >= goal.budgets.maximumCandidates) break; }
  };
  visit(0, {}); return Object.freeze({ candidates: Object.freeze(candidates), totalCombinations: count, completeDomainEnumerated: candidates.length === count, order: 'handle-id-then-integer-value-lexicographic', timingMode: goal.budgets.wallTimeMs == null ? 'deterministic-logical-work' : 'wall-time-best-effort' });
}
function assignment(cost, rows, columns) {
  const u = new Float64Array(rows + 1), v = new Float64Array(columns + 1), p = new Int32Array(columns + 1), way = new Int32Array(columns + 1);
  for (let row = 1; row <= rows; row++) {
    p[0] = row; let column = 0; const minimum = new Float64Array(columns + 1).fill(Infinity), used = new Uint8Array(columns + 1);
    do { used[column] = 1; const current = p[column]; let delta = Infinity, next = 0;
      for (let at = 1; at <= columns; at++) if (!used[at]) { const reduced = cost[(current - 1) * columns + at - 1] - u[current] - v[at]; if (reduced < minimum[at]) { minimum[at] = reduced; way[at] = column; } if (minimum[at] < delta) { delta = minimum[at]; next = at; } }
      for (let at = 0; at <= columns; at++) if (used[at]) { u[p[at]] += delta; v[at] -= delta; } else minimum[at] -= delta; column = next;
    } while (p[column]);
    do { const previous = way[column]; p[column] = p[previous]; column = previous; } while (column);
  }
  const result = new Int32Array(rows).fill(-1); for (let column = 1; column <= columns; column++) if (p[column]) result[p[column] - 1] = column - 1; return result;
}
export function evaluatePhysicalMusicGoal(raw, onsets, { causeKinds = [], editCost = 0 } = {}) {
  const goal = validatePhysicalMusicGoal(raw), maximumOnsets = goal.budgets.maximumOnsets ?? 2048;
  if (!Array.isArray(onsets) || onsets.length > maximumOnsets || onsets.some(onset => !onset || typeof onset.intentId !== 'string' || !onset.intentId.length || onset.intentId.length > 1024 || !finite(onset.timeTicks, 0, goal.horizon)) || !finite(editCost)) fail('The actual onset trace is incomplete, invalid or beyond the admitted study profile.');
  if (new Set(onsets.map(onset => onset.intentId)).size !== onsets.length) fail('An actual onset cannot appear twice in the source trace.');
  const scale = goal.timeDomain === 'ticks' ? 1 : goal.timeDomain === 'seconds' ? 1000 / goal.referenceTimeline.tickDurationMs : 60000 / goal.referenceTimeline.tempoBpm / goal.referenceTimeline.tickDurationMs,
    targets = goal.targetOnsets.map((target, index) => ({ index, tick: target.time * scale, tolerance: (target.tolerance ?? 0) * scale, selector: Object.fromEntries(Object.entries(target).filter(([key]) => !['time', 'tolerance'].includes(key))) }));
  const eligible = targets.length ? onsets.map((onset, index) => ({ onset, index })).filter(({ onset }) => targets.some(target => matches(onset, target.selector) && Math.abs(onset.timeTicks - target.tick) <= target.tolerance)) : [];
  if (eligible.length > 256) return Object.freeze({ status: 'unsupported', reason: 'Exact one-to-one matching exceeds the256 eligible-onset profile; no source events were silently removed.' });
  const columns = eligible.length + targets.length, cost = new Float64Array(targets.length * columns), w = goal.objectiveWeights;
  for (const target of targets) for (let column = 0; column < columns; column++) {
    const onset = eligible[column]?.onset, difference = onset ? Math.abs(onset.timeTicks - target.tick) : 0;
    cost[target.index * columns + column] = !onset ? w.missed : matches(onset, target.selector) && difference <= target.tolerance ? difference * w.timing - w.extra : 1e12;
  }
  const paired = targets.length ? assignment(cost, targets.length, columns) : [], used = new Set(), matched = [], missed = [];
  for (const target of targets) { const actual = eligible[paired[target.index]]; if (actual && cost[target.index * columns + paired[target.index]] < 1e12) { used.add(actual.index); matched.push({ targetIndex: target.index, actualIndex: actual.index, intentId: actual.onset.intentId, requestedTick: target.tick, actualTick: actual.onset.timeTicks, errorTicks: actual.onset.timeTicks - target.tick }); } else missed.push(target.index); }
  const extras = targets.length ? onsets.map((_, index) => index).filter(index => !used.has(index)) : [], period = selection => {
    const times = onsets.filter(onset => matches(onset, selection)).map(onset => onset.timeTicks).sort((a, b) => a - b), intervals = times.slice(1).map((time, index) => time - times[index]);
    return { selector: selection, observations: times.length, intervals, meanTicks: intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null,
      minimumTicks: intervals.length ? Math.min(...intervals) : null, maximumTicks: intervals.length ? Math.max(...intervals) : null };
  };
  const periods = goal.periodGoals.map(request => { const actual = period(request.selector), requestedTicks = request.period * scale, toleranceTicks = (request.tolerance ?? 0) * scale,
    errorTicks = actual.meanTicks == null ? null : actual.meanTicks - requestedTicks;
  return { ...actual, requestedTicks, toleranceTicks, errorTicks, satisfied: actual.observations >= 3 && actual.intervals.every(value => Math.abs(value - requestedTicks) <= toleranceTicks) }; });
  const ratios = goal.periodRatios.map(request => {
    const left = period(request.left), right = period(request.right), toleranceTicks = request.toleranceTicks ?? 0,
      errorTicks = left.meanTicks == null || right.meanTicks == null ? null : Math.abs(left.meanTicks * request.denominator - right.meanTicks * request.numerator) / Math.max(request.numerator, request.denominator);
    return { left, right, numerator: request.numerator, denominator: request.denominator, toleranceTicks, errorTicks,
      satisfied: left.observations >= 3 && right.observations >= 3 && left.maximumTicks - left.minimumTicks <= toleranceTicks && right.maximumTicks - right.minimumTicks <= toleranceTicks && errorTicks <= toleranceTicks };
  });
  const observed = new Set(causeKinds), missingCauseKinds = goal.requiredCauseKinds.filter(kind => !observed.has(kind)), forbiddenCauseKinds = goal.forbiddenCauses.filter(kind => observed.has(kind)),
    absoluteTimingError = matched.reduce((sum, pair) => sum + Math.abs(pair.errorTicks), 0), periodError = [...periods, ...ratios].reduce((sum, result) => sum + (result.errorTicks == null ? goal.horizon : Math.abs(result.errorTicks)), 0),
    score = missed.length * w.missed + extras.length * w.extra + absoluteTimingError * w.timing + periodError * w.period + editCost * w.edits;
  return freezeData({ status: 'evaluated', score, matched, missedTargets: missed, extraActualOnsets: extras, absoluteTimingErrorTicks: absoluteTimingError, periods, ratios, missingCauseKinds, forbiddenCauseKinds, editCost,
    requestedMetricsMet: !missed.length && !extras.length && periods.every(result => result.satisfied) && ratios.every(result => result.satisfied) && !missingCauseKinds.length && !forbiddenCauseKinds.length,
    authority: 'actual-onset-metrics;physical-safety-and-independent-fresh-finalist-replay-remain-required' });
}

export function evaluatePhysicalMusicInvariants(goal, metrics) {
  const constraints = goal.musicalInvariants || {}, rows = [], maximum = (kind, requested, actual) => { if (requested != null) rows.push({ kind, requestedMaximum: requested, actual: actual ?? null, status: actual == null ? 'unknown' : actual <= requested ? 'met' : 'failed' }); };
  maximum('semantic-polyphony', constraints.maximumSemanticPolyphony, metrics?.semanticPolyphony?.maximum);
  maximum('onset-free-gap-ticks', constraints.maximumOnsetFreeGapTicks, metrics?.onsetFreeGaps?.maximumTicks);
  for (const request of constraints.minimumMotifCompletions || []) { const actual = metrics?.observationCoverage === 'complete-admitted-observation-profile' ? Object.hasOwn(metrics.motifCounts, request.motifId) ? metrics.motifCounts[request.motifId] : 0 : null;
    rows.push({ kind: 'motif-completions', motifId: request.motifId, requestedMinimum: request.count, actual, status: actual == null ? 'unknown' : actual >= request.count ? 'met' : 'failed' }); }
  return freezeData({ results: rows, allMet: rows.every(row => row.status === 'met'), coverage: rows.some(row => row.status === 'unknown') ? 'unknown' : 'complete' });
}
