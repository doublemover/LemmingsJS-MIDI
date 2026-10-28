import { expect } from 'chai';
import { planSolverRoute } from '../js/solver/RoutePlanner.js';
import { searchActionTiming } from '../js/solver/TimingSearch.js';
import { createSyntheticRunner } from '../js/solver/SolverRunner.js';
import { createSmallGapFixture } from '../js/solver/SolverFixtures.js';
import { stableHash } from '../js/solver/SolverState.js';
import { createSolverSearchFrontier } from '../js/solver/SolverSearchFrontier.js';

const edge = (id, from, to, extra = {}) => ({ id, from, to, type: 'walk', requiredSkills: [], requiredSkillCount: 0, distance: 1, ...extra });
const build = (id, from, to, extra = {}) => edge(id, from, to, { type: 'build', requiredSkills: ['builder'], requiredSkillCount: 1, availableSkillCount: 1, ...extra });
const route = (edges, options = {}) => planSolverRoute({}, { graph: { graphHash: 'controlled-graph', edges, entranceNodeIds: ['start'], exitNodeIds: ['exit'] },
  crowd: { targetSaveCount: 0, maximumReachableSaveCount: 0 }, now: () => 0, ...options });
const skeleton = (start = 22, end = 28, extra = {}) => ({ kind: 'solver-route-skeleton', segments: [
  { index: 0, type: 'build', requiredSkillFamilies: ['builder'], requiredSkillCount: 1, roughActionWindow: { start, end }, ...extra }
] });
const searchOptions = { maxNodes: 2000, maxTicks: 2000, maxActions: 1, maxWallTimeMs: 10000, now: () => 0 };
const deterministicStats = value => { const { wallTimeMs, ...stats } = value.timingSearchStats; return stats; };

describe('bounded resource-aware route planning', () => {
  it('rejects zero-action requests and cumulative builder overspend without selecting an over-budget route', () => {
    const result = route([build('first', 'start', 'middle'), build('second', 'middle', 'exit')], { maxActions: 0 });
    expect(result.resultType).to.equal('timeout'); expect(result.explanations[0].code).to.equal('budget-exhausted'); expect(result.routeSkeleton).to.equal(undefined);
    const inventory = route([build('first', 'start', 'middle'), build('second', 'middle', 'exit')]);
    expect(inventory.resultType).to.equal('failed'); expect(inventory.explanations[0].code).to.equal('gap-exceeds-builder-budget'); expect(inventory.routeSearchStats.prunedResources).to.equal(1);
  });
  it('retains a more expensive prefix that preserves a builder required downstream', () => {
    const result = route([build('cheap-used-builder', 'start', 'join'), edge('expensive-preserved-builder', 'start', 'join', { distance: 200 }), build('last-builder', 'join', 'exit')]);
    expect(result.resultType).to.equal('unknown'); expect(result.routeSkeleton.edgeIds).to.deep.equal(['expensive-preserved-builder', 'last-builder']);
    expect(result.routeSkeleton.requiredSkillCounts).to.deep.equal({ builder: 1 }); expect(result.budgetUsage.actions).to.equal(1); expect(result.replayVerified).to.equal(false);
  });
  it('uses available inventory from the actual state instead of an optimistic per-edge claim', () => {
    const result = route([build('first', 'start', 'exit', { availableSkillCount: 99 })], { skillCounts: { builder: 0 } });
    expect(result.resultType).to.equal('failed'); expect(result.routeSkeleton).to.equal(undefined);
  });
  it('prefers lower skill/fall/mutation cost and keeps deterministic code-point ties', () => {
    const options = [edge('z', 'start', 'exit'), edge('a', 'start', 'exit'), edge('fall-risk', 'start', 'exit', { fallRisk: 2 }),
      edge('mutation', 'start', 'exit', { terrainMutationCost: 256 }), build('skill', 'start', 'exit')];
    for (let repeat = 0; repeat < 3; repeat++) expect(route(repeat % 2 ? [...options].reverse() : options).routeSkeleton.edgeIds).to.deep.equal(['a']);
    expect(route([options[3]]).routeSkeleton.scoreBreakdown.terrainMutationCost).to.equal(256);
    expect(route([edge('actual-fall', 'start', 'exit', { type: 'fall', fallDistance: 12 })]).routeSkeleton.scoreBreakdown.fallRisk).to.equal(12);
  });
  it('enforces action, estimated-tick, node/frontier and elapsed-time budgets independently', () => {
    const edges = [edge('first', 'start', 'middle', { estimatedTicks: 10 }), edge('last', 'middle', 'exit', { estimatedTicks: 10 })];
    const ticks = route(edges, { maxTicks: 19 }); expect(ticks.resultType).to.equal('timeout');
    const nodes = route(edges, { maxNodes: 1 }); expect(nodes.resultType).to.equal('timeout'); expect(nodes.budgetUsage.nodes).to.be.at.most(1);
    let clock = 0; const wall = route(edges, { maxWallTimeMs: 1, now: () => clock += 10 }); expect(wall.resultType).to.equal('timeout');
    const exact = route(edges, { maxTicks: 20 }); expect(exact.routeSkeleton.estimatedTicks).to.equal(20); expect(exact.budgetUsage.actions).to.equal(0);
  });
  it('prunes dominated equal-resource prefixes and preserves source graph identity', () => {
    const edges = [edge('best', 'start', 'middle'), edge('worse', 'start', 'middle', { distance: 2 }), edge('last', 'middle', 'exit')], before = stableHash(edges);
    const result = route(edges); expect(result.routeSearchStats.prunedDominated).to.be.greaterThan(0); expect(stableHash(edges)).to.equal(before);
  });
  it('honors destructive/skill policies and refuses unsupported skill inventories', () => {
    const destructive = edge('dig', 'start', 'exit', { type: 'digger', requiredSkills: ['digger'], requiredSkillCount: 1, availableSkillCount: 1 });
    expect(route([destructive], { allowDestructiveSkills: false }).resultType).to.equal('failed');
    expect(route([destructive], { skillSubset: ['builder'] }).resultType).to.equal('failed');
    expect(route([build('unmapped', 'start', 'exit', { requiredSkills: ['invented'] })]).resultType).to.equal('unsupported');
  });
  it('keeps the bounded priority frontier stable through replacement and exact capacity', () => {
    const heap = createSolverSearchFrontier((a, b) => a - b, 4); for (const value of [3, 1, 4, 2]) expect(heap.push(value)).to.equal(true);
    expect(heap.push(0)).to.equal(false); expect([heap.pop(), heap.pop(), heap.pop(), heap.pop(), heap.pop()]).to.deep.equal([1, 2, 3, 4, null]);
  });
});

