import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLanePolicy } from '../js/app/procgen/ProcgenLanePolicy.js';
import { normalizeProcgenPolicyConfig, DEFAULT_PROCGEN_POLICY_CONFIG } from '../js/app/procgen/ProcgenPolicyConfig.js';
import { createSurveyTrial, createSurveyTrialId, normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { ProcgenSurveyTerrain } from '../js/app/procgen/survey/ProcgenSurveyTerrain.js';
import { canonicalSurveyJson, hashSurveyValue, semanticSurveyRandom } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';

const scene = (overrides = {}) => ({ id: 'flat-eight', horizonTicks: 220, checkpointEvery: 32, environmentSeed: 42,
  worldOptions: { assists: true, workerLimits: { builders: 1, bashers: 1, diggers: 1 } },
  geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }], steel: [] },
  cohort: { size: 8, birthInterval: 4 }, goal: { x: 100, y: 64, width: 48, height: 16, postArrivalTicks: 12 }, ...overrides });
const finalReplay = (masks, options = {}, poll = false) => {
  const trial = createSurveyTrial({ masks, scenario: scene(options), candidate: { id: 'baseline' } });
  while (!trial.done) {
    trial.step(7);
    if (poll) for (let at = 0; at < 3; at++) { trial.telemetry(); trial.snapshot(); trial.preview(); trial.world.getLanePolicySignals(0); }
  }
  const result = trial.result(); trial.dispose(); return result;
};

