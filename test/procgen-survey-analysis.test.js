import { expect } from 'chai';
import { DEFAULT_PROCGEN_POLICY_CONFIG } from '../js/app/procgen/ProcgenPolicyConfig.js';
import { canonicalSurveyJson } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { SURVEY_FAMILIES, generateProcgenSurveyCandidates, createProcgenSurveyExperiment } from '../js/app/procgen/survey/ProcgenSurveyCandidates.js';
import { surveyEpisodeProblems, analyzeProcgenSurveyPairs, selectProcgenSurveyExemplars, createProcgenSuccessQualification, summarizeProcgenSuccessQualification } from '../js/app/procgen/survey/ProcgenSurveyAnalysis.js';

const episode = (candidateId = 'candidate', seed = 1, overrides = {}) => ({ trialId: `${candidateId}:${seed}`, candidateId, scenarioId: `scene:${seed}`, policySeed: 1, environmentSeed: seed, episodeComplete: true, status: 'completed', lastTick: 100,
  validity: { deterministic: true, accountingComplete: true, protectedTerrain: true, legitimateActions: true }, scenarioHash: `scene-hash:${seed}`, budgetHash: 'budget', sourceHash: 'source', initialScenarioStateHash: 'physical-state', initialStateHash: `policy-state:${candidateId}`, finalStateHash: `final:${candidateId}:${seed}`, eventHash: `events:${candidateId}:${seed}`,
  accounting: { designated: 8, planned: 8, admitted: 8, suppressed: 0, arrived: 8, alive: 8, deaths: 0, unresolved: 0 }, metrics: { skillCount: 4, excavatedPixels: 0, stalls: 0, lastArrivalTick: 80 }, evidence: { truncated: false }, replayManifest: { sourceManifest: { engineCommit: 'commit', assetHashes: { terrain: 'sha256' } }, budgetPolicy: { horizonTicks: 100 } }, ...overrides });
const baselineEpisode = seed => episode('baseline', seed, { status: 'timeout', accounting: { designated: 8, planned: 8, admitted: 8, suppressed: 0, arrived: 4, alive: 8, deaths: 0, unresolved: 4 } });
const qualificationInput = () => ({ original: episode(), scenario: { id: 'scene:1', environmentSeed: 1 }, candidate: { id: 'candidate', configuration: { ...DEFAULT_PROCGEN_POLICY_CONFIG, randomMode: 'semantic' } }, baseline: { id: 'baseline', configuration: DEFAULT_PROCGEN_POLICY_CONFIG }, competitors: [{ id: 'competitor', configuration: { ...DEFAULT_PROCGEN_POLICY_CONFIG, learningEnabled: false } }], policySeeds: [1, 2, 3], nearbyScenarios: [{ id: 'nearby', environmentSeed: 1 }], holdoutScenarios: [{ id: 'heldout', environmentSeed: 2 }], maxTrials: 32 });

