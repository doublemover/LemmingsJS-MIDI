import { validateAcousticMaterialSelection } from '../../midi/content/AcousticMaterialSelection.js';
import { verifyMaterialPalette } from '../../midi/content/MaterialPalette.js';
import { validateObservedMaterialResponse } from '../../midi/content/MaterialResponseMap.js';
import { canonicalDataText, hashData, freezeData } from '../../core/CanonicalData.js';

const fail = message => { throw Object.assign(new Error(message), { code: 'captured-material-readout' }); };
export async function prepareCapturedMaterialReadout(revoice, descriptor, { signal, allowUnmapped = false } = {}) {
  const source = revoice.materialSources;
  if (!source && allowUnmapped) return Object.freeze({ allowUnmapped, variants: new Map(), resolve: () => null, receipt: null });
  if (!source || Object.getPrototypeOf(source) !== Object.prototype || source.schema !== 'lemmings-captured-material-sources/v1' || source.covered !== true || Object.keys(source).some(key => !['schema', 'covered', 'palettes', 'onsets'].includes(key)) || !Array.isArray(source.palettes) || !source.palettes.length || source.palettes.length > 3 || !Array.isArray(source.onsets) || source.onsets.length > 8192 || descriptor.engineId !== 'native-modal') fail('This take needs complete captured material palettes and covered contact onsets.');
  canonicalDataText(source, { maxBytes: 2 * 1048576, maxNodes: 262144 });
  const palettes = new Map(), variants = new Map(), onsets = new Map();
  for (const raw of source.palettes) {
    const palette = await verifyMaterialPalette(raw, { descriptors: [descriptor], signal });
    if (palettes.has(palette.identityHash)) fail('Captured material palettes must have unique immutable identities.');
    palettes.set(palette.identityHash, palette);
    for (const reference of palette.references) {
      if (reference.definition.causalBindings.some(binding => binding.mode === 'continuous')) fail('Captured modal palettes use onset-only material controls.');
      const key = palette.identityHash + ':' + reference.patchId;
      variants.set(key, { key, patch: reference.definition, definitionHash: reference.definitionHash, paletteHash: palette.identityHash });
    }
  }
  for (const row of source.onsets) {
    if (!row || Object.getPrototypeOf(row) !== Object.prototype || Object.keys(row).some(key => !['intentId', 'paletteHash'].includes(key)) || typeof row.intentId !== 'string' || !row.intentId || row.intentId.length > 512 || !palettes.has(row.paletteHash) || onsets.has(row.intentId)) fail('Captured material onset bindings are missing or ambiguous.');
    onsets.set(row.intentId, row.paletteHash);
  }
  const selected = new Map(), counts = new Map(), actualBegins = new Set();
  for (const intent of revoice.intents) {
    if (intent.kind !== 'begin') continue; actualBegins.add(intent.intentId);
    const material = intent.acousticMaterialState ? validateAcousticMaterialSelection(intent.acousticMaterialState, { intent }) : intent.materialState ? validateObservedMaterialResponse(intent.materialState) : null;
    if (!material && allowUnmapped) continue;
    if (!material) fail('Choose a fully captured material-only take, or the explicit spatial/material readout for mixed sources.');
    const paletteHash = onsets.get(intent.intentId), variant = variants.get(paletteHash + ':' + material.patchId);
    if (!variant || material.worldId !== intent.worldId || material.generation !== intent.generation || material.actorId !== intent.actorId || !intent.sourceEventIds?.includes(material.sourceEventId)) fail('Choose a fully captured material-only take; every contact must retain its original palette, body and cause.');
    selected.set(intent.intentId, variant); counts.set(material.patchId, (counts.get(material.patchId) || 0) + 1);
  }
  if (!allowUnmapped && selected.size !== onsets.size || [...onsets.keys()].some(id => !actualBegins.has(id))) fail('Captured material source bindings contain missing or repeated onsets.');
  signal?.throwIfAborted();
  return Object.freeze({ allowUnmapped: allowUnmapped && selected.size < actualBegins.size, variants, resolve: intent => selected.get(intent.intentId), receipt: freezeData({ schema: 'lemmings-captured-material-readout/v1', sourceHash: await hashData(source, { maxBytes: 2 * 1048576, maxNodes: 262144 }),
    palettes: [...palettes.values()].map(palette => ({ identityHash: palette.identityHash, sourcePackHash: palette.sourcePackHash, definitions: palette.references.map(reference => ({ patchId: reference.patchId, definitionHash: reference.definitionHash })) })),
    bodyOnsets: Object.fromEntries(counts), controls: 'captured-per-onset-controls-and-actor-identity', heldBody: 'original-onset-body-through-all-updates-and-lane-transfers', liveAdmissionHistoryRecreated: false, exactNativeStateExport: false }) });
}
