import { expect } from 'chai';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLanePolicy } from '../js/app/procgen/ProcgenLanePolicy.js';
import { normalizeProcgenPolicyConfig, DEFAULT_PROCGEN_POLICY_CONFIG } from '../js/app/procgen/ProcgenPolicyConfig.js';
import { createSurveyTrial, createSurveyTrialId, normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { ProcgenSurveyTerrain } from '../js/app/procgen/survey/ProcgenSurveyTerrain.js';
import { canonicalSurveyJson, hashSurveyValue, semanticSurveyRandom } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { compareSurveyReplay, compareSurveyCompatibilityReplay } from '../js/app/procgen/survey/ProcgenSurveyReplay.js';
import { loadProcgenMasks } from '../scripts/bench-procgen-lanes.js';
import { createNodeSurveyTrial } from '../scripts/procgen-survey/SurveyNodeWorld.js';

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
const referenceAccounting = trial => {
  const ids = trial.scenario.designatedCohort, selected = ids.map(id => trial._byIdentity.get(id)), admitted = selected.filter(Boolean);
  const deathRecords = admitted.filter(record => record.deathReason), deathsByCause = {};
  for (const record of deathRecords) deathsByCause[record.deathReason] = (deathsByCause[record.deathReason] || 0) + 1;
  return { designated: ids.length, planned: ids.length, admitted: admitted.length, suppressed: ids.length - admitted.length,
    arrived: admitted.filter(record => record.arrivalTick != null).length, qualified: admitted.filter(record => record.qualifiedTick != null).length,
    alive: admitted.filter(record => !record.deathReason && !record.retired && !record.actor.disabled).length, deaths: deathRecords.length,
    unresolved: selected.filter(record => !record || record.arrivalTick == null && !record.deathReason).length,
    retired: admitted.filter(record => record.retired).length, deathsByCause, firstDeathTick: deathRecords.length ? Math.min(...deathRecords.map(record => record.deathTick)) : null,
    ordinary: admitted.filter(record => !record.scout).length, scouts: admitted.filter(record => record.scout).length,
    workers: admitted.filter(record => record.worker).length, guards: admitted.filter(record => record.guard).length,
    totalBirths: trial._records.length, additionalBirths: trial._records.length - admitted.length, allDeaths: trial._records.filter(record => record.deathReason).length,
    resets: trial._resets, missingActors: trial._missingActors };
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
  it('does not read terminal actor actions on later observation ticks', () => {
    const trial = createSurveyTrial({ masks, scenario: scene() }), actor = trial.world.actors[0];
    actor.terminalReason = 'trapped'; trial._observe();
    const first = trial._accounting(); expect(first.allDeaths).to.equal(1);
    const action = actor.action; let reads = 0;
    Object.defineProperty(actor, 'action', { configurable: true, get() { reads++; return action; } });
    for (let index = 0; index < 100; index++) trial._observe();
    expect(reads).to.equal(0); expect(trial._accounting()).to.deep.equal(first);
    Object.defineProperty(actor, 'action', { configurable: true, writable: true, value: action }); trial.dispose();
  });
  it('keeps incremental accounting equal to a full historical scan at each tick', () => {
    const trial = createSurveyTrial({ masks, scenario: scene({ horizonTicks: 80 }) });
    try {
      for (let tick = 0; tick < 80; tick++) {
        if (tick === 10) trial.world.actors[0].terminalReason = 'trapped';
        if (tick === 20) trial.world.actors[1].remove();
        if (tick === 30) trial.world._restart([0, 0]);
        expect(trial._accounting()).to.deep.equal(referenceAccounting(trial));
        trial.step(); expect(trial._accounting()).to.deep.equal(referenceAccounting(trial));
      }
    } finally { trial.dispose(); }
  });
  it('compacts committed terminations once and preserves death-animation lifecycle evidence', () => {
    const trial = createSurveyTrial({ masks, scenario: scene({ horizonTicks: 100, cohort: { size: 1, birthInterval: 0 },
      goal: { x: 44, y: 64, width: 8, height: 16, postArrivalTicks: 50 }, worldOptions: { assists: false },
      geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }], hazards: [{ id: 'fire', type: 'FRYING', x: 60, y: 60, width: 8, height: 20 }] } }) });
    try {
      while (!trial._records[0].deathReason) trial.step();
      const record = trial._records[0]; expect(record.actor).not.to.equal(null); expect(record.terminal).to.equal(undefined);
      while (!trial.done && record.actor) trial.step();
      expect(record.actor).to.equal(null); expect(record.terminal).to.be.frozen;
      expect(record.terminal.terminationReason).to.equal('fried'); expect(record.terminal.tick).to.be.greaterThan(record.deathTick);
      const finalized = trial.observationWork().finalizedActors; trial.step(100);
      expect(trial.observationWork().finalizedActors).to.equal(finalized);
      expect(trial.result().crew[0].terminal).to.deep.equal(record.terminal);
      expect(trial.result().validity.accountingComplete).to.equal(true);
    } finally { trial.dispose(); }
  });
  it('allows deferred presentation without changing exact physics, events or final accounting', () => {
    const eager = createSurveyTrial({ masks, scenario: scene() }), deferred = createSurveyTrial({ masks, scenario: scene() });
    try {
      for (let tick = 0; tick < 220; tick++) { eager.step(); deferred.step(1, { telemetry: false }); }
      expect(deferred.observationWork().telemetryProjections).to.be.lessThan(eager.observationWork().telemetryProjections / 2);
      expect(deferred.telemetry().tick).to.equal(220); expect(deferred.result()).to.deep.equal(eager.result());
    } finally { eager.dispose(); deferred.dispose(); }
  });
  it('keeps ordinary observer work constant across 64, 8192 and 65536 terminal records', () => {
    const trial = createSurveyTrial({ masks, scenario: scene({ cohort: { size: 1 } }) });
    try {
      trial.world.actors[0].failureReason = 'trapped'; trial.step();
      expect(trial._activeRecords.size).to.equal(0);
      for (const count of [64, 8192, 65536]) {
        while (trial._records.length < count) trial._records.push({ id: 'historical-' + trial._records.length,
          get actor() { throw new Error('Observer revisited finalized actor'); }, terminal: trial._records[0].terminal });
        const before = trial.observationWork();
        for (let tick = 0; tick < 16; tick++) trial._observe();
        expect(trial.observationWork().actorVisits - before.actorVisits).to.equal(0);
        expect(trial.observationWork().telemetryProjections - before.telemetryProjections).to.equal(0);
      }
    } finally { trial.dispose(); }
  });
  it('rejects observations inside a physical transaction or after a failed tick', () => {
    const trial = createSurveyTrial({ masks, scenario: scene() }), actor = trial.world.actors[0], process = actor.process;
    try {
      actor.process = function(world) {
        expect(() => trial.snapshot()).to.throw('requires a completed physical tick');
        expect(() => trial.telemetry()).to.throw('requires a completed physical tick');
        expect(() => trial.observeMilestone()).to.throw('requires a completed physical tick');
        return process.call(this, world);
      };
      trial.step(); expect(trial.snapshot().tick).to.equal(1);
      actor.process = () => { throw new Error('failed physical fixture'); };
      expect(() => trial.step()).to.throw('failed physical fixture');
      for (const observe of [() => trial.snapshot(), () => trial.telemetry(), () => trial.observeMilestone(), () => trial.result()])
        expect(observe).to.throw('requires a completed physical tick');
    } finally { trial.dispose(); }
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
  it('preserves special typed values and rejects incomplete replay evidence', () => {
    const values = [-0, 0, NaN, Infinity, -Infinity];
    expect(new Set(values.map(value => hashSurveyValue(new Float64Array([value])))).size).to.equal(5);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(hashSurveyValue(new DataView(bytes.buffer, 0, 2))).not.to.equal(hashSurveyValue(new DataView(bytes.buffer, 1, 2)));
    expect(hashSurveyValue(new BigInt64Array([1n]))).not.to.equal(hashSurveyValue(new BigInt64Array([2n])));
    expect(compareSurveyReplay({}, {}).matched).to.equal(false);
    const complete = finalReplay(masks);
    expect(compareSurveyReplay(complete, complete).matched).to.equal(true);
    const compatible = compareSurveyCompatibilityReplay(complete, complete, { artifactIntegrity: 'verified', codeDigest: 'a'.repeat(64) });
    expect(compatible).to.include({ matched: false, compatibilityMatch: true, validity: 'execution-unbound', independentSample: false });
    expect(compatible.artifactIntegrity.status).to.equal('verified');
    expect(compatible.executionIdentity.status).to.equal('unbound');
    expect(compareSurveyReplay(complete, { ...complete, provenance: { ...complete.provenance, stateSchema: 1 } }).matched).to.equal(false);
    const olderCanonical = { ...complete, provenance: { ...complete.provenance, canonicalSchema: 2 } };
    expect(compareSurveyReplay(olderCanonical, olderCanonical).matched).to.equal(false);
    const olderState = { ...complete, provenance: { ...complete.provenance, stateSchema: 3 } };
    expect(compareSurveyReplay(olderState, olderState).matched).to.equal(false);
    const priorProjection = { ...complete, provenance: { ...complete.provenance, stateSchema: 4 } };
    expect(compareSurveyReplay(priorProjection, priorProjection).matched).to.equal(false);
    const beforeBehaviorOwners = { ...complete, provenance: { ...complete.provenance, stateSchema: 8 } };
    expect(compareSurveyReplay(beforeBehaviorOwners, beforeBehaviorOwners).matched).to.equal(false);
    const beforeCausalContinuations = { ...complete, provenance: { ...complete.provenance, stateSchema: 9 } };
    expect(compareSurveyReplay(beforeCausalContinuations, beforeCausalContinuations).matched).to.equal(false);
    expect(compareSurveyReplay(complete, { ...complete, evidence: { ...complete.evidence, truncated: true } }).matched).to.equal(false);
    expect(compareSurveyReplay(complete, { ...complete, milestones: [] }).matched).to.equal(false);
    const unbound = { ...complete, provenance: { ...complete.provenance, scenarioHash: '0'.repeat(16) } };
    expect(compareSurveyReplay(unbound, unbound).reasons).to.include('original:scenario-hash-not-bound');
    const divergent = { ...complete, finalStateHash: '0'.repeat(16),
      milestones: complete.milestones.map((entry, index) => index === complete.milestones.length - 1 ? { ...entry, stateHash: '0'.repeat(16) } : entry) };
    expect(compareSurveyReplay(complete, divergent).validity).to.equal('mismatch');
    expect(compareSurveyReplay(complete, { ...complete, milestones: {} }).validity).to.equal('invalid-or-incomplete');
    const changedCrew = { ...complete, crew: complete.crew.map((record, index) => index ? record : { ...record, birthTick: record.birthTick + 1 }) };
    expect(compareSurveyReplay(complete, changedCrew).differences).to.include('crew');
    const changedEvents = { ...complete, events: complete.events.map((event, index) => index ? event : { ...event, changed: true }) };
    expect(compareSurveyReplay(changedEvents, changedEvents).reasons).to.include('original:event-hash-not-bound');
    const boundary = { ...complete, milestones: complete.milestones.map((entry, index) => index ? entry : { ...entry, stateHash: '0'.repeat(16) }) };
    expect(compareSurveyReplay(boundary, boundary).reasons).to.include('original:milestone-boundary-mismatch');
    const unordered = { ...complete, milestones: [complete.milestones[0], complete.milestones[1], complete.milestones[1], ...complete.milestones.slice(2)] };
    expect(compareSurveyReplay(unordered, unordered).reasons).to.include('original:invalid-milestones');
    expect(compareSurveyReplay(complete, complete).coverage.intervals[0].observation).to.include('interior ticks not individually observed');
    const trial = createSurveyTrial({ masks, scenario: scene() });
    trial.world.terrainActivityTicks[0] = NaN;
    expect(() => trial.snapshot()).to.throw('Invalid terrain activity tick'); trial.dispose();
  });
  it('binds future admission, assistance, junction and feedback owners in the physical projection', () => {
    const trial = createSurveyTrial({ masks, scenario: scene() });
    try {
      for (const key of ['assists', 'workstationEnabled', 'maxActors', 'spawnSpreadTicks', 'leftEdgeX']) {
        const before = trial.snapshot().physicalStateHash, original = trial.world[key];
        trial.world[key] = typeof original === 'boolean' ? !original : original + 1;
        expect(trial.snapshot().physicalStateHash, key).not.to.equal(before); trial.world[key] = original;
      }
      for (const [owner, key, next] of [['physicalFeedback', 'mode', 'armed'], ['physicalJunctions', 'revision', 8], ['terrainScorePending', 'overflow', true]]) {
        const before = trial.snapshot().physicalStateHash, had = Object.hasOwn(trial.world[owner], key), original = trial.world[owner][key];
        trial.world[owner][key] = next; expect(trial.snapshot().physicalStateHash, owner).not.to.equal(before);
        if (had) trial.world[owner][key] = original; else delete trial.world[owner][key];
      }
    } finally { trial.dispose(); }
  });
  it('refuses unclassified future owners and root accessors without executing them', () => {
    const trial = createSurveyTrial({ masks, scenario: scene() }), maxActors = trial.world.maxActors; let touched = 0;
    try {
      trial.world.futurePhysicalOwner = { queued: 1 };
      try { trial.snapshot(); throw new Error('unexpected qualified state'); } catch (error) { expect(error.code).to.equal('unclassified-state-owner'); }
      delete trial.world.futurePhysicalOwner;
      Object.defineProperty(trial.world, 'maxActors', { configurable: true, get() { touched++; throw new Error('Unexpected getter'); } });
      try { trial.snapshot(); throw new Error('unexpected qualified state'); } catch (error) { expect(error.code).to.equal('accessor-state-owner'); }
      expect(touched).to.equal(0);
      Object.defineProperty(trial.world, 'maxActors', { configurable: true, writable: true, value: maxActors });
      expect(trial.snapshot().physicalStateHash).to.match(/^[a-f0-9]{16}$/);
    } finally { trial.dispose(); }
  });
  it('keeps physical identity across warm/cold controlled query caches while exposing actual collision mutation', () => {
    const trial = createSurveyTrial({ masks, scenario: scene() });
    try {
      const initial = trial.snapshot(), before = initial.physicalStateHash, terrain = trial.world.terrain, seed = trial.world.laneSeeds[0];
      const chunk = terrain.getChunk(seed, 7); terrain.getChunk(seed, 3);
      expect(trial.snapshot().physicalStateHash).to.equal(before);
      trial.world.hasGroundAt(950, 72); expect(trial.snapshot().stateHash).to.equal(initial.stateHash);
      chunk.solid[0] ^= 1; expect(trial.snapshot().physicalStateHash).not.to.equal(before);
      chunk.solid[0] ^= 1; expect(trial.snapshot().physicalStateHash).to.equal(before);
      terrain.collision.delete(seed + ':7'); terrain.collision.delete(seed + ':3');
      expect(trial.snapshot().physicalStateHash).to.equal(before);
      terrain.collision.set(seed + ':99', { solid: new Uint32Array(384), steel: new Uint32Array(384) });
      try { trial.snapshot(); throw new Error('unexpected qualified cache'); } catch (error) { expect(error.code).to.equal('unverified-controlled-collision'); }
      terrain.collision.delete(seed + ':99');
    } finally { trial.dispose(); }
  });
  it('keeps the actual survey state through edit compaction and rehydration while detecting changed pixels', () => {
    const trial = createSurveyTrial({ masks, scenario: scene() });
    try {
      const edits = trial.world.editChunks, first = new Uint8Array(edits.chunkLength), second = new Uint8Array(edits.chunkLength);
      first.fill(2, 3, 8); second.fill(3, 18, 29); edits.set(9, first); edits.set(7, second);
      const before = trial.snapshot(); edits.compactExcept(new Set(), 1);
      expect(trial.snapshot().physicalStateHash).to.equal(before.physicalStateHash); expect(trial.snapshot().stateHash).to.equal(before.stateHash);
      const patch = edits.get(9); expect(trial.snapshot().physicalStateHash).to.equal(before.physicalStateHash);
      patch[0] = 1; expect(trial.snapshot().physicalStateHash).not.to.equal(before.physicalStateHash);
    } finally { trial.dispose(); }
  });
  it('requires complete crew accounting and physical checksum domains even when two incomplete records match', () => {
    const complete = finalReplay(masks), compareBoth = value => compareSurveyReplay(value, value);
    expect(compareBoth(complete).matched).to.equal(true);
    const missingCrew = { ...complete, crew: [] };
    expect(compareBoth(missingCrew).reasons).to.include('original:crew-accounting-not-bound');
    const missingPhysical = { ...complete }; delete missingPhysical.finalPhysicalStateHash;
    expect(compareBoth(missingPhysical).reasons).to.include('original:missing-finalPhysicalStateHash');
    const duplicate = { ...complete, crew: [complete.crew[0], ...complete.crew.slice(0, -1)] };
    expect(compareBoth(duplicate).reasons).to.include('original:invalid-crew-records');
    const accounting = { ...complete, accounting: { ...complete.accounting, deaths: complete.accounting.deaths + 1 } };
    expect(compareBoth(accounting).reasons).to.include('original:crew-accounting-not-bound');
    const lifecycle = { ...complete, evidence: { ...complete.evidence, pendingLifecycles: complete.evidence.pendingLifecycles + 1 } };
    expect(compareBoth(lifecycle).reasons).to.include('original:lifecycle-retention-not-bound');
    const invalidPosition = { ...complete, crew: complete.crew.map((record, index) => index ? record : { ...record, x: NaN }) };
    expect(compareBoth(invalidPosition).reasons).to.include('original:invalid-crew-records');
    const seed = { ...complete, policySeed: complete.policySeed + 1 };
    expect(compareBoth(seed).reasons).to.include('original:policy-seed-not-bound');
    const outcome = { ...complete, status: 'completed', terminationReason: 'declared-goal-qualified', accounting: { ...complete.accounting, qualified: 0 }, crew: complete.crew.map(record => ({ ...record, qualifiedTick: null })) };
    expect(compareBoth(outcome).reasons).to.include('original:outcome-accounting-not-bound');
    const physical = { ...complete, finalPhysicalStateHash: '0'.repeat(16), milestones: complete.milestones.map((entry, index) => index === complete.milestones.length - 1 ? { ...entry, physicalStateHash: '0'.repeat(16) } : entry) };
    const comparison = compareSurveyReplay(complete, physical);
    expect(comparison.validity).to.equal('mismatch'); expect(comparison.differences).to.include('finalPhysicalStateHash');
    expect(comparison.coverage.physicalMismatchedTicks).to.deep.equal([complete.lastTick]);
    expect(comparison.coverage.checksumDomains).to.include('physical-state');
    expect(compareBoth({ ...complete, milestones: [null] }).validity).to.equal('invalid-or-incomplete');
  });
  it('binds every retained checkpoint event prefix to its telemetry identity and logical event log', () => {
    const complete = finalReplay(masks), at = Math.min(1, complete.milestones.length - 1);
    const changed = { ...complete, milestones: complete.milestones.map((entry, index) => index === at ? { ...entry, eventHash: '0'.repeat(16), telemetry: { ...entry.telemetry, eventHash: '0'.repeat(16) } } : entry) };
    expect(compareSurveyReplay(changed, changed).reasons).to.include('original:milestone-events-not-bound');
    const identity = { ...complete, milestones: complete.milestones.map((entry, index) => index === at ? { ...entry, telemetry: { ...entry.telemetry, trialId: 'different-trial' } } : entry) };
    expect(compareSurveyReplay(identity, identity).reasons).to.include('original:milestone-events-not-bound');
    const missing = { ...complete, milestones: complete.milestones.map((entry, index) => index === at ? { ...entry, telemetry: undefined } : entry) };
    expect(compareSurveyReplay(missing, missing).reasons).to.include('original:milestone-events-not-bound');
    const event = { ...complete, events: complete.events.map((entry, index) => index ? entry : { ...entry, tick: complete.lastTick + 1 }) };
    expect(compareSurveyReplay(event, event).reasons).to.include('original:invalid-event-records');
  });
  it('validates retained crew and event-prefix evidence from fresh generated source terrain', async () => {
    const trial = await createNodeSurveyTrial({ scenario: { id: 'generated-evidence', mode: 'generated', pack: 'lemmings_ohNo', groundSet: 0, laneHeight: 144, horizonTicks: 192 } }, masks);
    try {
      trial.step(192); const result = trial.result(), replay = compareSurveyReplay(result, result);
      expect(replay.matched, JSON.stringify(replay)).to.equal(true); expect(result.accounting.totalBirths).to.equal(result.crew.length);
    } finally { trial.dispose(); }
  });
  it('qualifies the whole ordinary wall crew and retains a genuine incomplete bridge crew', () => {
    const wall = finalReplay(masks, { id: 'wall-eight', horizonTicks: 500, cohort: { size: 8, birthInterval: 8 }, goal: { x: 120, y: 64, width: 72, height: 16 },
      geometry: { solid: [{ x: 8, y: 72, width: 1024, height: 24 }, { x: 64, y: 48, width: 32, height: 24 }], steel: [{ x: 12, y: 48, width: 1, height: 24 }] },
      worldOptions: { assists: true, workerLimits: { builders: 0, bashers: 1, diggers: 0 } } });
    expect(wall.accounting).to.include({ designated: 8, arrived: 8, deaths: 0 }); expect(wall.metrics.skills.bashes).to.equal(2); expect(wall.metrics.excavatedPixels).to.be.greaterThan(0);
    const wallReplay = compareSurveyReplay(wall, wall); expect(wallReplay.matched, JSON.stringify(wallReplay)).to.equal(true);
    expect(wall.finalStateHash).to.equal(finalReplay(masks, { ...wall.scenario }).finalStateHash);
    const gap = finalReplay(masks, { id: 'gap-eight', horizonTicks: 500, cohort: { size: 8, birthInterval: 8 },
      geometry: { solid: [{ x: 8, y: 72, width: 62, height: 24 }, { x: 78, y: 72, width: 954, height: 24 }], steel: [{ x: 12, y: 48, width: 1, height: 24 }] },
      worldOptions: { assists: true, workerLimits: { builders: 1, bashers: 0, diggers: 0 } } });
    expect(gap.accounting).to.include({ designated: 8, arrived: 1, deaths: 7 }); expect(gap.metrics.skills.builds).to.equal(1);
    expect(gap.status).to.equal('failed'); expect(gap.accounting.deathsByCause).to.deep.equal({ 'out-of-world': 7 });
    const gapReplay = compareSurveyReplay(gap, gap); expect(gapReplay.matched, JSON.stringify(gapReplay)).to.equal(true);
  });
});
