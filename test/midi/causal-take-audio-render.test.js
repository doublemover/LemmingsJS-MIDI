import { prepareEffectGraphRevision, effectGraphHash } from '../../js/midi/content/EffectGraphRevision.js';
import { expect } from 'chai';
import { createCausalTakeAudioRenderer } from '../../js/app/midi-ui/CausalTakeAudioRender.js';
import { renderCausalSineTake } from '../../js/app/midi-ui/CausalSineRender.js';
import { describeNativeInstrumentEngines } from '../../js/app/midi-ui/NativeInstrumentSchema.js';
import { createResourceBudget, ResourceBudgetError } from '../../js/app/resources/ResourceBudget.js';
import { createOwnedResourceReservation } from '../../js/app/resources/OwnedResourceReservation.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createProcgenCausalJournal } from '../../js/app/procgen/workstation/ProcgenCausalJournal.js';
import { createCausalTakeRecorder } from '../../js/app/procgen/workstation/CausalTake.js';
import { createMemoryCausalStore } from '../helpers/causalJournalStore.js';
import { createQuarryEcho, createQuarryTape, createQuarryBody } from '../../js/midi/content/DubQuarryRack.js';
import { prepareCausalEffectSelection } from '../../js/app/midi-ui/CausalEffectSelection.js';

