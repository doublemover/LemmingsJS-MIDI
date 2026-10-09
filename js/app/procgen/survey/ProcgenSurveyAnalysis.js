import { canonicalSurveyJson, hashSurveyValue, semanticSurveyRandom } from './ProcgenSurveyCanonical.js';
import { freezeSurveyValue, surveyCopy } from './ProcgenSurveyCandidates.js';

const CLOSED_STATUSES = new Set(['completed', 'failed', 'timeout', 'timed-out', 'timed_out']);
const VALIDITY_GATES = ['accountingComplete', 'deterministic', 'protectedTerrain', 'legitimateActions'];
const blockKey = result => canonicalSurveyJson([result.scenarioId, result.policySeed ?? 0]);
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const resultSignature = result => canonicalSurveyJson([result.status, result.lastTick, result.finalStateHash, result.eventHash, result.accounting, result.metrics]);

function surveyEpisodeProblems(result) {
  const problems = [];
  if (!result || !result.episodeComplete || !CLOSED_STATUSES.has(result.status)) return ['incomplete-episode'];
  for (const key of VALIDITY_GATES) if (result.validity?.[key] !== true) problems.push(`unverified-${key}`);
  const accounting = result.accounting || {}, fields = ['designated', 'arrived', 'alive', 'deaths', 'unresolved', 'planned', 'admitted', 'suppressed'];
  if (!fields.every(key => Number.isInteger(accounting[key]) && accounting[key] >= 0) || accounting.designated < 1 || accounting.planned !== accounting.designated || accounting.admitted + accounting.suppressed !== accounting.designated || accounting.arrived > accounting.admitted || accounting.alive + accounting.deaths > accounting.admitted || accounting.unresolved > accounting.designated) problems.push('invalid-accounting');
  if (!result.finalStateHash || !result.eventHash) problems.push('missing-replay-hashes');
  return problems;
}
function outcomeValues(result) {
  const accounting = result.accounting, metrics = result.metrics || {};
  return { completion: accounting.arrived / accounting.designated, survival: accounting.alive / accounting.designated, deaths: accounting.deaths,
    skillCount: Number.isFinite(metrics.skillCount) ? metrics.skillCount : null, excavatedPixels: Number.isFinite(metrics.excavatedPixels) ? metrics.excavatedPixels : null,
    stalls: Number.isFinite(metrics.stalls) ? metrics.stalls : null, completionTicks: accounting.arrived === accounting.designated && Number.isFinite(metrics.lastArrivalTick) ? metrics.lastArrivalTick : null };
}
function pairedProblems(baseline, candidate) {
  const problems = [...surveyEpisodeProblems(baseline), ...surveyEpisodeProblems(candidate)];
  if (baseline.accounting?.designated !== candidate.accounting?.designated) problems.push('different-designated-cohorts');
  for (const key of ['scenarioHash', 'budgetHash', 'sourceHash', 'initialScenarioStateHash']) {
    if (!baseline[key] || !candidate[key]) problems.push(`missing-${key}`);
    else if (baseline[key] !== candidate[key]) problems.push(`different-${key}`);
  }
  return [...new Set(problems)];
}
function summarizeDeltas(pairs, metric, samplingSeed, minimumClusters) {
  const values = pairs.map(pair => pair.deltas[metric]).filter(Number.isFinite), clusters = new Map();
  for (const pair of pairs) if (Number.isFinite(pair.deltas[metric])) {
    const list = clusters.get(pair.clusterId) || []; list.push(pair.deltas[metric]); clusters.set(pair.clusterId, list);
  }
  const clusterMeans = [...clusters.values()].map(mean), summary = { episodes: values.length, clusters: clusterMeans.length, episodeMean: mean(values), clusterMean: mean(clusterMeans), minimum: values.length ? Math.min(...values) : null, maximum: values.length ? Math.max(...values) : null, interval: null };
  if (clusterMeans.length >= minimumClusters) {
    const resampled = [];
    for (let draw = 0; draw < 1024; draw++) {
      let total = 0;
      for (let pick = 0; pick < clusterMeans.length; pick++) total += clusterMeans[Math.floor(semanticSurveyRandom(samplingSeed, 'paired-cluster-bootstrap-v1', metric, draw, pick) * clusterMeans.length)];
      resampled.push(total / clusterMeans.length);
    }
    resampled.sort((a, b) => a - b);
    summary.interval = { low: resampled[25], high: resampled[998], method: 'percentile-cluster-bootstrap', resamples: 1024, coverage: 0.95 };
  }
  return summary;
}