const controlledRunner = (cost = tick => tick ? 2 : 1, disposed = () => {}) => ({
  kind: 'controlled-search-contract', tick: 0, applied: false, skills: { builder: 4 }, actor: { id: 0, saved: false, dead: false },
  step() { this.tick++; }, applyAction() { this.skills.builder -= cost(this.tick); this.applied = true; return { ok: true, lemmingId: 0 }; },
  getSavedCount: () => 0, getDeadCount() { return this.tick >= 3 ? 1 : 0; }, getActiveLemmings() { return this.tick >= 3 ? [] : [this.actor]; },
  selectLemming() { return this.actor; }, getSkillCount(skill) { return this.skills[skill] || 0; }, isTerminal() { return this.tick >= 3; },
  getFinalStateSummary() { return { tick: this.tick, savedCount: 0, deadCount: this.getDeadCount(), activeCount: this.getActiveLemmings().length, skills: { ...this.skills }, lemmings: [{ ...this.actor }] }; },
  getSearchState() { return { key: `${this.tick}:${this.applied}`, inventory: { ...this.skills } }; }, dispose: disposed
});

describe('isolated bounded timing alternatives', () => {
  it('finds a later successful builder assignment through actual synthetic runtime replay', () => {
    const fixture = createSmallGapFixture({ skills: { builder: 1 } }), before = stableHash(fixture);
    const result = searchActionTiming(fixture, skeleton(), searchOptions);
    expect(result.resultType).to.equal('solved'); expect(result.replayVerified).to.equal(true); expect(result.actions[0].tick).to.be.greaterThan(22);
    expect(result.timingSearchStats.candidatesReplayed).to.be.greaterThan(1); expect(result.timingSearchStats.ticksConsidered).to.equal(result.budgetUsage.ticks);
    expect(stableHash(fixture)).to.equal(before);
  });
  it('repeats the same chosen script and deterministic work counts without changing a supplied runner', () => {
    const runner = createSyntheticRunner(createSmallGapFixture({ skills: { builder: 1 } })), before = runner.getSearchState();
    const first = searchActionTiming(runner, skeleton(), searchOptions), second = searchActionTiming(runner, skeleton(), searchOptions);
    expect(second.actions).to.deep.equal(first.actions); expect(deterministicStats(second)).to.deep.equal(deterministicStats(first)); expect(runner.getSearchState()).to.deep.equal(before);
  });
  it('prunes genuinely equivalent and resource-dominated continuations under actual verifier hooks', () => {
    let releases = 0;
    const result = searchActionTiming({}, skeleton(0, 2), { ...searchOptions, createRunner: () => controlledRunner(undefined, () => releases++) });
    expect(result.resultType).to.equal('failed'); expect(result.timingSearchStats.prunedEquivalentStates).to.be.greaterThan(0);
    expect(result.timingSearchStats.prunedDominatedScripts).to.be.greaterThan(0); expect(releases).to.equal(result.timingSearchStats.candidatesReplayed);
  });
  it('deduplicates exact windows and identical exact-tick assignment scripts before replay', () => {
    const result = searchActionTiming({}, skeleton(0, 0), { ...searchOptions, createRunner: () => controlledRunner() });
    expect(result.timingSearchStats.prunedEquivalentStates).to.be.greaterThan(0); expect(result.timingSearchStats.candidatesReplayed).to.equal(1);
  });
  it('reports cumulative real work exhaustion without mutating the source fixture', () => {
    const fixture = createSmallGapFixture({ skills: { builder: 1 } }), before = stableHash(fixture);
    for (const budget of [{ maxTicks: 1 }, { maxNodes: 2 }, { maxActions: 0 }]) {
      const result = searchActionTiming(fixture, skeleton(), { ...searchOptions, ...budget }); expect(result.resultType).to.equal('timeout'); expect(result.explanations[0].code).to.equal('budget-exhausted');
      expect(result.budgetUsage.nodes).to.be.at.most(budget.maxNodes ?? searchOptions.maxNodes);
    }
    expect(stableHash(fixture)).to.equal(before);
  });
  it('refuses mutable/reused runtime owners instead of replaying a failed attempt into the live source', () => {
    const source = controlledRunner(), before = source.getFinalStateSummary();
    expect(searchActionTiming(source, skeleton(0, 2), searchOptions).resultType).to.equal('unsupported');
    expect(searchActionTiming(source, skeleton(0, 2), { ...searchOptions, createRunner: () => source }).resultType).to.equal('unsupported');
    expect(source.getFinalStateSummary()).to.deep.equal(before);
    const reused = controlledRunner(); expect(searchActionTiming({}, skeleton(0, 2), { ...searchOptions, createRunner: () => reused }).resultType).to.equal('unsupported');
  });
  it('detects changed initial state and bounds runner retirement faults', () => {
    let attempt = 0;
    const changed = searchActionTiming({}, skeleton(0, 2), { ...searchOptions, createRunner: () => { const runner = controlledRunner(); runner.skills.builder += attempt++; return runner; } });
    expect(changed.resultType).to.equal('unsupported'); expect(changed.explanations[0].code).to.equal('replay-diverged');
    const failed = searchActionTiming({}, skeleton(0, 2), { ...searchOptions, createRunner: () => controlledRunner(undefined, () => { throw new Error('release failed'); }) });
    expect(failed.resultType).to.equal('unsupported'); expect(failed.summary).to.contain('retirement');
  });
  it('keeps skipped verification and impossible windows explicit without claiming searched ticks', () => {
    const skipped = searchActionTiming({}, skeleton(0, 3), { ...searchOptions, verify: false });
    expect(skipped.resultType).to.equal('unknown'); expect(skipped.replayVerified).to.equal(false); expect(skipped.timingSearchStats.ticksConsidered).to.equal(0);
    const impossible = searchActionTiming({}, skeleton(5, 1), searchOptions); expect(impossible.resultType).to.equal('failed'); expect(impossible.explanations[0].code).to.equal('timing-window-too-narrow');
    expect(searchActionTiming({}, skeleton(-5, -1), searchOptions).explanations[0].code).to.equal('timing-window-too-narrow');
  });
  it('stops explicitly on asynchronous retirement and isolates factory exceptions', () => {
    let attempts = 0;
    const asynchronous = searchActionTiming({}, skeleton(0, 2), { ...searchOptions, createRunner: () => { attempts++; return controlledRunner(undefined, () => Promise.resolve()); } });
    expect(asynchronous.resultType).to.equal('unsupported'); expect(asynchronous.summary).to.contain('asynchronous'); expect(attempts).to.equal(1);
    const refused = searchActionTiming({}, skeleton(0, 2), { ...searchOptions, createRunner: () => { throw new Error('factory unavailable'); } });
    expect(refused.resultType).to.equal('unsupported'); expect(refused.summary).to.contain('factory unavailable');
  });
  it('includes terrain and complete source state in continuation identity and fork ownership', () => {
    const first = createSyntheticRunner(createSmallGapFixture()), second = first.forkForSearch(), before = first.getSearchState();
    second.groundMask[0] = second.groundMask[0] ? 0 : 1; expect(second.getSearchState().key).not.to.equal(before.key); expect(first.getSearchState()).to.deep.equal(before);
  });
});
