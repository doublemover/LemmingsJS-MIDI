import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
const text = value => canonicalDataText(value, { maxBytes: 8 * 1048576, maxNodes: 524288 }).text;
const onsetIdentity = onset => [onset.actorId, onset.mappingId, onset.sourceKind, onset.topologyComponent];
export function summarizePhysicalMusicSensitivity(study) {
  if (study?.schema !== 'lemmings-physical-music-study/v1' || study.mode !== 'sensitivity') throw new TypeError('Use an actual completed physical sensitivity study.');
  const handles = [...study.goal.allowedEdits].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), samples = study.rows.map(row => ({
      candidateId: row.id, values: row.values, status: row.status, reason: row.reason || null,
      score: row.metrics?.score ?? null, requestedMetricsMet: row.metrics?.requestedMetricsMet === true, semanticMetrics: row.metrics?.semanticMetrics || null, invariantResults: row.metrics?.invariantResults || null, periods: row.metrics?.periods ?? [], ratios: row.metrics?.ratios ?? [], onsets: row.trace?.onsets ?? [],
      safetyFailures: row.trace?.safetyFailures ?? [], rejectedInputs: row.trace?.rejectedInputs ?? [], discontinuities: row.trace?.discontinuities ?? [],
      traceHash: row.traceHash ?? null, correspondence: row.trace ? text({ initialCrew: study.constraints.actorIds, causes: row.trace.correspondence,
        onsets: row.trace.onsets.map(onsetIdentity), discontinuities: row.trace.discontinuities.map(value => [value.kind, value.actorId, value.reason]) }) : null
    })), edges = [];
  for (const handle of handles) {
    const other = handles.filter(value => value.id !== handle.id), groups = new Map();
    for (const sample of samples) { const key = text(other.map(value => [value.id, sample.values[value.id]])); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(sample); }
    for (const group of groups.values()) {
      group.sort((a, b) => a.values[handle.id] - b.values[handle.id]);
      for (let index = 1; index < group.length; index++) {
        const left = group[index - 1], right = group[index], delta = right.values[handle.id] - left.values[handle.id], gap = delta > 1,
          categorical = ['release-clock-mode', 'junction-configuration', 'layer-muted'].includes(handle.kind), matched = !categorical && left.status === 'sample-safe' && right.status === 'sample-safe' && left.correspondence === right.correspondence && !left.rejectedInputs.length && !right.rejectedInputs.length &&
            !left.discontinuities.length && !right.discontinuities.length,
          eventDeltas = matched ? left.onsets.map((onset, at) => ({ actorId: onset.actorId, mappingId: onset.mappingId, occurrence: at,
            fromTick: onset.timeTicks, toTick: right.onsets[at].timeTicks, ticksPerIntegerUnit: (right.onsets[at].timeTicks - onset.timeTicks) / delta })) : [];
        edges.push({ handleId: handle.id, from: left.candidateId, to: right.candidateId, fromValue: left.values[handle.id], toValue: right.values[handle.id],
          status: categorical ? 'categorical-physical-control-comparison;no-derivative' : matched ? 'matching-sampled-finite-difference' : 'discontinuity-or-unknown', interveningIntegers: gap ? 'untested-gap' : 'adjacent-integer-samples',
          scorePerIntegerUnit: matched && left.score != null && right.score != null ? (right.score - left.score) / delta : null, onsetDeltas: eventDeltas,
          continuousSafetyClaim: false, continuousDerivativeClaim: false });
      }
    }
  }
  return freezeData({ schema: 'lemmings-physical-music-sensitivity/v1', sourceIdentity: study.sourceIdentity, base: study.base,
    domain: { handles, seedSet: [study.base.seed], seedCoverage: 'one-exact-source-seed;no-other-seed-claim', parameterUnits: handles.map(handle => ({ id: handle.id, unit: handle.kind === 'release-clock-mode' ? 'enum:0-locked,1-adaptive' : handle.kind === 'junction-configuration' ? 'authored-configuration-index' : handle.kind === 'layer-muted' ? 'enum:0-unmuted,1-muted' : ['worker-tick', 'release-spread-ticks'].includes(handle.kind) ? 'simulation-ticks' : 'world-pixels' })), horizonTicks: study.goal.horizon, timeDomain: study.goal.timeDomain, referenceTimeline: study.goal.referenceTimeline || null,
      completeFiniteGrid: study.coverage.completeDomain, untestedCandidates: study.coverage.untestedCandidates, adaptivePolicyPreserved: true },
    requestedInvariantCoverage: { allDeclaredSamplesMet: study.coverage.completeDomain && samples.every(sample => sample.status === 'sample-safe' && sample.requestedMetricsMet),
      failingPoints: samples.filter(sample => sample.status === 'sample-failed' || sample.status === 'sample-safe' && !sample.requestedMetricsMet).map(sample => ({ candidateId: sample.candidateId, values: sample.values })),
      unknownPoints: samples.filter(sample => sample.status === 'unknown').map(sample => ({ candidateId: sample.candidateId, values: sample.values })), untestedCandidates: study.coverage.untestedCandidates },
    samples: samples.map(({ correspondence: _private, ...sample }) => sample), edges, work: study.work,
    authority: 'sampled-real-physics-and-causal-intents;gaps-unknown;finite-differences-only-for-corresponding-cause-actor-topology-structures' });
}