function analyzeProcgenSurveyPairs(results, { baselineId, candidateIds = null, expectedBlocks = null, minimumClusters = 8, samplingSeed = 1, minimumCompletionGain = 0, maximumExtraDeaths = 0 } = {}) {
  if (!baselineId || !Number.isInteger(minimumClusters) || minimumClusters < 2 || !Number.isFinite(minimumCompletionGain) || minimumCompletionGain < 0 || !Number.isInteger(maximumExtraDeaths) || maximumExtraDeaths < 0) throw new Error('Declare a frozen baseline, nonnegative criteria and at least two independent blocks');
  const groups = new Map(), attemptStatuses = {};
  for (const result of results) {
    if (!result?.candidateId || !result.scenarioId) throw new Error('Survey result is missing candidate/scenario identity');
    const key = `${result.candidateId}:${blockKey(result)}`, list = groups.get(key) || []; list.push(result); groups.set(key, list);
    attemptStatuses[result.status || 'unknown'] = (attemptStatuses[result.status || 'unknown'] || 0) + 1;
  }
  const ids = [...(candidateIds || [...new Set(results.map(result => result.candidateId))].filter(id => id !== baselineId))].sort();
  if (new Set(ids).size !== ids.length || ids.includes(baselineId)) throw new Error('Comparison candidate identities must be unique and exclude the baseline');
  const blocks = [...(expectedBlocks || [...new Map(results.map(result => [blockKey(result), { scenarioId: result.scenarioId, policySeed: result.policySeed ?? 0 }])).values()])].sort((a, b) => blockKey(a).localeCompare(blockKey(b)));
  if (new Set(blocks.map(blockKey)).size !== blocks.length) throw new Error('Expected paired blocks must be unique');
  const resolve = (candidateId, block) => {
    const attempts = groups.get(`${candidateId}:${blockKey(block)}`) || [], closed = attempts.filter(result => result.episodeComplete && CLOSED_STATUSES.has(result.status));
    if (new Set(closed.map(resultSignature)).size > 1) return { problem: 'conflicting-completed-attempts' };
    return { result: closed[0] || attempts[0], problem: attempts.length ? null : 'missing-result' };
  };
  const comparisons = ids.map(candidateId => {
    const pairs = [], excluded = [], severeRegressions = [];
    for (const block of blocks) {
      const baseline = resolve(baselineId, block), candidate = resolve(candidateId, block);
      const problems = baseline.problem || candidate.problem ? [baseline.problem, candidate.problem].filter(Boolean) : pairedProblems(baseline.result, candidate.result);
      if (problems.length) { excluded.push({ ...block, reasons: problems, baselineStatus: baseline.result?.status || 'missing', candidateStatus: candidate.result?.status || 'missing' }); continue; }
      const base = baseline.result, contender = candidate.result, left = outcomeValues(base), right = outcomeValues(contender), deltas = {};
      for (const key of Object.keys(left)) deltas[key] = Number.isFinite(left[key]) && Number.isFinite(right[key]) ? right[key] - left[key] : null;
      const clusterId = contender.clusterId ?? base.clusterId ?? (Number.isInteger(contender.environmentSeed) ? String(contender.environmentSeed) : null);
      const pair = { ...block, clusterId: clusterId ?? `unverified:${blockKey(block)}`, independenceDeclared: clusterId !== null, baselineTrialId: base.trialId, candidateTrialId: contender.trialId, deltas, family: contender.scenarioFamily || null, theme: contender.theme || null };
      pairs.push(pair);
      if (deltas.deaths > maximumExtraDeaths || deltas.survival < 0) severeRegressions.push(pair);
    }
    const independentClusters = new Set(pairs.filter(pair => pair.independenceDeclared).map(pair => pair.clusterId)).size;
    const metrics = Object.fromEntries(['completion', 'survival', 'deaths', 'skillCount', 'excavatedPixels', 'stalls', 'completionTicks'].map(key => [key, summarizeDeltas(pairs, key, samplingSeed, minimumClusters)]));
    const sufficient = excluded.length === 0 && independentClusters >= minimumClusters && pairs.every(pair => pair.independenceDeclared);
    let assessment = 'insufficient-evidence';
    if (severeRegressions.length) assessment = 'hard-regression';
    else if (sufficient) assessment = metrics.completion.interval?.low > minimumCompletionGain && metrics.survival.interval?.low >= 0 && metrics.deaths.interval?.high <= maximumExtraDeaths ? 'tested-scope-improvement' : 'no-demonstrated-improvement';
    const costTradeoffs = pairs.filter(pair => pair.deltas.skillCount > 0 || pair.deltas.excavatedPixels > 0 || pair.deltas.stalls > 0);
    return { candidateId, expectedEpisodes: blocks.length, pairedEpisodes: pairs.length, independentClusters, pairs, excluded, severeRegressions, costTradeoffs, metrics, assessment, promotionEligible: assessment === 'tested-scope-improvement' && costTradeoffs.length === 0 };
  });
  return freezeSurveyValue({ schemaVersion: 1, baselineId, attemptStatuses, weighting: 'Equal world-cluster means for intervals; episode means also shown. Replicas and actors are not independent samples.', uncertaintyLimit: 'Intervals describe the declared corpus and assume declared clusters are independent; they do not establish universal reliability.', comparisons });
}