describe('procgen survey constrained design and honest paired evidence', () => {
  it('retains exact baseline and no-learning anchors, frozen normalized manifests and meaningful balanced families', () => {
    const candidates = generateProcgenSurveyCandidates();
    expect(candidates).to.have.length(16); expect(candidates[0].configuration).to.deep.equal(DEFAULT_PROCGEN_POLICY_CONFIG);
    expect(candidates[1].configuration).to.deep.equal({ ...DEFAULT_PROCGEN_POLICY_CONFIG, learningEnabled: false });
    expect(candidates.filter(item => item.family === 'balanced')).to.have.length(5);
    expect(candidates.filter(item => item.family === 'build-preserving')).to.have.length(5);
    expect(candidates.filter(item => item.family === 'exploratory')).to.have.length(4);
    expect(new Set(candidates.map(item => canonicalSurveyJson(item.configuration))).size).to.equal(16);
    expect(() => { candidates[2].configuration.builderBias = 7; }).to.throw(TypeError);
    expect(() => { SURVEY_FAMILIES[0].ranges.builderBias[0] = -7; }).to.throw(TypeError);
  });
  it('fills every numeric stratum within each declared family, preserving anchors across 16/64 designs and sampling seeds', () => {
    for (const count of [16, 64]) {
      const candidates = generateProcgenSurveyCandidates({ count, samplingSeed: 91 });
      for (const family of SURVEY_FAMILIES) {
        const samples = candidates.filter(candidate => candidate.family === family.id);
        for (const [key, [low, high]] of Object.entries(family.ranges)) {
          expect(new Set(samples.map(sample => Math.floor(sample.sampling.coordinates[key] * samples.length))).size).to.equal(samples.length);
          for (const sample of samples) expect(sample.configuration[key]).to.be.within(low, high);
        }
      }
      expect(candidates.every(candidate => candidate.configuration.decayTicks === 256 && candidate.configuration.preferenceBound === 3)).to.equal(true);
    }
    const one = generateProcgenSurveyCandidates({ samplingSeed: 91 }), two = generateProcgenSurveyCandidates({ samplingSeed: 92 });
    expect(generateProcgenSurveyCandidates({ samplingSeed: 91 })).to.deep.equal(one);
    expect(one.slice(0, 2)).to.deep.equal(two.slice(0, 2)); expect(one.slice(2)).not.to.deep.equal(two.slice(2));
    expect(() => generateProcgenSurveyCandidates({ count: 32 })).to.throw(); expect(() => generateProcgenSurveyCandidates({ samplingSeed: -1 })).to.throw();
  });
  it('freezes the declared corpus and rejects holdout reuse even under a different scenario label', () => {
    const candidates = generateProcgenSurveyCandidates(), args = { scenarios: [{ id: 'dev', environmentSeed: 1 }, { id: 'holdout', environmentSeed: 2 }], candidates, developmentScenarioIds: ['dev'], holdoutScenarioIds: ['holdout'], sourceManifest: { engineCommit: 'commit' }, budgetPolicy: { horizonTicks: 100 } };
    const manifest = createProcgenSurveyExperiment(args); args.scenarios[0].environmentSeed = 4;
    expect(manifest.scenarios[0].environmentSeed).to.equal(1); expect(Object.isFrozen(manifest.criteria)).to.equal(true);
    expect(() => createProcgenSurveyExperiment({ ...args, holdoutScenarioIds: ['dev'] })).to.throw('disjoint');
    expect(() => createProcgenSurveyExperiment({ ...args, scenarios: [{ id: 'dev', environmentSeed: 1 }, { id: 'holdout', environmentSeed: 1 }] })).to.throw('reuse');
  });
  it('compares full finite episodes, includes ordinary unresolved actors without double-counting the alive denominator, and separates candidate policy from physical start', () => {
    const base = baselineEpisode(1), candidate = episode();
    expect(surveyEpisodeProblems(base)).to.deep.equal([]);
    const comparison = analyzeProcgenSurveyPairs([base, candidate], { baselineId: 'baseline' }).comparisons[0];
    expect(comparison.pairedEpisodes).to.equal(1); expect(comparison.metrics.completion.episodeMean).to.equal(0.5);
    expect(comparison.assessment).to.equal('insufficient-evidence'); expect(comparison.promotionEligible).to.equal(false);
    expect(comparison.metrics.completion.interval).to.equal(null);
  });
  it('does not turn cancellation, infrastructure failure, unsupported sources, unknown validity or absent baselines into wins', () => {
    const results = [baselineEpisode(1), episode('candidate', 1, { status: 'cancelled', episodeComplete: false }), baselineEpisode(2), episode('candidate', 2, { status: 'infrastructure-error', episodeComplete: false }), baselineEpisode(3), episode('candidate', 3, { status: 'unsupported', episodeComplete: false }), baselineEpisode(4), episode('candidate', 4, { validity: { deterministic: null, accountingComplete: true, protectedTerrain: true, legitimateActions: true } }), episode('candidate', 5)];
    const report = analyzeProcgenSurveyPairs(results, { baselineId: 'baseline' }), comparison = report.comparisons[0];
    expect(comparison.pairedEpisodes).to.equal(0); expect(comparison.excluded).to.have.length(5); expect(comparison.promotionEligible).to.equal(false);
    expect(report.attemptStatuses.cancelled).to.equal(1); expect(comparison.excluded[3].reasons).to.include('unverified-deterministic');
    expect(comparison.excluded[4].reasons).to.include('missing-result');
  });
  it('rejects changed budgets, terrain/source manifests, physical start, cohorts and conflicting successful retries', () => {
    for (const key of ['scenarioHash', 'budgetHash', 'sourceHash', 'initialScenarioStateHash']) {
      const comparison = analyzeProcgenSurveyPairs([baselineEpisode(1), episode('candidate', 1, { [key]: 'different' })], { baselineId: 'baseline' }).comparisons[0];
      expect(comparison.excluded[0].reasons).to.include(`different-${key}`);
    }
    const bad = episode('candidate', 1, { accounting: { ...episode().accounting, admitted: 7 } });
    expect(surveyEpisodeProblems(bad)).to.include('invalid-accounting');
    const candidate = episode(), retry = { ...candidate, finalStateHash: 'disagreement' };
    const conflict = analyzeProcgenSurveyPairs([baselineEpisode(1), candidate, retry], { baselineId: 'baseline' }).comparisons[0];
    expect(conflict.excluded[0].reasons).to.include('conflicting-completed-attempts');
  });
  it('clusters repeats from the same world and exposes hard crew regressions and material tradeoffs despite average completion gains', () => {
    const results = [];
    for (let seed = 1; seed <= 8; seed++) for (let variant = 0; variant < 2; variant++) {
      const scenarioId = `scene:${seed}:${variant}`, scenarioHash = `hash:${scenarioId}`;
      results.push({ ...baselineEpisode(seed), scenarioId, scenarioHash }, { ...episode('candidate', seed), scenarioId, scenarioHash });
    }
    const comparison = analyzeProcgenSurveyPairs(results, { baselineId: 'baseline' }).comparisons[0];
    expect(comparison.pairedEpisodes).to.equal(16); expect(comparison.independentClusters).to.equal(8);
    expect(comparison.metrics.completion.interval).to.include({ low: 0.5, high: 0.5 }); expect(comparison.promotionEligible).to.equal(true);
    const death = episode('candidate', 9, { accounting: { ...episode().accounting, alive: 7, deaths: 1 } });
    const regression = analyzeProcgenSurveyPairs([...results, baselineEpisode(9), death], { baselineId: 'baseline' }).comparisons[0];
    expect(regression.assessment).to.equal('hard-regression'); expect(regression.severeRegressions).to.have.length(1);
    const costly = results.map(result => result.candidateId === 'candidate' ? { ...result, metrics: { ...result.metrics, excavatedPixels: 10 } } : result);
    const tradeoff = analyzeProcgenSurveyPairs(costly, { baselineId: 'baseline' }).comparisons[0];
    expect(tradeoff.costTradeoffs).to.have.length(16); expect(tradeoff.promotionEligible).to.equal(false);
  });
  it('archives remarkable success, failure, ordinary context and incomplete evidence under separate caps without modifying originals or denominators', () => {
    const original = episode(), failure = episode('failure', 2, { status: 'failed', accounting: { ...episode().accounting, arrived: 0, alive: 7, deaths: 1, unresolved: 7 } }), normal = episode('ordinary', 1), incomplete = episode('interrupted', 3, { status: 'cancelled', episodeComplete: false });
    const before = canonicalSurveyJson(original), archive = selectProcgenSurveyExemplars([original, baselineEpisode(1), normal, failure, incomplete], { baselineId: 'baseline', capacities: { success: 1, failure: 1, normal: 1, context: 1 } });
    expect(archive.selected.find(item => item.trialId === original.trialId).kind).to.equal('success');
    expect(archive.counts).to.deep.equal({ success: 1, failure: 1, normal: 0, context: 1 });
    expect(archive.selected.some(item => item.kind === 'context' && !item.evidenceComplete)).to.equal(true);
    expect(canonicalSurveyJson(original)).to.equal(before); expect(archive.selected[0].immutableOriginal).to.equal(true);
    const pins = selectProcgenSurveyExemplars([original, normal], { baselineId: 'baseline', capacities: { success: 0, failure: 0, normal: 0, context: 0 }, pinnedTrialIds: [original.trialId, normal.trialId] });
    expect(pins.selected).to.have.length(2); expect(pins.requiresAdmissionStop).to.equal(true);
  });
  it('predeclares exact, competing, policy-randomness, nearby and independent verification; a storage/compute cap cannot split a paired block', () => {
    const input = qualificationInput(), full = createProcgenSuccessQualification(input);
    expect(full.jobs).to.have.length(15); expect(full.jobs[0].stage).to.equal('exact'); expect(full.automaticExecution).to.equal(false);
    expect(new Set(full.jobs.map(job => job.id)).size).to.equal(15);
    expect(full.jobs.every(job => job.separateAttempt && job.originalTrialId === input.original.trialId)).to.equal(true);
    const bounded = createProcgenSuccessQualification({ ...input, maxTrials: 8 });
    expect(bounded.jobs).to.have.length(6); expect(bounded.deferred).to.have.length(9); expect(bounded.completeDeclaration).to.equal(false);
    expect(() => createProcgenSuccessQualification({ ...input, holdoutScenarios: [{ id: 'relabelled', environmentSeed: 1 }] })).to.throw('unseen');
    input.candidate.configuration.builderBias = 5; expect(full.candidate.configuration.builderBias).to.equal(2);
  });
  it('does not infer reliability from exact reruns, labels negative sensitivity, and retains every verification including missing/failed neighbors', () => {
    const input = { ...qualificationInput(), competitors: [], holdoutScenarios: [], policySeeds: [2, 3] }, plan = createProcgenSuccessQualification(input);
    const records = plan.jobs.map(job => ({ jobId: job.id, result: episode(job.candidate.id, job.scenario.environmentSeed, { scenarioId: job.scenario.id, policySeed: job.policySeed, finalStateHash: job.stage === 'exact' && job.candidate.id === 'candidate' ? input.original.finalStateHash : 'later', eventHash: job.stage === 'exact' && job.candidate.id === 'candidate' ? input.original.eventHash : 'later-event' }) }));
    const report = summarizeProcgenSuccessQualification(plan, input.original, records);
    expect(report.exactReproduced).to.equal(true); expect(report.interpretation).to.equal('unresolved');
    const failed = records.map(record => plan.jobs.find(job => job.id === record.jobId).stage === 'policy-randomness' && record.result.candidateId === 'candidate' ? { ...record, result: { ...record.result, status: 'failed' } } : record);
    const sensitive = summarizeProcgenSuccessQualification(plan, input.original, failed);
    expect(sensitive.interpretation).to.equal('trajectory-sensitive-win'); expect(sensitive.sensitivityFailures).to.have.length(2);
    expect(sensitive.verificationTrialIds).to.have.length(records.length);
    const missing = summarizeProcgenSuccessQualification(plan, input.original, records.slice(1));
    expect(missing.incomplete).to.equal(true); expect(missing.interpretation).to.equal('unresolved');
  });
  it('keeps paired aggregation independent of completion order and refuses duplicate expected trials or favorable conflicting controls', () => {
    const results = [baselineEpisode(1), episode(), episode('other', 1)];
    const first = analyzeProcgenSurveyPairs(results, { baselineId: 'baseline' }), reordered = analyzeProcgenSurveyPairs([...results].reverse(), { baselineId: 'baseline' });
    expect(canonicalSurveyJson(first)).to.equal(canonicalSurveyJson(reordered));
    expect(() => analyzeProcgenSurveyPairs(results, { baselineId: 'baseline', expectedBlocks: [{ scenarioId: 'scene:1', policySeed: 1 }, { scenarioId: 'scene:1', policySeed: 1 }] })).to.throw('unique');
    const contradiction = { ...results[0], finalStateHash: 'contradictory-control' };
    const archive = selectProcgenSurveyExemplars([...results, contradiction], { baselineId: 'baseline' });
    expect(archive.selected.find(item => item.trialId === 'candidate:1').kind).to.equal('normal');
    expect(archive.selected.find(item => item.trialId === 'candidate:1').missingContext).to.include('paired-baseline');
  });
  it('selects casualty and skill improvements as explicit success reasons while keeping original traces and declared thresholds', () => {
    const postArrivalLoss = episode('baseline', 1, { accounting: { ...episode().accounting, alive: 7, deaths: 1 } });
    const fewerSkills = episode('efficient', 2, { metrics: { ...episode().metrics, skillCount: 1 } });
    const archive = selectProcgenSurveyExemplars([postArrivalLoss, episode(), episode('baseline', 2), fewerSkills], { baselineId: 'baseline' });
    expect(archive.selected.find(item => item.trialId === 'candidate:1').reasons).to.include('paired-casualty-reduction');
    expect(archive.selected.find(item => item.trialId === 'efficient:2').reasons).to.include('paired-skill-reduction');
    expect(() => selectProcgenSurveyExemplars([], { baselineId: 'baseline', capacities: { success: Infinity } })).to.throw('capacities');
  });
});
