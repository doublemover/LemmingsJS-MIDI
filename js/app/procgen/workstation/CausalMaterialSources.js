import { createCausalPerformanceState } from './CausalPerformanceState.js';
import { freezeData } from '../../../core/CanonicalData.js';

export function captureCausalMaterialSources(records, initial, covered) {
  if (!initial) return null;
  const state = createCausalPerformanceState(initial), palettes = new Map(), onsets = [];
  for (const record of records) {
    if (record.kind === 'input-observation' && record.payload?.kind === 'instrument-performance') state.apply(record.payload.change);
    else if (record.kind === 'musical-intents') for (const intent of record.payload.intents) {
      if (intent.kind !== 'begin') continue;
      const lanes = state.snapshot().lanes, lane = typeof intent.laneId === 'number' ? lanes[intent.laneId] : lanes.find(lane => lane.id === intent.laneId), palette = lane?.materialPalette;
      if (!palette) continue;
      if (onsets.length >= 8192 || !palettes.has(palette.identityHash) && palettes.size >= 3) throw new Error('Captured material sources exceed the bounded palette/onset inventory.');
      palettes.set(palette.identityHash, palette); onsets.push({ intentId: intent.intentId, paletteHash: palette.identityHash });
    }
  }
  return onsets.length ? freezeData({ schema: 'lemmings-captured-material-sources/v1', covered: covered === true, palettes: [...palettes.values()], onsets }) : null;
}
