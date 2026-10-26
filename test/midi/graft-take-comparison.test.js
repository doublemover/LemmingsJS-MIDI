import { expect } from 'chai';
import { createGraftTakeComparisonOwner } from '../../js/app/midi-ui/GraftTakeComparisonOwner.js';
import { prepareGraftComparison } from '../../js/midi/content/GraftComparison.js';
import { prepareExportArtifact } from '../../js/app/export/ExportArtifact.js';
import { encodeOwnedAudioWav } from '../../js/app/midi-ui/OwnedAudioWav.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';
import { hashData } from '../../js/core/CanonicalData.js';

const h = value => value.repeat(64), refuse = async promise => { try { await promise; } catch (error) { return error; } throw new Error('Expected refusal.'); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reference = async graft => {
  const definition = { schemaVersion: 2, id: graft ? 'fixture.graft' : 'fixture.original', revision: 1, engineId: graft ? 'worklet-texture' : 'worklet-sine', engineVersion: 1, parameters: graft ? { graftModeCount: 2, graftMix01: 0.7, gain01: 0.25 } : { gain01: 0.25 }, macros: [], sampleRefs: [] };
  return { schema: 'lemmings-sound-reference/v1', packHash: h(graft ? 'd' : 'e'), patchId: definition.id, revision: 1, definitionHash: await hashData(definition), definition, assetHashes: [], engineRequirement: { engineId: definition.engineId, engineVersion: 1, artifactHash: h('a'), parameterSchemaHash: h('b') } };
};

// Deliberately synthetic render fixtures. They exercise transaction and actual
// artifact lifetime boundaries, without running or qualifying any source DSP.
const fixture = async () => {
  const budget = createResourceBudget(), original = await reference(false), graft = await reference(true), calls = [], retired = [], switches = { mismatch: null, failRole: null, hold: null, retirementFailure: null }; let running = 0, peakRunning = 0;
  const createRenderer = () => {
    const index = calls.length, scope = createProcgenRetirementScope(); let file = null, active = false, canceled = false;
    return {
      state: () => ({ active, unresolvedRetirement: 0 }), cancel() { canceled = true; },
      async prepare(options) {
        calls.push(options); active = true; running++; peakRunning = Math.max(peakRunning, running);
        try {
          if (switches.failRole && switches.failRole === options.graftComparison) throw new Error('Synthetic failed role.');
          const comparison = options.graftComparison ? await prepareGraftComparison(options.definition, options.graftComparison) : null, definitionHash = comparison?.comparison.definitionHash ?? await hashData(options.definition), frames = Math.round((options.endSeconds - options.startSeconds) * options.sampleRate), manifest = { schema: 'lemmings-causal-audio-render/v1', takeId: options.takeId, takeRevision: options.takeRevision, sourceCanonicalHash: h('c'), applicationBuildId: h('f'), definitionHash, sampleRate: options.sampleRate, frames, timelineZeroSourceFrame: Math.round(options.startSeconds * options.sampleRate), exactEndSourceFrame: Math.round(options.endSeconds * options.sampleRate), tail: { mode: options.tail.mode, maxSeconds: options.tail.maxSeconds ?? 4, truncated: false }, engineRequirement: options.materialReference.engineRequirement };
          if (switches.mismatch && options.graftComparison === 'body-only') manifest[switches.mismatch] = switches.mismatch === 'frames' ? frames + 1 : h('1');
          const bytes = encodeOwnedAudioWav(new Uint8Array(frames * 8), frames, options.sampleRate, manifest), artifact = prepareExportArtifact({ bytes, immutableSourceRef: 'synthetic-graft-take-fixture:' + calls.length, formatVersion: manifest.schema, suggestedFilename: 'fixture.wav', budgetAdapter: budget }); await artifact.digest(); file = { id: '0', label: 'Synthetic render', artifact, manifest };
          if (switches.hold && options.graftComparison === 'exciter-only') { switches.hold.entered.resolve(); await switches.hold.release.promise; }
          return { bundle: { manifest, files: [file] }, receipt: { method: 'dedicated-worker', executionIdentity: { activeExecution: 'bound' } }, ...(comparison ? { comparison: comparison.comparison } : {}) };
        } finally { active = false; running--; }
      },
      dispose() { return scope.getReceipt() || scope.retire([{ name: 'synthetic-render-artifact', run: async () => { retired.push(index); if (switches.retirementFailure === index) throw new Error('Synthetic unresolved producer.'); file?.artifact.discard(); await file?.artifact.digest(); if (file?.artifact.metadata().activeLeases) throw new Error('Synthetic unresolved reader.'); file = null; } }]); },
      get canceled() { return canceled; }
    };
  };
  const owner = createGraftTakeComparisonOwner({ resourceBudget: budget, createRenderer });
  const options = { takeId: 'take:fixture', takeRevision: 3, originalReference: original, graftReference: graft, sampleRate: 48000, startSeconds: 0, endSeconds: 0.01 };
  return { owner, budget, original, graft, calls, retired, switches, options, peak: () => peakRunning };
};

describe('atomic four-readout graft take comparisons (synthetic DSP fixture)', () => {
  it('uses sequential ordinary render owners, one take/frame domain and exact unchanged material references', async () => {
    const f = await fixture();
    try {
      const bundle = await f.owner.prepare(f.options); expect(bundle.files.map(file => file.id)).to.deep.equal(['original', 'exciter-only', 'body-only', 'full-graft']); expect(f.peak()).to.equal(1); expect(f.calls).to.have.length(4);
      expect(f.calls.map(call => call.graftComparison)).to.deep.equal([null, 'exciter-only', 'body-only', null]);
      for (const call of f.calls.slice(1)) { expect(call.materialReference).to.deep.equal(f.graft); expect(await hashData(call.definition)).to.equal(f.graft.definitionHash); expect(call.takeRevision).to.equal(3); expect(call.restorationMode).to.equal('forward-preroll'); }
      expect(bundle.manifest.sourceCanonicalHash).to.equal(h('c')); expect(bundle.manifest.acousticReceipt).to.equal(false); expect(bundle.manifest.level).to.include('no-loudness-normalization'); expect(bundle.manifest.readouts[2].comparison.mix01).to.equal(1); expect(bundle.manifest.readouts[1].comparison.mix01).to.equal(0);
      for (const [index, file] of bundle.files.entries()) expect(await file.artifact.digest()).to.equal(bundle.manifest.readouts[index].artifactHash);
      const { comparisonHash, ...manifest } = bundle.manifest; expect(comparisonHash).to.equal(await hashData(manifest, { maxBytes: 262144, maxNodes: 8192 }));
    } finally { await f.owner.dispose().completion; } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('retains the prior complete set on a later source/build/frame mismatch or failed body render', async () => {
    const f = await fixture();
    try {
      const first = await f.owner.prepare(f.options), before = f.budget.diagnostics().accountedBytes;
      for (const mismatch of ['sourceCanonicalHash', 'applicationBuildId', 'frames']) { f.switches.mismatch = mismatch; await refuse(f.owner.prepare(f.options)); expect(f.owner.getPrepared()).to.equal(first); expect(first.files.every(file => file.artifact.metadata().retained)).to.equal(true); expect(f.budget.diagnostics().accountedBytes).to.equal(before); }
      f.switches.mismatch = null; f.switches.failRole = 'body-only'; await refuse(f.owner.prepare(f.options)); expect(f.owner.getPrepared()).to.equal(first); expect(f.budget.diagnostics().accountedBytes).to.equal(before);
    } finally { await f.owner.dispose().completion; } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('holds admitted work through a late canceled producer and never publishes its partial files', async () => {
    const f = await fixture(), gate = { entered: deferred(), release: deferred() };
    try {
      const first = await f.owner.prepare(f.options), before = f.budget.diagnostics().accountedBytes; f.switches.hold = gate;
      const pending = refuse(f.owner.prepare(f.options)); await gate.entered.promise; f.owner.cancel(); expect(f.owner.state().active).to.equal(true); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(before); expect(f.owner.getPrepared()).to.equal(first); gate.release.resolve(); await pending; expect(f.owner.getPrepared()).to.equal(first); expect(f.budget.diagnostics().accountedBytes).to.equal(before);
    } finally { gate.release.resolve(); await f.owner.dispose().completion; } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('refuses to replace an actively borrowed last-good set, including a reader acquired during preparation', async () => {
    const f = await fixture(), gate = { entered: deferred(), release: deferred() }; let loan;
    try {
      const first = await f.owner.prepare(f.options); loan = first.files[0].artifact.borrow(); const count = f.calls.length; await refuse(f.owner.prepare(f.options)); expect(f.calls.length).to.equal(count); loan.release(); loan = null;
      f.switches.hold = gate; const pending = refuse(f.owner.prepare(f.options)); await gate.entered.promise; loan = first.files[1].artifact.borrow(); gate.release.resolve(); await pending; expect(f.owner.getPrepared()).to.equal(first); expect(first.files.every(file => file.artifact.metadata().retained)).to.equal(true); loan.release(); loan = null;
    } finally { gate.release.resolve(); loan?.release(); await f.owner.dispose().completion; } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('freezes admitted references and rejects a stale request after an uncooperative old render completes', async () => {
    const f = await fixture(), gate = { entered: deferred(), release: deferred() }; let current = true;
    try {
      const first = await f.owner.prepare(f.options); f.switches.hold = gate;
      const pending = refuse(f.owner.prepare({ ...f.options, isCurrent: () => current })); await gate.entered.promise;
      f.graft.definition.parameters.graftMix01 = 0.1; current = false; gate.release.resolve(); await pending;
      expect(f.owner.getPrepared()).to.equal(first); expect(f.calls.slice(4).every(call => call.materialReference.definition.parameters.graftMix01 === (call.graftComparison === null ? undefined : 0.7) || call.materialReference.patchId === 'fixture.original')).to.equal(true);
      expect(f.owner.state().phase).to.equal('previous-comparison-retained');
    } finally { gate.release.resolve(); await f.owner.dispose().completion; } expect(f.budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('bounds range/output before starting renderers and rejects unsupported grafts without changing the original', async () => {
    const f = await fixture();
    try {
      await refuse(f.owner.prepare({ ...f.options, endSeconds: 17 })); await refuse(f.owner.prepare({ ...f.options, sampleRate: 96000, endSeconds: 16, tail: { mode: 'bounded-natural', maxSeconds: 5 } }));
      const bad = await reference(false); await refuse(f.owner.prepare({ ...f.options, graftReference: bad })); expect(f.calls).to.have.length(0); expect(f.budget.diagnostics().accountedBytes).to.equal(0);
    } finally { await f.owner.dispose().completion; }
  });
  it('attempts every independent renderer retirement and retains the budget when one producer is unknown', async () => {
    const f = await fixture(); f.switches.retirementFailure = 0;
    await f.owner.prepare(f.options); const receipt = f.owner.dispose(); await receipt.completion; expect(receipt.outcome).not.to.equal('complete'); expect(f.retired).to.have.length(4); expect(f.budget.diagnostics().accountedBytes).to.be.greaterThan(0);
  });
});
