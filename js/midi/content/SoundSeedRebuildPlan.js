import { validateSealedFrictionBodyTravelBinding } from './SealedBodyGraftRecipe.js';
import { validateTextureBodyTravelBinding } from './TextureBodyGraftRecipe.js';
import { validateSampleTraversalBinding } from './SampleTraversal.js';
import { canonicalDataText, freezeData, hashData } from '../../core/CanonicalData.js';

export const SOUND_SEED_REBUILD_REVISION = 'explicit-frozen-seed-branch-components-v2';
const integer = (value, low, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = message => { throw new TypeError('Seed rebuild: ' + message); };

export async function planSoundSeedRebuild({ seed, replacement, components = null, composition = null, modal = null, selectedMaterial = 'original', transform = 'hammer-seed', graftBody = 'tin', textureKind = 'sand-drag', traversalBinding = null, pitch = { mode: 'unpitched' } } = {}) {
  const metadata = seed?.metadata?.(), original = seed?.manifest, next = replacement?.manifest, replacementMetadata = replacement?.artifact?.metadata?.();
  if (!metadata?.assetReady || original?.schema !== 'lemmings-sound-seed/v1' || !hash(metadata.assetHash) || !Array.isArray(original.ancestry) || !original.ancestry.length || original.ancestry.length > 16 ||
      !['original', 'transient-like', 'sustained-like', 'residual', 'neutral-recombined', 'component-composition', 'modal-reconstruction', 'modal-residual'].includes(selectedMaterial) ||
      !['hammer-seed', 'ice-dust', 'route-relic', 'modal-body', 'finite-fm-body-graft', 'feedforward-graft', 'motion-body-graft', 'texture-body-graft', 'sealed-wind-body-graft', 'sealed-friction-body-graft'].includes(transform)) fail('Select one frozen seed and its exact supported derived closure.');
  const parent = original.ancestry.at(-1), blockers = [];
  if (!replacementMetadata?.retained || next?.schema !== 'lemmings-causal-audio-render/v1') blockers.push({ node: 'source', state: 'missing-prerequisite', reason: 'A retained causal revoice file is required; captured master PCM is not an exact intent-render source.' });
  if (parent.originKind !== 'OFFLINE REVOICE' || !parent.takeId || !integer(parent.takeRevision, 1) || !hash(parent.sourceCanonicalHash)) blockers.push({ node: 'source', state: 'unknown', reason: 'The frozen origin does not bind an exact original take/revision and covered semantic hash. Keep recorded material, or explicitly harvest a new source.' });
  if (!hash(parent.sourcePatchReceipt?.definitionHash) || !hash(parent.sourcePatchReceipt?.engineRequirement?.artifactHash) || !hash(parent.sourcePatchReceipt?.engineRequirement?.parameterSchemaHash)) blockers.push({ node: 'source', state: 'unknown', reason: 'The original frozen lineage lacks its exact resolved patch receipt. Frozen playback remains available.' });
  if (next) {
    if (next.takeId !== parent.takeId || next.takeRevision !== parent.takeRevision || next.sourceCanonicalHash !== parent.sourceCanonicalHash) blockers.push({ node: 'source', state: 'unsupported-realization', reason: 'The replacement does not revoice the same immutable semantic take. Reinterpretation or reperformance requires its own branch and coverage preflight.' });
    if (next.sampleRate !== parent.parentSampleRate || next.timelineZeroSourceFrame !== parent.parentTimelineOriginFrame || next.tap !== parent.sourceTap) blockers.push({ node: 'region', state: 'unsupported-realization', reason: 'Source rate, timeline origin or selected tap changed. Prepare matching coordinates or explicitly harvest an adjusted region.' });
    if (!integer(next.frames, 1) || !integer(parent.firstFrame, 0) || !integer(parent.endFrame, parent.firstFrame + 1, next.frames)) blockers.push({ node: 'region', state: 'missing-prerequisite', reason: 'The new tail does not cover the complete selected parent interval. No implicit crop, extension or silence repair is allowed.' });
    if (!hash(next.definitionHash) || !hash(next.engineRequirement?.artifactHash) || !hash(next.engineRequirement?.parameterSchemaHash)) blockers.push({ node: 'source', state: 'unknown', reason: 'The replacement lacks its exact resolved patch/engine receipt.' });
  }
  if (original.coverage?.status !== 'known-material' || original.coverage.gaps?.length) blockers.push({ node: 'region', state: 'missing-prerequisite', reason: 'The original seed has missing or unknown coverage; frozen playback and regeneration are separate facts.' });
  const modalNeeded = selectedMaterial.startsWith('modal-') || transform === 'modal-body' || ['finite-fm-body-graft', 'feedforward-graft', 'motion-body-graft', 'texture-body-graft', 'sealed-wind-body-graft', 'sealed-friction-body-graft'].includes(transform) && graftBody === 'fitted';
  const componentKinds = ['transient-like', 'sustained-like', 'residual', 'neutral-recombined'];
  const compositionHash = composition?.components?.find(entry => entry.kind === 'component-composition')?.assetHash;
  let modalParentMaterial = 'original';
  if (transform === 'modal-body' && selectedMaterial.startsWith('modal-')) blockers.push({ node: 'patch', state: 'unsupported-realization', reason: 'A new modal body consumes its fitted parent, not an already rendered reconstruction/residual.' });
  if (modalNeeded) {
    if (!modal || modal.recipe?.algorithmRevision !== 'coarse-local-stereo-decay-fit-v1') blockers.push({ node: 'modal', state: 'missing-prerequisite', reason: 'The fitted body lacks its matching analysis recipe.' });
    else if (modal.parentAssetHash !== metadata.assetHash) {
      const component = compositionHash === modal.parentAssetHash ? { kind: 'component-composition' } : components?.recombinedAssetHash === modal.parentAssetHash ? { kind: 'neutral-recombined' } : components?.components?.find(entry => entry.assetHash === modal.parentAssetHash);
      if (!component) blockers.push({ node: 'modal', state: 'missing-prerequisite', reason: 'The fitted parent component is absent from this selected closure.' }); else modalParentMaterial = component.kind;
    }
  }
  const compositionNeeded = selectedMaterial === 'component-composition' || modalNeeded && modalParentMaterial === 'component-composition';
  const componentNeeded = compositionNeeded || componentKinds.includes(selectedMaterial) || modalNeeded && componentKinds.includes(modalParentMaterial);
  if (componentNeeded && (!components || components.parentAssetHash !== metadata.assetHash || components.recipe?.algorithmRevision !== 'linked-stereo-median-masks-v1')) blockers.push({ node: 'components', state: 'missing-prerequisite', reason: 'The selected component lacks a matching parent/algorithm recipe.' });
  if (compositionNeeded) {
    const recipe = composition?.recipe;
    if (!hash(compositionHash) || composition.parentAssetHash !== metadata.assetHash || recipe?.algorithmRevision !== 'aligned-printed-component-branches-v1' || recipe.decompositionRevision !== components?.recipe?.algorithmRevision || !components || recipe.decompositionRecipeHash !== await hashData(components.recipe, { maxBytes: 262144, maxNodes: 32768 }) ||
        componentKinds.slice(0, 3).some(kind => recipe.componentAssetHashes?.[kind] !== components?.components?.find(entry => entry.kind === kind)?.assetHash)) blockers.push({ node: 'composition', state: 'missing-prerequisite', reason: 'The printed composition lacks its exact original and three decomposition parents.' });
  }
  if (!componentNeeded) components = null; if (!compositionNeeded) composition = null; if (!modalNeeded) modal = null;
  const materialNode = material => material === 'original' ? 'region' : material === 'component-composition' ? 'composition' : material.startsWith('modal-') ? 'modal' : 'components';
  const frames = original.frames, nodes = [
    { id: 'source', kind: 'causal-revoice-file', parents: [], oldHash: parent.completeParentArtifactHash, newSourceRef: replacementMetadata?.immutableSourceRef ?? null },
    { id: 'region', kind: 'frozen-seed-window', parents: ['source'], oldHash: metadata.assetHash },
    ...(componentNeeded ? [{ id: 'components', kind: 'linked-stereo-components', parents: ['region'], oldHash: null }] : []),
    ...(compositionNeeded ? [{ id: 'composition', kind: 'printed-component-composition', parents: ['region', 'components'], oldHash: compositionHash }] : []),
    ...(modalNeeded ? [{ id: 'modal', kind: 'modal-estimate', parents: [materialNode(modalParentMaterial)], oldHash: null }] : []),
    { id: 'patch', kind: transform, parents: [...new Set(transform === 'modal-body' ? ['modal'] : [materialNode(selectedMaterial), ...(modalNeeded ? ['modal'] : [])])], oldHash: null }
  ];
  if (!integer(frames, 2, 8 * 192000) || frames * 8 > 15 * 1048576 || (componentNeeded || modalNeeded) && (frames > original.sampleRate * 8 || frames * 8 > 4 * 1048576)) blockers.push({ node: 'region', state: 'unsupported-realization', reason: 'The chosen closure exceeds the admitted frame/PCM limits.' });
  const cycle = new Set(), visited = new Set(), byId = new Map(nodes.map(node => [node.id, node]));
  const visit = (id, depth = 0) => { if (cycle.has(id) || depth > 16 || nodes.length > 128) fail('Cyclic or oversized derived closure.'); if (visited.has(id)) return;
    const node = byId.get(id); if (!node) fail('Missing node inside the selected closure.'); cycle.add(id); for (const parentId of node.parents) visit(parentId, depth + 1); cycle.delete(id); visited.add(id); };
  visit('patch');
  const componentOptions = components ? { fftSize: components.recipe.fftSize, temporalWidth: components.recipe.medianWidths.temporalFrames, frequencyWidth: components.recipe.medianWidths.frequencyBins,
    sustainedMargin: components.recipe.maskMargins.sustained, transientMargin: components.recipe.maskMargins.transient } : null;
  const modalOptions = modal ? { observationFrames: modal.recipe.observationFrames, fftSize: modal.recipe.fftSize, maxModes: modal.recipe.maxModes, minimumHz: modal.recipe.frequencyRange[0], maximumHz: modal.recipe.frequencyRange[1],
    minimumT60: modal.recipe.amplitudeT60Range[0], maximumT60: modal.recipe.amplitudeT60Range[1], manualModes: modal.recipe.manualModes, pinnedModes: modal.recipe.pinnedModes || [] } : null;
  const plan = { schema: 'lemmings-sound-seed-rebuild-plan/v1', algorithmRevision: SOUND_SEED_REBUILD_REVISION, operation: 'sound-only-revoice-selected-derived-branch', originalAssetHash: metadata.assetHash,
    sourceTake: { takeId: parent.takeId ?? null, revision: parent.takeRevision ?? null, canonicalHash: parent.sourceCanonicalHash ?? null }, oldPatchReceipt: parent.sourcePatchReceipt ?? null,
    newPatchReceipt: next ? { definitionHash: next.definitionHash ?? null, engineRequirement: next.engineRequirement ?? null } : null,
    sourceProfile: 'new-render-all-covered-intents;not-original-live-admission-PCM', sourceTap: parent.sourceTap, sampleRate: parent.parentSampleRate, channelLayout: 'stereo',
    parentRegionFrames: [parent.firstFrame, parent.endFrame], expectedRegionFrames: frames, fades: original.fades, componentOptions, compositionOptions: composition?.recipe.options ?? null, compositionInputs: composition ? { originalAssetHash: composition.parentAssetHash, componentAssetHashes: composition.recipe.componentAssetHashes, decompositionRecipeHash: composition.recipe.decompositionRecipeHash } : null, modalOptions, modalParentMaterial, selectedMaterial, transform, graftBody, ...(transform === 'texture-body-graft' ? { textureKind } : {}), traversalBinding: transform === 'sealed-friction-body-graft' ? validateSealedFrictionBodyTravelBinding(traversalBinding) : transform === 'texture-body-graft' ? validateTextureBodyTravelBinding(traversalBinding) : transform === 'motion-body-graft' ? validateSampleTraversalBinding(traversalBinding) : null, pitch,
    nodes: nodes.map(node => ({ ...node, state: blockers.find(blocker => blocker.node === node.id)?.state ?? (blockers.length ? 'blocked-by-prerequisite' : 'rebuildable') })), blockers,
    frozenOriginal: { playable: true, sourceAssetAvailable: !!seed.artifact.metadata().retained, projectReferences: 'preserved', deletion: 'never-part-of-rebuild' },
    determinism: 'unqualified-numerical-build;recipe-and-resolved-patch-inputs-hashed;no-cross-build-byte-equivalence-claim', maxNodes: 128, maxDepth: 16, boundedFrames: frames * nodes.length,
    state: blockers.length ? 'unavailable' : 'rebuildable' };
  canonicalDataText(plan, { maxBytes: 262144, maxNodes: 32768 }); const planHash = await hashData(plan, { maxBytes: 262144, maxNodes: 32768 }); return freezeData({ ...plan, planHash });
}