function selectProcgenSurveyExemplars(results, { baselineId, capacities = { success: 4, failure: 4, normal: 2, context: 2 }, casualtyReduction = 1, skillReduction = 2, pinnedTrialIds = [] } = {}) {
  for (const value of Object.values(capacities)) if (!Number.isInteger(value) || value < 0 || value > 64) throw new Error('Exemplar capacities must be integers from zero to 64');
  const baselineGroups = new Map();
  for (const result of results.filter(result => result.candidateId === baselineId)) { const key = blockKey(result), group = baselineGroups.get(key) || []; group.push(result); baselineGroups.set(key, group); }
  const baselineByBlock = new Map([...baselineGroups].filter(([, group]) => new Set(group.filter(result => result.episodeComplete).map(resultSignature)).size === 1).map(([key, group]) => [key, group.find(result => result.episodeComplete)])), pinned = new Set(pinnedTrialIds), selected = [], omitted = [], signatures = new Set(), counts = { success: 0, failure: 0, normal: 0, context: 0 };
  const proposals = [];
  for (const result of results) {
    const problems = surveyEpisodeProblems(result), baseline = baselineByBlock.get(blockKey(result));
    let kind = 'normal', reasons = ['representative-complete-episode'];
    if (problems.length) { kind = 'context'; reasons = problems; }
    else if (result.status !== 'completed' || result.accounting.deaths > 0) { kind = 'failure'; reasons = [result.terminationReason || 'crew-loss-or-incomplete-goal']; }
    else if (baseline && result.candidateId !== baselineId && pairedProblems(baseline, result).length === 0) {
      const left = outcomeValues(baseline), right = outcomeValues(result);
      if (right.completion === 1 && left.completion < 1) reasons = ['whole-crew-completion-baseline-missed'];
      else if (left.deaths - right.deaths >= casualtyReduction) reasons = ['paired-casualty-reduction'];
      else if (right.completion >= left.completion && right.survival >= left.survival && Number.isFinite(left.skillCount) && Number.isFinite(right.skillCount) && left.skillCount - right.skillCount >= skillReduction) reasons = ['paired-skill-reduction'];
      if (reasons[0] !== 'representative-complete-episode') kind = 'success';
    }
    proposals.push({ result, kind, reasons, pinned: pinned.has(result.trialId) });
  }
  proposals.sort((a, b) => Number(b.pinned) - Number(a.pinned) || ['success', 'failure', 'normal', 'context'].indexOf(a.kind) - ['success', 'failure', 'normal', 'context'].indexOf(b.kind) || String(a.result.trialId).localeCompare(String(b.result.trialId)));
  for (const proposal of proposals) {
    const { result, kind, reasons } = proposal, signature = canonicalSurveyJson([kind, result.scenarioFamily || result.scenarioId, result.behaviorSignature || result.eventHash, reasons]);
    if (!proposal.pinned && (signatures.has(signature) || counts[kind] >= (capacities[kind] ?? 0))) { omitted.push({ trialId: result.trialId, reason: signatures.has(signature) ? 'duplicate-behavior-signature' : 'archive-kind-cap' }); continue; }
    signatures.add(signature); counts[kind]++;
    const context = results.filter(other => other.trialId !== result.trialId && blockKey(other) === blockKey(result));
    const normal = proposals.find(other => other.kind === 'normal' && other.result.candidateId !== baselineId && other.result.trialId !== result.trialId && blockKey(other.result) === blockKey(result));
    selected.push({ trialId: result.trialId, kind, reasons, pinned: proposal.pinned, immutableOriginal: true, evidenceComplete: surveyEpisodeProblems(result).length === 0 && result.evidence?.truncated === false && !!result.replayManifest, baselineTrialId: baselineByBlock.get(blockKey(result))?.trialId || null, representativeTrialId: normal?.result.trialId || null, missingContext: [...(!baselineByBlock.has(blockKey(result)) ? ['paired-baseline'] : []), ...(!normal ? ['representative-nonexceptional-comparison'] : [])], contextTrialIds: context.map(other => other.trialId), originalResult: surveyCopy(result) });
  }
  return freezeSurveyValue({ schemaVersion: 1, selected, omitted, counts, pinCount: pinned.size, requiresAdmissionStop: Object.keys(counts).some(kind => counts[kind] > (capacities[kind] ?? 0)), compactSummaryRetention: 'Retain every trial summary, including omitted exemplars and negative verification; selection never changes aggregate denominators.' });
}

