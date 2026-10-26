import { expect } from 'chai';
import { prepareSceneNativeRehearsal } from '../js/app/procgen/workstation/SceneNativeRehearsal.js';
import { createGlassOrbitScores } from '../js/app/procgen/workstation/GlassOrbitScore.js';
import { renderPerformanceSceneRehearsal } from '../js/app/procgen/workstation/PerformanceSceneRehearsalRender.js';
import { performanceSceneHash } from '../js/app/procgen/workstation/PerformanceScene.js';
import { describeNativeInstrumentEngines } from '../js/app/midi-ui/NativeInstrumentSchema.js';
import { planCausalSourceRender } from '../js/app/midi-ui/CausalOwnedRender.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { hashData } from '../js/core/CanonicalData.js';

const h = value => value.repeat(64), buildId = h('b'), refuse = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected refusal.'); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

// Source intents and PCM below are explicit mechanical doubles. They qualify
// source binding, encoding/mix and lifetime contracts, never native synthesis.
const fixture = async (flock = false) => {
  const engines = await describeNativeInstrumentEngines([{ engineId: 'native-fm', engineVersion: 1, artifactHash: h('a') }]), items = await createGlassOrbitScores({ sourceHash: buildId, descriptor: engines[0] }), item = items.find(row => row.scene.id === 'glass-orbit.' + (flock ? 'flock' : 'solo') + '.pentatonic'), sceneHash = await performanceSceneHash(item.scene), budget = createResourceBudget(), switches = { hold: null, fail: null, releaseFailure: null }, prepared = [], released = [];
  const intents = item.scene.patchRefs.flatMap((row, laneId) => [{ kind: 'begin', generation: 1, voiceId: 'fixture:' + laneId, onsetId: 'fixture:' + laneId, intentId: 'fixture:begin:' + laneId, mappingId: 'glass-orbit-' + laneId + '-glass-orbit-gate-0', sourceEventIds: [], laneId, route: 'local', role: 'tuned-glass-crossing', pitch: { cents: 6900, referenceHz: 220 }, velocity01: 0.5, expression: {}, scoreTime: 0 }, { kind: 'end', generation: 1, voiceId: 'fixture:' + laneId, onsetId: 'fixture:' + laneId, intentId: 'fixture:end:' + laneId, sourceEventIds: [], laneId, route: 'local', scoreTime: 100 }]);
  const source = { schema: 'lemmings-scene-rehearsal-source/v1', sceneHash, initialTick: 0, ticks: 4, sourceTimeMs: 0, durationSeconds: 0.25, worldId: 'explicit-mechanical-fixture', generation: 1, seed: item.scene.seed, intents }, sourceHash = await hashData(source, { maxBytes: 8 * 1048576, maxNodes: 524288 });
  const prepareNative = async (input, options) => {
    const index = prepared.length; prepared.push(input); if (switches.fail === index) throw new Error('Synthetic native preparation failure.');
    const plan = await planCausalSourceRender({ ...input, maxPlanningBytes: 64 * 1048576 }), lease = options.resources.reserve({ kind: 'synthetic-native-pcm', bytes: plan.outputEnd * 8 }), planes = [new Float32Array(plan.outputEnd), new Float32Array(plan.outputEnd)]; planes[0][10] = 0.1; planes[1][10] = -0.1;
    const manifest = { schema: 'lemmings-causal-audio-render/v1', takeId: plan.source.takeId, takeRevision: plan.source.takeRevision, sourceCanonicalHash: plan.source.sourceCanonicalHash, applicationBuildId: buildId, definitionHash: plan.definitionHash, intentHash: plan.intentHash, sampleRate: input.sampleRate, frames: plan.outputFrames, channels: 2, sampleFormat: 'ieee-float32-le', timelineZeroSourceFrame: 0, exactEndSourceFrame: plan.endFrame, tail: { mode: 'boundary-release', maxSeconds: 0.5 }, effectGraph: null, engineRequirement: item.scene.patchRefs[index].reference.engineRequirement, stems: { laneIds: [], sharedReturns: 'none-in-selected-graph' }, nativeScheduling: { method: 'native-offline-audio-context', nativeSourceBackend: 'native-fm', frames: plan.outputEnd, crossBrowserBitIdentity: false } };
    const result = { input: { mode: 'causal-take', manifest, planes, firstFrame: 0, endFrame: plan.outputEnd, stemLaneIds: [] }, bytes: plan.outputEnd * 8, release() { released.push(index); if (switches.releaseFailure === index) throw new Error('Synthetic unknown native PCM retirement.'); lease.release(); return true; } };
    if (switches.hold && index === 0) { switches.hold.entered.resolve(); await switches.hold.release.promise; } return result;
  };
  const options = { scene: item.scene, source, sourceHash, sampleRate: 48000, resourceBudget: budget, prepareNative, getCatalog: async () => ({ state: 'bound-application-engines', executionIdentity: { buildId }, descriptors: engines }) };
  return { budget, switches, prepared, released, options, item, source, sourceHash, sceneHash, engines };
};

