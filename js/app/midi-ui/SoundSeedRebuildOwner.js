import { createSoundSeedAnalysisOwner } from './SoundSeedAnalysisOwner.js';
import { createSoundSeedDerivedOwner } from './SoundSeedDerivedOwner.js';
import { createSoundSeedInstrumentOwner } from './SoundSeedInstrumentOwner.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

const fail = message => Object.assign(new Error(message), { name: 'SeedRebuildError', code: 'seed-rebuild-unavailable' });

export function createSoundSeedRebuildOwner({ audio, resourceBudget, jobs, indexedDB, keyRange, getCatalog, coreMaterial = null, getTargetIdentity, onApply, onState = () => {}, onReveal } = {}) {
  if (typeof getTargetIdentity !== 'function' || typeof onApply !== 'function') throw new TypeError('Derived rebuilds need an exact target identity and atomic patch application owner.');
  const retirement = createProcgenRetirementScope(), unknown = new Set();
  let current = null, active = null, disposed = false, sequence = 0, phase = 'frozen-material-kept', error = null;
  const identity = () => canonicalDataText(getTargetIdentity(), { maxBytes: 65536, maxNodes: 8192 }).text;
  const state = () => Object.freeze({ disposed, phase, error, active: !!active, unknownRetirement: unknown.size, summary: current?.summary || null, instrument: current?.instrument.state() || null,
    targetCurrent: !!current && current.target === identity() });
  const report = () => { if (!disposed) { try { onState(state()); } catch {} } };
  const disposeBundle = bundle => {
    if (!bundle) return null; if (bundle.scope.getReceipt()) return bundle.scope.getReceipt();
    const retire = async owner => { if (!owner) return; const receipt = owner.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('A derived branch retains unresolved producers or readers.'); };
    const instrumentFinished = retire(bundle.instrument), modalFinished = instrumentFinished.then(() => retire(bundle.modal)), warpFinished = modalFinished.then(() => retire(bundle.warp)), componentsFinished = warpFinished.then(() => retire(bundle.composition)).then(() => retire(bundle.components)), analysisFinished = componentsFinished.then(() => retire(bundle.analysis));
    return bundle.scope.retire([{ name: 'branch-instrument', run: () => instrumentFinished }, { name: 'branch-modal', run: () => modalFinished },
      { name: 'branch-warp', run: () => warpFinished }, { name: 'branch-components', run: () => componentsFinished }, { name: 'branch-region', run: () => analysisFinished },
      { name: 'branch-plan', run: async () => { await analysisFinished; bundle.workspace.release(); bundle.asset = null; } }]);
  };
  const cancel = () => { if (!active) return; active.controller.abort(fail('Derived branch preparation canceled.')); active.bundle?.analysis.cancel(); active.bundle?.composition.cancel(); active.bundle?.components.cancel(); active.bundle?.modal.cancel(); active.bundle?.warp?.cancel(); active.bundle?.instrument.stop(); };
  const prepare = ({ plan, replacement, isCurrent = () => true } = {}) => {
    if (disposed || active || unknown.size || plan?.schema !== 'lemmings-sound-seed-rebuild-plan/v1' || plan.state !== 'rebuildable' || !replacement?.artifact?.metadata().retained || typeof isCurrent !== 'function') return Promise.reject(fail('Choose a rebuildable explicit plan and retained replacement source.'));
    const target = identity(), operation = { controller: new AbortController(), bundle: null, generation: ++sequence, published: false, promise: null };
    const check = () => { operation.controller.signal.throwIfAborted(); if (disposed || !isCurrent() || identity() !== target) throw fail('The selected target, project or rebuild plan changed.'); };
    active = operation; phase = 'preparing-derived-branch'; error = null; report();
    operation.promise = (async () => {
      try {
        const inventory = canonicalDataText(plan, { maxBytes: 262144, maxNodes: 32768 }); plan = freezeData(JSON.parse(inventory.text));
        const { planHash, ...effectivePlan } = plan; if (await hashData(effectivePlan, { maxBytes: 262144, maxNodes: 32768 }) !== planHash || plan.nodes[0].newSourceRef !== replacement.artifact.metadata().immutableSourceRef) throw fail('The reviewed plan or replacement source identity changed.'); check();
        const workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: 'seed-derived-branch', generation: operation.generation, category: 'candidate', kind: 'derived-branch-plan', bytes: Math.max(4096, inventory.bytes.length * 8 + 262144) });
        const bundle = operation.bundle = { scope: createProcgenRetirementScope(), workspace, analysis: null, components: null, composition: null, warp: null, modal: null, instrument: null, asset: null, target, summary: null };
        const options = { resourceBudget, jobs, onState: report };
        bundle.analysis = createSoundSeedAnalysisOwner(options); bundle.components = createSoundSeedDerivedOwner(options); bundle.composition = createSoundSeedDerivedOwner({ ...options, kind: 'composition' }); bundle.modal = createSoundSeedDerivedOwner({ ...options, kind: 'body-fit' });
        if (plan.warpOptions) { if (!coreMaterial) throw fail('This reviewed warp branch needs its owned pinned core material reader.'); bundle.warp = createSoundSeedDerivedOwner({ ...options, kind: 'warp', coreMaterial }); }
        bundle.instrument = createSoundSeedInstrumentOwner({ audio, resourceBudget, jobs, indexedDB, keyRange, getCatalog, getTargetIdentity, onState: report, onReveal,
          onApply: (candidate, request) => { if (disposed || identity() !== target) throw fail('The target changed after this derived branch was prepared.'); return onApply(candidate, request); } });
        check(); await bundle.analysis.selectSource(replacement); check();
        const base = await bundle.analysis.prepare({ firstFrame: plan.parentRegionFrames[0], endFrame: plan.parentRegionFrames[1], fades: plan.fades, signal: operation.controller.signal, isCurrent: () => !disposed && isCurrent() && identity() === target }); check();
        if (base.manifest.frames !== plan.expectedRegionFrames || base.manifest.sampleRate !== plan.sampleRate) throw fail('The prepared replacement region differs from the reviewed plan.');
        if (plan.componentOptions) { phase = 'rebuilding-selected-components'; report(); await bundle.components.prepare(base, { options: plan.componentOptions, isCurrent: () => !disposed && isCurrent() && identity() === target }); check(); }
        if (plan.compositionOptions) {
          phase = 'reprinting-selected-components'; report();
          await bundle.composition.prepare(base, { options: plan.compositionOptions, componentCandidates: ['transient-like', 'sustained-like', 'residual'].map(kind => bundle.components.component(kind)), isCurrent: () => !disposed && isCurrent() && identity() === target }); check();
        }
        const material = kind => kind === 'original' ? base : kind === 'warped-seed' ? bundle.warp?.component(kind) : kind === 'component-composition' ? bundle.composition.component(kind) : kind.startsWith('modal-') ? bundle.modal.component(kind) : bundle.components.component(kind);
        if (plan.warpOptions) {
          const parent = material(plan.warpParentMaterial); if (!parent?.metadata().assetReady) throw fail('The rebuilt finite warp parent is missing.');
          phase = 'rebaking-selected-warp'; report(); await bundle.warp.prepare(parent, { options: plan.warpOptions, isCurrent: () => !disposed && isCurrent() && identity() === target }); check();
          const actual = bundle.warp.state().analysis?.recipe; if (actual?.coreArtifactHash !== plan.warpInputs?.coreArtifactHash || actual?.coreConfigurationHash !== plan.warpInputs?.coreConfigurationHash) throw fail('The rebuilt warp core/configuration differs from the reviewed plan; frozen material remains unchanged.');
        }
        let modalParent = null;
        if (plan.modalOptions) {
          modalParent = material(plan.modalParentMaterial);
          if (!modalParent?.metadata().assetReady) throw fail('The rebuilt modal parent is missing.');
          phase = 'refitting-selected-body'; report(); await bundle.modal.prepare(modalParent, { options: plan.modalOptions, isCurrent: () => !disposed && isCurrent() && identity() === target }); check();
        }
        bundle.asset = plan.transform === 'modal-body' ? modalParent : material(plan.selectedMaterial);
        if (!bundle.asset?.metadata().assetReady) throw fail('The selected rebuilt material was not prepared.');
        phase = 'compiling-derived-branch'; report(); await bundle.instrument.prepare(bundle.asset, { transform: plan.transform, graftBody: plan.graftBody, textureKind: plan.textureKind, traversalBinding: plan.traversalBinding, pitch: plan.pitch, modalFit: bundle.modal.state().analysis, isCurrent: () => !disposed && isCurrent() && identity() === target }); check();
        bundle.summary = freezeData({ schema: 'lemmings-prepared-seed-branch/v1', planHash: plan.planHash, generation: operation.generation, originalAssetHash: plan.originalAssetHash,
          newRegionAssetHash: base.metadata().assetHash, newSelectedAssetHash: bundle.asset.metadata().assetHash, selectedMaterial: plan.selectedMaterial,
          contentHash: bundle.instrument.state().contentHash, patchIdentity: bundle.instrument.state().patchIdentity, sourceTake: plan.sourceTake, sourceProfile: plan.sourceProfile,
          stages: plan.nodes.map(node => ({ id: node.id, kind: node.kind, state: 'prepared', originalHash: node.oldHash })),
          originalMaterial: 'unchanged-and-still-playable', projectReferences: 'unchanged-until-explicit-apply', durability: 'not-established-until-storage-commit', qualification: plan.determinism });
        check(); const previous = current; current = bundle; operation.published = true;
        const receipt = disposeBundle(previous); if (receipt) { await receipt.completion; if (receipt.outcome !== 'complete') { unknown.add({ previous, receipt }); throw fail('The previous candidate branch has unresolved retirement.'); } }
        phase = identity() === target ? 'derived-branch-prepared' : 'prepared-branch-target-stale'; report(); return current.summary;
      } catch (failure) {
        const receipt = operation.published ? null : disposeBundle(operation.bundle); if (receipt) { await receipt.completion; if (receipt.outcome !== 'complete') unknown.add({ bundle: operation.bundle, receipt }); }
        error = String(failure.message).slice(0, 512); phase = unknown.size ? 'ownership-unknown' : current ? 'previous-derived-branch-retained' : 'frozen-material-kept'; report(); throw failure;
      }
    })(); operation.promise.finally(() => { if (active === operation) active = null; report(); }).catch(() => {}); return operation.promise;
  };
  const action = (name, work) => {
    if (disposed || active || unknown.size || !current) return Promise.reject(fail('Prepare a complete candidate branch first.'));
    const operation = { controller: new AbortController(), bundle: current, promise: null }; active = operation; phase = name; error = null; report();
    operation.promise = Promise.resolve().then(() => work(current)).then(result => { if (phase === name) phase = 'derived-branch-prepared'; return result; }).catch(failure => { error = String(failure.message).slice(0, 512); phase = 'previous-derived-branch-retained'; throw failure; }).finally(() => { if (active === operation) active = null; report(); }); return operation.promise;
  };
  const clear = async () => { cancel(); await active?.promise.catch(() => {}); if (unknown.size) throw fail('A derived branch has unresolved retirement.'); const receipt = disposeBundle(current); if (receipt) { await receipt.completion; if (receipt.outcome !== 'complete') { unknown.add({ current, receipt }); throw fail('The candidate branch has unresolved retirement.'); } } current = null; phase = 'frozen-material-kept'; report(); };
  return Object.freeze({ prepare, cancel, clear, state, candidate: () => current?.asset || null,
    audition: options => action('auditioning-derived-branch', bundle => bundle.instrument.audition(options)), install: () => action('saving-derived-branch', bundle => bundle.instrument.install()),
    apply: () => action('applying-derived-branch', async bundle => { if (identity() !== bundle.target) throw fail('The selected target changed; prepare a new branch before applying.'); const result = await bundle.instrument.apply(); phase = 'derived-branch-applied'; return result; }),
    stop() { cancel(); current?.instrument.stop(); },
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; return retirement.retire([{ name: 'derived-branch-owner', run: clear }]); }
  });
}