function createProcgenSuccessQualification({ original, scenario, candidate, baseline, competitors = [], policySeeds = [], nearbyScenarios = [], holdoutScenarios = [], maxTrials = 32, policyRandomnessRelevant = true }) {
  if (!original?.trialId || !original.replayManifest || original.candidateId !== candidate?.id || original.scenarioId !== scenario?.id || !baseline?.id || !Number.isInteger(maxTrials) || maxTrials < 2) throw new Error('Qualification requires an immutable original, matching manifests, frozen baseline and explicit budget');
  if (candidate.id === baseline.id || scenario.id === undefined) throw new Error('Qualification needs a distinct candidate and baseline');
  const policies = [candidate, baseline, ...competitors], policyIds = new Set(policies.map(policy => policy.id));
  if (policyIds.size !== policies.length || maxTrials < policies.length) throw new Error('Qualification budget must include one complete block of unique policies');
  const seed = original.policySeed ?? 0, seeds = [...new Set(policySeeds)], nearbyIds = new Set(nearbyScenarios.map(item => item.id)), holdoutIds = new Set(holdoutScenarios.map(item => item.id));
  if (nearbyIds.has(scenario.id) || holdoutIds.has(scenario.id) || [...nearbyIds].some(id => holdoutIds.has(id))) throw new Error('Qualification conditions and independent holdout must be distinct');
  for (const policySeed of [seed, ...seeds]) if (!Number.isInteger(policySeed) || policySeed < 0 || policySeed > 0xffffffff) throw new Error('Qualification policy seeds must be unsigned 32-bit integers');
  const developmentSeeds = new Set([scenario, ...nearbyScenarios].map(scene => scene.environmentSeed));
  for (const scene of holdoutScenarios) if (!Number.isInteger(scene.environmentSeed) || developmentSeeds.has(scene.environmentSeed)) throw new Error('Qualification holdout must use unseen environment seeds');
  const jobs = [], deferred = [], jobIds = new Set();
  const add = (stage, scene, policy, policySeed) => {
    const identity = surveyCopy({ stage, sourceTrialId: original.trialId, scenario: scene, candidate: policy, policySeed, sourceManifest: original.replayManifest.sourceManifest, budgetPolicy: original.replayManifest.budgetPolicy });
    const job = { ...identity, id: `verify-${hashSurveyValue(identity)}`, originalTrialId: original.trialId, comparisonKey: hashSurveyValue([stage, scene, policySeed]), separateAttempt: true };
    if (jobIds.has(job.id)) return;
    jobIds.add(job.id);
    jobs.push(job);
  };
  const addBlock = (stage, scene, policySeed) => {
    if (jobs.length + policies.length <= maxTrials) { for (const policy of policies) add(stage, scene, policy, policySeed); }
    else for (const policy of policies) deferred.push({ stage, scenarioId: scene.id, candidateId: policy.id, policySeed, reason: 'qualification-trial-cap' });
  };
  addBlock('exact', scenario, seed);
  if (policyRandomnessRelevant) for (const policySeed of seeds.filter(value => value !== seed)) addBlock('policy-randomness', scenario, policySeed);
  for (const scene of nearbyScenarios) addBlock('nearby-condition', scene, seed);
  for (const scene of holdoutScenarios) addBlock('independent-holdout', scene, seed);
  return freezeSurveyValue({ schemaVersion: 1, originalTrialId: original.trialId, originalManifest: surveyCopy(original.replayManifest), candidate: surveyCopy(candidate), baseline: surveyCopy(baseline), policyRandomnessRelevant, maxTrials, jobs, deferred, completeDeclaration: deferred.length === 0, automaticExecution: false, interpretation: 'Exact replay checks reproducibility, not reliability. Preserve every requested comparison and negative rerun; condition and held-out pairs determine sensitivity and tested-scope improvement.' });
}