// The render adapter below exercises host ownership, not real-worker/build qualification.
const setup = async ({ capturedEffects = false } = {}) => {
  const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), fallback = createBackgroundJobService({ admission, Worker: null });
  const descriptors = await describeNativeInstrumentEngines([{ engineId: 'worklet-sine', engineVersion: 1, artifactHash: 'a'.repeat(64) }]), descriptor = descriptors[0];
  const buildId = 'b'.repeat(64), switches = { wrongSource: false, wrongEffect: false, wrongReturn: false, deny: false }, jobs = { async compute(request) {
    if (request.kind !== 'render-causal-sine-take') return fallback.compute(request);
    if (switches.deny) throw new ResourceBudgetError('offline-render', request.estimatedPeakBytes, 0);
    const held = createOwnedResourceReservation({ budget, owner: 'component-render', kind: 'component-render', bytes: request.estimatedPeakBytes });
    let value, phase = 'retained-result';
    try { const input = request.prepareInput(); value = await renderCausalSineTake({ ...input, descriptor, applicationBuildId: buildId }, { yieldControl: async () => {}, maxWorkingBytes: request.estimatedPeakBytes });
      if (switches.wrongSource) value.manifest = { ...value.manifest, sourceCanonicalHash: 'c'.repeat(64) };
      if (switches.wrongEffect) value.manifest = { ...value.manifest, effectGraph: { ...value.manifest.effectGraph, hash: 'c'.repeat(64) } };
      if (switches.wrongReturn) value.files.at(-1).manifest = { ...value.files.at(-1).manifest, returnNodeId: 'wrong-return' };
    } catch (error) { held.release(); throw error; } finally { request.releasePreparedInput(); }
    return Object.freeze({ get value() { if (!value) throw new Error('retired'); return value; },
      receipt: Object.freeze({ kind: request.kind, method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound', buildId } }),
      release() { if (phase === 'released') return false; value = null; held.release(); phase = 'released'; return true; }, retirementState: () => ({ phase }) });
  } };
  const { storage } = createMemoryCausalStore(), journal = createProcgenCausalJournal({ storage, resourceBudget: budget, jobs });
  const recorder = await createCausalTakeRecorder({ journal, takeId: 'take:render-host', documentId: 'doc:render-host', sourceVersions: { source: 1 },
    mapping: { version: 1, revision: 1, instruments: [] }, initialCheckpoint: { tick: 0 }, boundaryState: { sourceTimeMs: 0, voices: [] } });
  for (const [tick, milliseconds, kind] of [[1, 100, 'begin'], [2, 300, 'end']]) {
    const batchId = 'batch:' + tick;
    recorder.recordCommittedBatch({ batch: { version: 1, worldId: 'world', generation: 1, tick, batchId, facts: [], completeness: { status: 'complete', dropped: 0 } },
      intents: [{ version: 1, kind, worldId: 'world', batchId, generation: 1, voiceId: 'voice', onsetId: 'voice', intentId: 'intent:' + tick,
        sourceEventIds: [], laneId: 0, pitch: { cents: 6000, referenceHz: 440 }, velocity01: 0.5, expression: {}, scoreTime: { sourceTimeMs: milliseconds, simTick: tick, subTick: 0 } }] });
  }
  if (capturedEffects) {
    const definition = createQuarryEcho({ send01: 0 }), graphDefinitionHash = await effectGraphHash(prepareEffectGraphRevision(definition)), base = {
      schema: 'lemmings-effect-performance/v1', status: 'accepted', stage: 'effect-performance-captured', streamId: 'captured-effect-fixture', ownerRouteRevision: 1,
      graphDefinitionHash, sampleRate: 48000, executionEpoch: 'live-capture', clockAnchor: { intentId: 'intent:1', sourceTargetFrame: 4800, executionEpoch: 'live-capture' }, sourceEventIds: [], acousticReceipt: false };
    recorder.recordSinkOutcome({ ...base, operation: 'graph', sequence: 1, targetFrame: 5000, definition }, { tick: 2, generation: 1 });
    recorder.recordSinkOutcome({ ...base, operation: 'control', sequence: 2, targetFrame: 7000, nodeId: 'send', values: { gain01: 0.5 } }, { tick: 2, generation: 1 });
  }
  await recorder.stop({ boundaryState: { sourceTimeMs: 1000, voices: [] } });
  const manifest = await journal.openTake('take:render-host'), states = [];
  const renderer = createCausalTakeAudioRenderer({ journal, resourceBudget: budget, jobs, sourceMaxBytes: 32768,
    getCatalog: async () => ({ state: 'bound-application-engines', descriptors }), onState: state => states.push(state.phase) });
  return { renderer, journal, manifest, budget, switches, states, admission,
    async dispose() { const bundle = renderer.getPrepared(); if (bundle) for (const file of bundle.files) await file.artifact.digest();
      await renderer.dispose().completion; await journal.releaseQualifications().completion; fallback.dispose(); admission.dispose(); } };
};
const denied = async (work, code) => { let error; try { await work; } catch (caught) { error = caught; } expect(error).to.be.instanceOf(Error); if (code) expect(error.code).to.equal(code); return error; };

describe('owned causal render host and prepared file bundles', () => {
  it('binds simultaneous effect files and preserves the previous complete bundle on graph/tap mismatch', async () => {
    const owner = await setup(), request = { takeId: owner.manifest.takeId, endSeconds: 0.5, includeAllLaneStems: true,
      effectGraph: createQuarryEcho({ send01: 0.4 }), effectReturnNodeIds: ['return'] };
    const first = await owner.renderer.prepare(request); expect(first.bundle.files).to.have.length(3); expect(first.bundle.files[2].label).to.include('Shared effect return');
    expect(first.bundle.manifest.stems.sharedReturns).to.deep.equal(['return']); expect(first.bundle.manifest.effectGraph.controls).to.include('not-replayed-live-gestures');
    owner.switches.wrongEffect = true; await denied(owner.renderer.prepare(request), 'render-effect-mismatch'); expect(owner.renderer.getPrepared()).to.equal(first.bundle);
    owner.switches.wrongEffect = false; owner.switches.wrongReturn = true; await denied(owner.renderer.prepare(request), 'render-result-mismatch'); expect(owner.renderer.getPrepared()).to.equal(first.bundle);
    expect(first.bundle.files.every(file => file.artifact.metadata().retained)).to.equal(true);
    await denied(owner.renderer.prepare({ ...request, effectReturnNodeIds: Array.from({ length: 9 }, (_, index) => 'tap-' + index) }), 'render-unavailable');
    await owner.dispose(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('selects explicit new authored effects and native bodies without mutating saved defaults or activating bypassed racks', () => {
    const rack = { schema: 'lemmings-owner-effect-rack/v1', graph: createQuarryTape({ revision: 12 }), bypass: 'active' };
    const selected = prepareCausalEffectSelection({ preset: 'saved-owner', rack, send01: 0.2 });
    expect(selected.effectGraph.nodes.find(node => node.id === 'send').parameters.gain01).to.equal(0.2); expect(rack.graph.nodes.find(node => node.id === 'send').parameters.gain01).to.equal(0);
    expect(selected.effectReturnNodeIds).to.deep.equal(['return']); expect(Object.isFrozen(selected.effectGraph)).to.equal(true);
    expect(prepareCausalEffectSelection({ preset: 'none' })).to.deep.equal({ effectGraph: null, effectReturnNodeIds: [] });
    expect(() => prepareCausalEffectSelection({ preset: 'saved-owner', rack: { ...rack, bypass: 'neutral' } })).to.throw('not activated implicitly');
    expect(prepareCausalEffectSelection({ preset: 'saved-owner', rack: { ...rack, graph: createQuarryBody() } }).effectGraph.nodes.some(node => node.kind === 'convolution-native')).to.equal(true);
  });
  it('retains prepared WAVs after request cancellation and retires source/computation separately', async () => {
    const owner = await setup(), controller = new AbortController();
    const result = await owner.renderer.prepare({ takeId: owner.manifest.takeId, takeRevision: owner.manifest.revision, endSeconds: 0.5, signal: controller.signal });
    expect(owner.states).to.include.members(['preparing-source', 'rendering', 'retiring', 'prepared']);
    expect(owner.admission.diagnostics().retainedResults).to.equal(0); expect(result.bundle.files).to.have.length(1);
    controller.abort(); expect(result.bundle.files[0].artifact.metadata().retained).to.equal(true); expect(owner.renderer.state().phase).to.equal('prepared');
    expect(await owner.journal.openTake(owner.manifest.takeId)).to.deep.equal(owner.manifest); await owner.dispose(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('preserves the previous prepared file across denied admission and mismatched replacement output', async () => {
    const owner = await setup(), request = { takeId: owner.manifest.takeId, endSeconds: 0.5 };
    const first = await owner.renderer.prepare(request); owner.switches.deny = true;
    expect(await denied(owner.renderer.prepare(request))).to.be.instanceOf(ResourceBudgetError); expect(first.bundle.files[0].artifact.metadata().retained).to.equal(true);
    owner.switches.deny = false; owner.switches.wrongSource = true;
    await denied(owner.renderer.prepare(request), 'render-result-mismatch'); expect(owner.renderer.getPrepared()).to.equal(first.bundle);
    expect(first.bundle.files[0].artifact.metadata().retained).to.equal(true); expect(owner.admission.diagnostics().retainedResults).to.equal(0);
    await owner.dispose(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
  });
});


describe('captured FX command render host', () => {
  it('reads existing journal outcomes and binds the requested replay without changing the original take', async () => {
    const owner = await setup({ capturedEffects: true });
    try {
      const originalHash = owner.manifest.canonicalHash, result = await owner.renderer.prepare({ takeId: owner.manifest.takeId, endSeconds: 0.5, capturedEffects: true });
      expect(result.bundle.manifest.effectGraph.controls).to.equal('captured-native-API-commands-new-owned-realization');
      expect(result.bundle.manifest.effectGraph.commandReplay.events).to.equal(1); expect(result.bundle.manifest.effectGraph.commandReplay.hash).to.match(/^[a-f0-9]{64}$/);
      expect(result.bundle.manifest.effectGraph.commandReplay.initialMemory).to.include('cleared'); expect(result.bundle.manifest.sourceCanonicalHash).to.equal(originalHash);
      expect(result.bundle.files).to.have.length(2);
    } finally { await owner.dispose(); }
    expect(owner.budget.diagnostics().accountedBytes).to.equal(0);
  });
});
