import { expect } from 'chai';
import { createProcgenCausalJournal } from '../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder } from '../js/app/procgen/workstation/CausalTake.js';
import { createPhysicalScoreProjection } from '../js/app/procgen/workstation/PhysicalScoreProjection.js';
import { createMemoryCausalStore } from './helpers/causalJournalStore.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createBackgroundWorkerAdmission } from '../js/app/resources/BackgroundWorkerAdmission.js';
import { createBackgroundJobService } from '../js/app/resources/BackgroundJobService.js';

const graph = { version: 1, revision: 1, instruments: [
  { id: 'work', sourceKind: 'TerrainWorkCommitted', pitchCents: 6000, velocity01: 1, role: 'builder', route: 'local' }
] };
const source = tick => ({ version: 1, worldId: 'world:score', generation: 1, tick, batchId: `batch:${tick}`, sourceTimeMs: tick * 20,
  tickDurationMs: 20, completeness: { status: 'complete', dropped: 0 }, facts: [
    { kind: 'TerrainWorkCommitted', actorId: 7, laneId: tick < 6 ? 0 : 1, eventId: `work:${tick}`, causalSequence: tick * 2,
      actionInstanceId: 'action:7:1', operationKind: 'builder', precision: 'tick', parentCauseIds: ['command:build'],
      physicalPayload: { changedSolidCells: 1 } },
    { kind: 'ContactResolved', actorId: 8, laneId: 0, otherActorId: 7, eventId: `contact:${tick}`, causalSequence: tick * 2 + 1,
      causeKind: 'blocker', precision: 'endpoint', positionAfter: { x: tick, y: 10 } }
  ] });
const intents = tick => [{ version: 1, kind: 'begin', intentId: `intent:${tick}`, voiceId: `voice:${tick}`, sourceEventIds: [`work:${tick}`],
  actorId: 7, role: 'builder', mappingId: 'work', generation: 1, batchId: `batch:${tick}`,
  scoreTime: { beat: tick / 8, epoch: 'score:1', simTick: tick, subTick: 0, precision: 'tick', sourceTimeMs: tick * 20 } }];
const fixture = async ({ ticks = 10, gaps = false, sparse = false, ...bounds } = {}) => {
  const store = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage: store.storage, resourceBudget: bounds.resourceBudget, jobs: bounds.jobs });
  const recorder = await createCausalTakeRecorder({ journal, takeId: 'take:score', documentId: 'doc:score', sourceVersions: { physicalBatch: 1 },
    mapping: graph, initialCheckpoint: { tick: 0 }, boundaryState: { voices: [], timeline: { epoch: 'score:1', segments: [{ simTickOrigin: 0, tempoBpm: 120 }] } } });
  for (let tick = 1; tick <= ticks; tick++) recorder.recordCommittedBatch({ batch: source(tick), intents: sparse && tick !== ticks ? [] : intents(tick),
    deliveryOutcomes: tick === 3 ? [{ intentId: `intent:${tick}`, sinkId: 'midi', stage: 'none', status: 'rejected', reason: 'driver-drop' }] : [] });
  if (gaps) recorder.markGap({ kind: 'physical-facts', firstTick: 4, lastTick: 4, generation: 1, reason: 'missing-source' });
  await recorder.stop();
  const manifest = await journal.openTake('take:score'), projection = createPhysicalScoreProjection({ journal, ...bounds });
  return { ...store, journal, manifest, ...projection, request: { takeId: manifest.takeId, takeRevision: manifest.revision,
    generation: 1, coverageRange: { firstTick: 1, lastTick: ticks }, requestId: 'score:request' } };
};

