import { canonicalDataText, hashData } from '../../core/CanonicalData.js';
import { createTimbreTuningRecipe, stampTimbreTuningSet } from './TimbreTuningSet.js';

export async function createTimbreTuningFromModalFit({ fit, modeIds = [], referenceHz, selectionRevision = 1 } = {}) {
  canonicalDataText(fit, { maxBytes: 2 * 1048576, maxNodes: 131072 });
  if (fit?.schema !== 'lemmings-seed-modal-fit/v1' || fit.parentAssetHash !== fit.recipe?.parentAssetHash || await hashData(fit.recipe) !== fit.recipeHash ||
      fit.estimate?.schema !== 'lemmings-modal-estimate/v1' || !Array.isArray(fit.estimate.modes) || !Array.isArray(fit.components) ||
      !Number.isFinite(referenceHz) || referenceHz < 20 || referenceHz > 2000 || !Number.isSafeInteger(selectionRevision) || selectionRevision < 1 ||
      !Array.isArray(modeIds) || modeIds.length > 16 || new Set(modeIds).size !== modeIds.length || modeIds.some(id => !fit.estimate.modes.some(mode => mode.id === id))) throw new Error('Offer a current reviewed source fit, explicit selected modes and an independently declared20–2000Hz reference.');
  const selected = fit.estimate.modes.filter(mode => !modeIds.length || modeIds.includes(mode.id)), total = selected.reduce((sum, mode) => sum + mode.amplitude, 0),
    residualAssetHash = fit.components.find(component => component.kind === 'modal-residual')?.assetHash, reconstructionAssetHash = fit.components.find(component => component.kind === 'modal-reconstruction')?.assetHash;
  if (!selected.length || selected.length > 16 || !Number.isFinite(total) || total <= 1e-10 || !residualAssetHash || !reconstructionAssetHash ||
      selected.some(mode => !Number.isFinite(mode.amplitude) || mode.amplitude < 0 || !Number.isFinite(mode.frequencyHz) || mode.frequencyHz / referenceHz < 0.125 || mode.frequencyHz / referenceHz > 32 || !Number.isFinite(mode.t60Seconds) || mode.t60Seconds < 0.04 || mode.t60Seconds > 4)) throw new Error('The selected fit exceeds this sparse renderer ratio/T60 profile or lacks its actual original residual. Adjust the reviewed source fit explicitly; no modes are silently clipped.');
  const receipt = { referenceHz, gainNormalization: 'selected-mode-L1', sourceRate: fit.recipe.sourceRate, parentAssetHash: fit.parentAssetHash, recipeHash: fit.recipeHash, selectedModeIds: selected.map(mode => mode.id), selectedModes: selected,
      residualAssetHash, reconstructionAssetHash, reconstruction: fit.reconstruction, observationFrames: fit.estimate.spectrum.observationFrames, fftSize: fit.estimate.spectrum.fftSize, selectionRevision },
    receiptHash = await hashData(receipt, { maxBytes: 262144, maxNodes: 16384 }), fitRef = { id: 'seed-fit.' + fit.recipeHash.slice(0, 24), revision: selectionRevision, hash: receiptHash },
    baseline = await createTimbreTuningRecipe('harmonic', { referenceHz }), draft = JSON.parse(canonicalDataText(baseline).text);
  draft.id = 'fit-spectrum.' + receiptHash.slice(0, 24); draft.name = 'Reviewed fitted spectrum'; draft.revision = selectionRevision;
  draft.spectrumRef = { id: draft.id + '.spectrum', revision: selectionRevision }; draft.tuningRef = { id: draft.id + '.tuning', revision: 1 };
  draft.partialRatios = selected.map(mode => mode.frequencyHz / referenceHz); draft.partialGains = selected.map(mode => mode.amplitude / total); draft.partialT60Seconds = selected.map(mode => mode.t60Seconds);
  draft.partialProvenance = selected.map(mode => ({ kind: 'estimated', modeId: mode.id, confidence: mode.confidence?.level || 'unreported-confidence;not-inferred-certainty', pinned: mode.pinned === true, fitRef }));
  draft.fitSources = [{ fitRef, parentAssetHash: fit.parentAssetHash, recipeHash: fit.recipeHash, residualAssetHash, reconstructionAssetHash, receiptHash, receipt, selectionRevision,
    sourceRate: fit.recipe.sampleRate ?? fit.recipe.sourceRate, observationFrames: receipt.observationFrames, fftSize: receipt.fftSize, selectedModeIds: receipt.selectedModeIds,
    evidence: 'reviewed-damped-sinusoid-estimate;original-and-actual-residual-unchanged;new-sparse-excitation-not-original-phase-or-material' }];
  draft.coupledMorph.linked = false; draft.analysisReceipt = null;
  return stampTimbreTuningSet(draft);
}