function summarizeProcgenSuccessQualification(plan, original, verificationResults, { minimumIndependentWorlds = 8, minimumSensitiveEpisodes = 2, sensitivityFailureFraction = 0.25 } = {}) {
  const records = new Map(verificationResults.map(record => [record.jobId || record.qualificationJobId, record.result || record])), stages = {}, missing = [], valid = [];
  for (const job of plan.jobs) {
    const result = records.get(job.id), problems = result ? surveyEpisodeProblems(result) : ['missing-verification'];
    const stage = stages[job.stage] || { requested: 0, available: 0, eligible: 0, completedGoals: 0, failedGoals: 0 }; stage.requested++;
    if (result) stage.available++;
    if (!problems.length) { stage.eligible++; if (result.status === 'completed') stage.completedGoals++; else stage.failedGoals++; valid.push({ job, result }); }
    else missing.push({ jobId: job.id, reasons: problems });
    stages[job.stage] = stage;
  }
  const exact = valid.filter(record => record.job.stage === 'exact'), candidateExact = exact.find(record => record.job.candidate.id === plan.candidate.id), baselineExact = exact.find(record => record.job.candidate.id === plan.baseline.id);
  const exactReproduced = !!candidateExact && candidateExact.result.finalStateHash === original.finalStateHash && candidateExact.result.eventHash === original.eventHash;
  const sensitivity = valid.filter(record => ['policy-randomness', 'nearby-condition'].includes(record.job.stage) && record.job.candidate.id === plan.candidate.id);
  const sensitivityFailures = sensitivity.filter(record => record.result.status !== 'completed');
  const heldout = valid.filter(record => record.job.stage === 'independent-holdout' && [plan.candidate.id, plan.baseline.id].includes(record.job.candidate.id));
  const heldoutComparison = analyzeProcgenSurveyPairs(heldout.map(record => record.result), { baselineId: plan.baseline.id, candidateIds: [plan.candidate.id], minimumClusters: minimumIndependentWorlds });
  const heldoutPairs = heldoutComparison.comparisons[0], competitors = exact.filter(record => ![plan.candidate.id, plan.baseline.id].includes(record.job.candidate.id));
  let interpretation = 'unresolved';
  if (exactReproduced && !missing.length && !plan.deferred.length) {
    if (sensitivity.length >= minimumSensitiveEpisodes && sensitivityFailures.length / sensitivity.length >= sensitivityFailureFraction) interpretation = 'trajectory-sensitive-win';
    else if (baselineExact?.result.status === 'completed' && competitors.length >= 2 && competitors.every(record => record.result.status === 'completed')) interpretation = 'easy-scene-evidence';
    else if (baselineExact && sensitivity.length >= minimumSensitiveEpisodes && !sensitivityFailures.length && stages['nearby-condition']?.eligible && heldoutPairs.promotionEligible) interpretation = 'tested-scope-improvement';
  }
  return freezeSurveyValue({ schemaVersion: 1, originalTrialId: original.trialId, interpretation, exactReproduced, originalUnchanged: true, missing, deferred: surveyCopy(plan.deferred), stages,
    policyRandomnessRelevant: plan.policyRandomnessRelevant, sensitivityCandidateEpisodes: sensitivity.length, sensitivityFailures: sensitivityFailures.map(record => record.result.trialId), heldoutComparison,
    incomplete: !!missing.length || !!plan.deferred.length, verificationTrialIds: verificationResults.map(record => (record.result || record).trialId),
    uncertainty: 'Exact repeats are consistency checks. Easy-scene evidence concerns this selected scene; trajectory sensitivity and held-out comparisons retain every negative verification. No conclusion establishes general reliability.' });
}
export { surveyEpisodeProblems, analyzeProcgenSurveyPairs, selectProcgenSurveyExemplars, createProcgenSuccessQualification, summarizeProcgenSuccessQualification };