describe('read-only PhysicalScore projection', function() {
  this.timeout(30000);
  it('retains a published score through replacement cancellation and releases all owned source views', async () => {
    const resourceBudget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    const { journal, manifest, request, queryPhysicalScoreOwned } = await fixture({ ticks: 3, resourceBudget, jobs, maxBytes: 32768,
      maxRecords: 32, maxJoinRecords: 32, maxEvidence: 32, maxSourceFacts: 32, maxStrands: 32, maxGlyphs: 16, maxCauseLinks: 128 });
    const baseline = resourceBudget.diagnostics().accountedBytes, controller = new AbortController();
    const view = await queryPhysicalScoreOwned({ ...request, signal: controller.signal });
    expect(view.value.sourceCanonicalHash).to.equal(manifest.canonicalHash); expect(view.value.counts.sourceFacts).to.equal(6);
    expect(view.value.joinWork.causeLinks).to.equal(3); expect(admission.diagnostics().retainedResults).to.equal(1);
    expect(resourceBudget.diagnostics().accountedBytes).to.be.greaterThan(baseline); controller.abort(new Error('replacement requested'));
    expect(view.value.glyphs).to.have.length(6); view.release(); expect(resourceBudget.diagnostics().accountedBytes).to.equal(baseline);
    await journal.releaseQualifications().completion; expect(resourceBudget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });

  it('refuses excessive cause-to-intent joins before publishing a partial ownership claim', async () => {
    const { journal, request, queryPhysicalScoreOwned } = await fixture({ ticks: 3, maxCauseLinks: 1 });
    try { await queryPhysicalScoreOwned(request); expect.fail('join capacity must reject'); }
    catch (error) { expect(error.code).to.equal('score-link-capacity'); }
    const first = await journal.query({ takeId: request.takeId, kinds: ['musical-intents'], limit: 1 }); expect(first.records[0].payload.intents).to.have.length(1);
  });

  it('does not accept copied bookkeeping fields as metadata-reader authority', async () => {
    const resourceBudget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null });
    const { journal, request } = await fixture({ ticks: 1, resourceBudget, jobs });
    const proxy = { ...journal, async openTakeOwned(takeId, options) { return { ...await journal.openTakeOwned(takeId, options) }; } };
    const projection = createPhysicalScoreProjection({ journal: proxy, resourceBudget, jobs, maxBytes: 32768 });
    try { await projection.queryPhysicalScoreOwned(request); expect.fail('copied source authority must reject'); }
    catch (error) { expect(error.code).to.equal('unowned-view-source'); }
    await journal.releaseQualifications().completion; expect(resourceBudget.diagnostics().accountedBytes).to.equal(0); jobs.dispose(); admission.dispose();
  });
  it('preserves captured roles, score times and immediate evidence across every semantic page split', async () => {
    for (const maxRecords of [1, 2, 3, 4, 512, 513]) {
      const ticks = maxRecords >= 512 ? 256 : 4;
      const { queryPhysicalScore, request } = await fixture({ ticks, sparse: maxRecords >= 512, maxRecords, maxGlyphs: 64, maxSourceFacts: 1024 });
      let cursor = null; const glyphs = [];
      do {
        const page = await queryPhysicalScore({ ...request, cursor, timeDomain: 'musical-score-time', actorOrRoleFilter: { roles: ['builder'] } });
        glyphs.push(...page.glyphs); cursor = page.continuation;
      } while (cursor);
      expect(glyphs.map(glyph => glyph.glyphId)).to.deep.equal(maxRecords >= 512 ? ['work:256'] : ['work:1', 'work:2', 'work:3', 'work:4']);
      for (const glyph of glyphs) expect(glyph.axis.status).to.equal('known');
      if (maxRecords < 512) expect(glyphs[2].intents[0].sinkEvidence[0].reason).to.equal('driver-drop');
    }
  });

  it('binds continuation cursors to the complete source/filter query', async () => {
    const { queryPhysicalScore, request } = await fixture({ ticks: 4, maxRecords: 1 });
    const page = await queryPhysicalScore(request); let error;
    try { await queryPhysicalScore({ ...request, cursor: page.continuation, actorOrRoleFilter: { roles: ['builder'] } }); }
    catch (failure) { error = failure; }
    expect(error.code).to.equal('stale-cursor');
  });

  it('reconciles exact typed source counts, transferred actor strands and actual sink evidence', async () => {
    const { queryPhysicalScore, request } = await fixture();
    const score = await queryPhysicalScore(request);
    expect(score.counts).to.deep.equal({ physicalBatches: 10, sourceFacts: 20, selectedFacts: 20, glyphs: 20, representedEvents: 20 });
    expect(score.glyphs[0]).to.include({ kind: 'work-cycle', glyphId: 'work:1' });
    expect(score.glyphs[1].kind).to.equal('encounter');
    const actor = score.actorStrands.find(strand => strand.actorId === 7);
    expect(actor.laneHistory.map(entry => [entry.tick, entry.laneId])).to.deep.equal([[1, 0], [6, 1]]);
    expect(score.actorStrands.filter(strand => strand.actorId === 7)).to.have.length(1);
    expect(score.glyphs.find(glyph => glyph.glyphId === 'work:3').intents[0].sinkEvidence[0]).to.include({ reason: 'driver-drop', status: 'rejected' });
    expect(score.glyphs.find(glyph => glyph.glyphId === 'work:2').intents[0].evidenceStatus).to.equal('unknown');
    expect(score.clockSegments.boundary.epoch).to.equal('score:1');
    expect(score.inspection).to.deep.equal({ paused: true, hardware: false, recording: false, thru: false, physicalLayers: false });
    expect(Object.isFrozen(score.glyphs[0].fact)).to.equal(true);
  });

  it('aggregates display events with exact counts and expandable source pointers', async () => {
    const { queryPhysicalScore, request } = await fixture({ ticks: 40 });
    const score = await queryPhysicalScore({ ...request, resolution: { mode: 'aggregate', bucketTicks: 10 } });
    expect(score.glyphs.length).to.be.lessThan(80);
    expect(score.glyphs.reduce((sum, glyph) => sum + glyph.eventCount, 0)).to.equal(80);
    expect(score.counts.representedEvents).to.equal(80);
    for (const aggregate of score.glyphs) {
      const expanded = await queryPhysicalScore({ ...aggregate.expansion, requestId: 'expand' });
      expect(expanded.glyphs).to.have.length(aggregate.eventCount);
      expect(expanded.glyphs[0].source.eventId).to.equal(aggregate.firstSource.eventId);
      expect(expanded.glyphs.at(-1).source.eventId).to.equal(aggregate.lastSource.eventId);
      expect(aggregate.uncertainty).to.equal('display-only-aggregation');
    }
  });

  it('keeps source, causal and interpreted musical axes explicit without quantization', async () => {
    const { queryPhysicalScore, request } = await fixture();
    const physical = await queryPhysicalScore({ ...request, coverageRange: { firstTick: 3, lastTick: 3 } });
    expect(physical.glyphs[0].axis).to.include({ value: 60, unit: 'milliseconds' });
    const causal = await queryPhysicalScore({ ...request, timeDomain: 'causal-order', coverageRange: { firstTick: 3, lastTick: 3 } });
    expect(causal.glyphs[0].axis).to.include({ value: 6, unit: 'causal-sequence' });
    const musical = await queryPhysicalScore({ ...request, timeDomain: 'musical-score-time', coverageRange: { firstTick: 3, lastTick: 3 } });
    expect(musical.glyphs[0].axis).to.include({ value: 0.375, unit: 'beats', epoch: 'score:1' });
    expect(musical.glyphs[1].axis).to.include({ status: 'unknown', reason: 'captured-score-time-unavailable' });
    expect(musical.glyphs[0].source.eventId).to.equal(physical.glyphs[0].source.eventId);
  });

  it('filters roles/actors, names source gaps and supports indexed causal-parent access', async () => {
    const { queryPhysicalScore, queryCausalParent, request } = await fixture({ gaps: true });
    const score = await queryPhysicalScore({ ...request, actorOrRoleFilter: { roles: ['builder'] } });
    expect(score.glyphs).to.have.length(10);
    expect(score.unknownRegions.find(region => region.kind === 'physical-facts')).to.include({ kind: 'physical-facts', firstTick: 4, lastTick: 4, reason: 'missing-source' });
    const glyph = score.glyphs[0];
    const parent = await queryCausalParent({ ...request, sourceSequence: glyph.source.sequence, eventId: glyph.glyphId });
    expect(parent).to.include({ status: 'found', eventId: 'work:1' });
    expect(parent.parentCauseIds).to.deep.equal(['command:build']);
    expect((await queryPhysicalScore({ ...request, actorOrRoleFilter: { actorIds: [8] } })).glyphs.every(item => item.actorId === 8)).to.equal(true);
  });

  it('paginates within a single dense batch without duplicating or losing source IDs', async () => {
    const { queryPhysicalScore, request } = await fixture({ ticks: 6, maxGlyphs: 3 });
    const ids = [];
    let cursor = null;
    do {
      const page = await queryPhysicalScore({ ...request, cursor });
      ids.push(...page.glyphs.map(item => item.glyphId)); cursor = page.continuation;
      if (cursor) expect(page.unknownRegions.some(region => region.reason === 'bounded-continuation')).to.equal(true);
    } while (cursor);
    expect(ids).to.deep.equal(Array.from({ length: 6 }, (_, index) => [`work:${index + 1}`, `contact:${index + 1}`]).flat());
  });

  it('rejects stale revisions and canceled or superseded requests', async () => {
    const { journal, request } = await fixture();
    const projection = createPhysicalScoreProjection({ journal });
    let error;
    try { await projection.queryPhysicalScore({ ...request, takeRevision: 1 }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('stale-revision');
    const controller = new AbortController(); controller.abort();
    try { await projection.queryPhysicalScore({ ...request, signal: controller.signal }); } catch (failure) { error = failure; }
    expect(error.code).to.equal('cancelled');
    const first = projection.queryPhysicalScore(request), second = projection.queryPhysicalScore(request);
    const results = await Promise.allSettled([first, second]);
    expect(results[0].status).to.equal('rejected'); expect(results[0].reason.code).to.equal('cancelled'); expect(results[1].status).to.equal('fulfilled');
  });

  it('reads only intersecting chunks for a small generation-filtered window', async () => {
    const { journal, request, chunks } = await fixture({ ticks: 1000 });
    let reads = 0;
    const proxy = { ...journal, query: args => journal.query(args) };
    // Chunk proxies count storage reads without replacing production query logic.
    const target = chunks.get.bind(chunks); chunks.get = key => { reads++; return target(key); };
    const projection = createPhysicalScoreProjection({ journal: proxy });
    const score = await projection.queryPhysicalScore({ ...request, coverageRange: { firstTick: 501, lastTick: 502 } });
    expect(score.counts.sourceFacts).to.equal(4);
    expect(reads).to.be.lessThan(4);
  });
});