describe('isolated deterministic real procgen survey core', function() {
  this.timeout(30000); let masks; before(async () => { masks = await loadProcgenMasks(); });
  it('matches real baseline physics and logical events across instrumentation, order and attempt identity', () => {
    const first = finalReplay(masks), polled = finalReplay(masks, {}, true);
    expect(polled).to.deep.equal(first); expect(first.status).to.equal('completed');
    expect(first.accounting).to.include({ designated: 8, admitted: 8, suppressed: 0, arrived: 8, qualified: 8, alive: 8, deaths: 0, unresolved: 0 });
    expect(first.events.some(event => event.type === 'lemming-spawn')).to.equal(true);
    const trial = createSurveyTrial({ masks, scenario: scene(), candidate: { id: 'baseline' }, attemptId: 'retry-different-worker' });
    trial.step(220); expect(trial.result()).to.deep.equal(first); trial.dispose();
    const baseline = createSurveyTrial({ masks, scenario: scene(), candidate: { id: 'baseline' } });
    const other = createSurveyTrial({ masks, scenario: scene({ environmentSeed: 9 }), candidate: { id: 'other' } });
    while (!baseline.done) { other.step(2); baseline.step(3); other.step(1); }
    expect(baseline.result()).to.deep.equal(first); baseline.dispose(); other.dispose();
  });
  it('keeps fresh mutable owners and rejects accidental active terrain sharing', () => {
    const terrain = new ProcgenSurveyTerrain(normalizeSurveyScenario(scene()).geometry);
    const first = createSurveyTrial({ masks, scenario: scene(), terrain }), second = createSurveyTrial({ masks, scenario: scene() });
    expect(() => createSurveyTrial({ masks, scenario: scene(), terrain })).to.throw('share mutable terrain');
    const before = second.snapshot().stateHash;
    first.world.setGroundAt(50, 60); first.world.lanePolicy.lanes[0].learned.builders = 2;
    first.world.actors[0].x = 80;
    expect(second.snapshot().stateHash).to.equal(before); expect(first.world.editChunks).not.to.equal(second.world.editChunks);
    expect(first.world.hazardPlanner).not.to.equal(second.world.hazardPlanner); expect(first.world.lanePolicy.projects).not.to.equal(second.world.lanePolicy.projects);
    first.dispose(); first.dispose(); second.dispose();
  });
  it('retains every planned member after terminal contact, object removal, transfer and generation reset', () => {
    const trial = createSurveyTrial({ masks, scenario: scene({ physicalLaneCount: 2, horizonTicks: 80, admissions: [
      { id: 'terminal', tick: 0, lane: 0, x: 36, y: 72 }, { id: 'removed', tick: 0, lane: 0, x: 40, y: 72 },
      { id: 'transferred', tick: 0, lane: 0, x: 44, y: 72 }, { id: 'late', tick: 70, lane: 1, x: 36, y: 168 }
    ], geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 120 }] } }) });
    const [terminal, removed, transferred] = trial.world.actors;
    terminal.terminalReason = 'trapped'; removed.remove(); transferred.y = 168; trial.step();
    expect(trial.telemetry().accounting).to.include({ designated: 4, admitted: 3, suppressed: 1, deaths: 1, retired: 1 });
    expect(transferred.laneIndex).to.equal(1);
    trial.world._restart([0, 0]); trial.step();
    expect(trial.telemetry().accounting.designated).to.equal(4);
    expect(trial.telemetry().accounting).to.include({ deaths: 1, resets: 1, retired: 2 });
    trial.step(78); const result = trial.result();
    expect(result.crew.find(record => record.id === 'terminal')).to.include({ deathReason: 'trapped', deathTick: 1 });
    expect(result.crew.find(record => record.id === 'removed')).to.include({ actorId: 1, retired: 'removed' });
    expect(result.crew.find(record => record.id === 'transferred')).to.include({ birthLane: 0, lane: 1, retired: 'generation-reset' });
    expect(result.accounting.designated).to.equal(4); expect(result.status).to.equal('failed'); trial.dispose();
  });
  it('uses real hazard contact and preserves a death after an earlier physical arrival', () => {
    const result = finalReplay(masks, { horizonTicks: 100, cohort: { size: 1, birthInterval: 0 }, goal: { x: 44, y: 64, width: 8, height: 16, postArrivalTicks: 50 },
      geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }], hazards: [{ id: 'real-frying', type: 'FRYING', x: 60, y: 60, width: 8, height: 20 }] }, worldOptions: { assists: false } });
    expect(result.accounting).to.include({ arrived: 1, qualified: 0, deaths: 1 }); expect(result.accounting.deathsByCause).to.deep.equal({ fried: 1 });
    expect(result.crew[0].deathTick).to.be.greaterThan(result.crew[0].arrivalTick); expect(result.status).to.equal('failed');
  });
  it('keeps suppression and interruption explicit and refuses premature scored completion', () => {
    const trial = createSurveyTrial({ masks, scenario: scene({ maxActors: 1, cohort: { size: 8, birthInterval: 0 } }) });
    expect(trial.telemetry().accounting).to.include({ designated: 8, planned: 8, admitted: 1, suppressed: 7, unresolved: 8 });
    expect(() => trial.result('completed')).to.throw('Incomplete horizon'); trial.step(50);
    const result = trial.result('cancelled'); expect(result.episodeComplete).to.equal(false); expect(result.status).to.equal('cancelled'); expect(trial.done).to.equal(true);
    trial.dispose(); expect(() => trial.step()).to.throw('disposed');
  });
  it('keeps protected-terrain and finite actor-record safety failures explicit', () => {
    const protectedTrial = createSurveyTrial({ masks, scenario: scene({ geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }], steel: [{ x: 12, y: 48, width: 1, height: 24 }] } }) });
    protectedTrial.world._setPixel(12, 60, 0); protectedTrial.step(220);
    expect(protectedTrial.result().validity.protectedTerrain).to.equal(false); protectedTrial.dispose();
    const capped = createSurveyTrial({ masks, scenario: scene({ actorRecordLimit: 1 }) }); capped.step(100);
    expect(capped.result()).to.include({ status: 'infrastructure-error', episodeComplete: false }); expect(capped.result().evidence.actorRecordLimitReached).to.equal(true);
    expect(capped.world.tickIndex).to.equal(1); capped.dispose();
  });
  it('restarts deterministically rather than treating an evidence snapshot as a checkpoint restore', () => {
    const interrupted = createSurveyTrial({ masks, scenario: scene() }); interrupted.step(64); const boundary = interrupted.snapshot();
    const result = interrupted.result('cancelled'); expect(result.evidence.resumeMethod).to.equal('deterministic-restart-replay'); interrupted.dispose();
    const restarted = createSurveyTrial({ masks, scenario: scene(), attemptId: 'restart' }); restarted.step(64);
    expect(restarted.snapshot()).to.deep.equal(boundary); restarted.step(156);
    expect(restarted.result()).to.deep.equal(finalReplay(masks)); restarted.dispose();
  });
  it('preserves the exact current policy defaults and admits only validated ranking settings', () => {
    const normalized = normalizeProcgenPolicyConfig(); expect(normalized).to.deep.equal(DEFAULT_PROCGEN_POLICY_CONFIG);
    for (const input of [{ decayTicks: 0 }, { learningRate: 8 }, { randomMode: 'hardware-rng' }, { builderBias: NaN }, { probeBudget: 9999 }, { policySeed: -1 }]) expect(() => normalizeProcgenPolicyConfig(input)).to.throw();
    const world = new ProcgenLaneWorld({ masks, assists: false }), policy = world.lanePolicy, actor = world.actors[0];
    const copy = new ProcgenLanePolicy(world, { ...DEFAULT_PROCGEN_POLICY_CONFIG });
    for (const kind of ['builders', 'bashers', 'diggers', 'miners']) expect(copy.score(actor, { kind })).to.equal(policy.score(actor, { kind }));
    policy.lanes[0].learned.builders = 3; world.tickIndex = 1024;
    const before = JSON.stringify(policy.lanes); for (let at = 0; at < 50; at++) expect(policy.signals(0).learned.builders).to.equal(0);
    expect(JSON.stringify(policy.lanes)).to.equal(before); policy.signals(0).knowledge.push({ fake: true }); expect(policy.lanes[0].knowledge).to.have.length(0);
    const noLearning = new ProcgenLanePolicy(world, { learningEnabled: false }); noLearning._credit(0, 'builders', 'passage'); noLearning._credit(0, 'builders', 'crew-failure');
    expect(noLearning.lanes[0].learned.builders).to.equal(0); copy.dispose(); noLearning.dispose(); world.dispose();
  });
  it('hashes canonical semantic identities independently of object key order and display metadata', () => {
    expect(hashSurveyValue({ a: 1, b: [2, 3] })).to.equal(hashSurveyValue({ b: [2, 3], a: 1 }));
    expect(hashSurveyValue(undefined)).not.to.equal(hashSurveyValue(['undefined']));
    expect(hashSurveyValue(Infinity)).not.to.equal(hashSurveyValue(['number', 'Infinity']));
    expect(hashSurveyValue(new Uint8Array([1]))).not.to.equal(hashSurveyValue(['typed', 'Uint8Array', [1]]));
    expect(semanticSurveyRandom(42, 'cohort', 0, 'ability')).to.equal(semanticSurveyRandom(42, 'cohort', 0, 'ability'));
    expect(semanticSurveyRandom(42, 'cohort', 0, 'ability')).not.to.equal(semanticSurveyRandom(42, 'cohort', 1, 'ability'));
    expect(semanticSurveyRandom(42, 'cohort', 0, 'ability')).to.be.within(0, 1);
    let touched = 0; const getter = { get state() { touched++; return 1; } }; expect(() => canonicalSurveyJson(getter)).to.throw('getters'); expect(touched).to.equal(0);
    expect(createSurveyTrialId(scene(), { id: 'baseline' })).to.equal(createSurveyTrialId({ ...scene(), displaySlot: 15 }, { id: 'baseline', worker: 2 }));
    expect(() => normalizeSurveyScenario(scene({ physicalLaneCount: 0 }))).to.throw();
    expect(() => normalizeSurveyScenario(scene({ admissions: [{ id: 'same' }, { id: 'same' }] }))).to.throw('identities');
    expect(() => createSurveyTrial({ masks, scenario: scene({ mode: 'generated' }) })).to.throw('fresh loaded terrain');
  });
  it('qualifies the whole ordinary wall crew and retains a genuine incomplete bridge crew', () => {
    const wall = finalReplay(masks, { id: 'wall-eight', horizonTicks: 500, cohort: { size: 8, birthInterval: 8 }, goal: { x: 120, y: 64, width: 72, height: 16 },
      geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }, { x: 64, y: 48, width: 32, height: 24 }], steel: [{ x: 12, y: 48, width: 1, height: 24 }] },
      worldOptions: { assists: true, workerLimits: { builders: 0, bashers: 1, diggers: 0 } } });
    expect(wall.accounting).to.include({ designated: 8, arrived: 8, deaths: 0 }); expect(wall.metrics.skills.bashes).to.equal(2); expect(wall.metrics.excavatedPixels).to.be.greaterThan(0);
    expect(wall.finalStateHash).to.equal(finalReplay(masks, { ...wall.scenario }).finalStateHash);
    const gap = finalReplay(masks, { id: 'gap-eight', horizonTicks: 500, cohort: { size: 8, birthInterval: 8 },
      geometry: { solid: [{ x: 8, y: 72, width: 62, height: 24 }, { x: 78, y: 72, width: 954, height: 24 }], steel: [{ x: 12, y: 48, width: 1, height: 24 }] },
      worldOptions: { assists: true, workerLimits: { builders: 1, bashers: 0, diggers: 0 } } });
    expect(gap.accounting).to.include({ designated: 8, arrived: 1, deaths: 7 }); expect(gap.metrics.skills.builds).to.equal(1);
    expect(gap.status).to.equal('failed'); expect(gap.accounting.deathsByCause).to.deep.equal({ 'out-of-world': 7 });
  });
});