describe('native scene rehearsal preparation (mechanical PCM doubles; synthesis acceptance deferred)', () => {
  it('keeps actual native PCM reserved through explicit input handoff and retires metadata independently afterwards', async () => {
    const f = await fixture(true), owner = await prepareSceneNativeRehearsal(f.options), bytes = owner.bytes;
    expect(f.prepared).to.have.length(3); expect(owner.inputs().map(row => row.sourceIndex)).to.deep.equal([0, 1, 2]); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(bytes);
    expect(owner.releaseInputs()).to.equal(true); expect(f.released).to.deep.equal([0, 1, 2]); expect(() => owner.inputs()).to.throw('retired'); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
    const receipt = owner.retire(); await receipt.completion; expect(receipt.outcome).to.equal('complete'); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('worker-encodes a bound native lane and refuses missing or mismatched native history before substituting anything', async () => {
    const f = await fixture(), owner = await prepareSceneNativeRehearsal(f.options), input = { scene: f.item.scene, sceneHash: f.sceneHash, source: f.source, sampleRate: 48000, nativeLanes: owner.inputs() }, options = { descriptors: f.engines, buildId, yieldControl: async () => {} };
    try {
      const result = await renderPerformanceSceneRehearsal(input, options); expect(result.manifest.lanes[0].realization.method).to.equal('native-offline-audio-context;worker-encoded-and-mixed'); expect(result.manifest.lanes[0].realization.crossBrowserBitIdentity).to.equal(false); expect(result.manifest.statistics.peak).to.be.greaterThan(0); expect(result.manifest.lanes[0].begins).to.equal(1);
      expect((await refuse(renderPerformanceSceneRehearsal({ ...input, nativeLanes: [] }, options))).message).to.include('separately prepared');
      input.nativeLanes[0].input.manifest.sourceCanonicalHash = h('1'); expect((await refuse(renderPerformanceSceneRehearsal(input, options))).message).to.include('exact private source');
    } finally { await owner.retire().completion; } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains an in-progress native producer through cancellation and cleans earlier lanes when later preparation fails', async () => {
    const f = await fixture(true), gate = { entered: deferred(), release: deferred() }, controller = new AbortController(); f.switches.hold = gate;
    const pending = refuse(prepareSceneNativeRehearsal({ ...f.options, signal: controller.signal })); await gate.entered.promise; controller.abort(new Error('Cancel private native source.')); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0); gate.release.resolve(); await pending; expect(f.released).to.deep.equal([0]); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    const failed = await fixture(true); failed.switches.fail = 2; await refuse(prepareSceneNativeRehearsal(failed.options)); expect(failed.released).to.deep.equal([0, 1]); expect(failed.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('attempts all independent native PCM releases and does not retry an unknown release as if it had succeeded', async () => {
    const f = await fixture(true), owner = await prepareSceneNativeRehearsal(f.options); f.switches.releaseFailure = 0;
    const receipt = owner.retire(); await receipt.completion; expect(receipt.outcome).not.to.equal('complete'); expect(f.released).to.deep.equal([0, 1, 2]); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
});
