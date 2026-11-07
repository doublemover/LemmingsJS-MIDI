import { validateAcousticMap } from './AcousticMap.js';

export function createOriginalAcousticMap({ id = 'world-acoustics', revision = 1, listener = { x: 256, y: 144 }, zones = [] } = {}) {
  const materialResponses = [
    ['felt', 'material.timber', 'felt-pocket', [[20, 1], [2400, Math.SQRT1_2], [20000, 0.05]]],
    ['glass', 'material.glass', 'glass-arcade', [[20, 1], [8000, Math.SQRT1_2], [20000, 0.2]]],
    ['pipe', 'material.sheet-metal', 'pipe-corridor', [[20, 1], [5000, Math.SQRT1_2], [20000, 0.1]]],
    ['clearing', 'material.unclassified', 'open-clearing', [[20, 1], [20000, 1]]]
  ].map(([id, patch, recipe, curve]) => ({ id, exciterPatch: patch, resonatorPatch: patch, contactVariants: { hard: 'hard', soft: 'soft', muted: 'muted' }, absorptionCurve: curve.map(([frequencyHz, gain01]) => ({ frequencyHz, gain01 })), effectRecipe: { id: recipe, revision: 1 } }));
  return validateAcousticMap({ schema: 'lemmings-acoustic-map/v1', id, revision, zones, materialResponses, listener: { mode: 'fixed-world', position: listener, removedPolicy: 'hold-last', panMode: 'equal-power-stereo', panWidthPixels: 256, referenceDistancePixels: 128, rolloff: 0.35, minimumGain01: 0.25, coordinateScale: 'world-pixels' },
    controls: { materialResponseId: null, absorb01: 0.35, chamber01: 1, borderPixels: null }, controlRateHz: 20, maximumVoices: 128,
    occlusion: { enabled: false, maximumSamples: 16, cellPixels: 16, minimumGain01: 0.5, closedLowpassHz: 1400 }, stalePolicy: 'hold-then-fade' });
}
export function createOriginalAcousticZone({ zoneId, materialResponseId = 'felt', worldRegion, priority = 0, transitionDistancePixels = 16, revision = 1 } = {}) {
  return { zoneId, revision, worldRegion, priority, materialResponseId, receiverGroup: 'world-listener', zoneSends: materialResponseId === 'clearing' ? [] : [{ returnId: materialResponseId, amount01: materialResponseId === 'glass' ? 0.16 : materialResponseId === 'pipe' ? 0.2 : 0.12 }], transitionDistancePixels, tailPolicy: 'retain-onset-return', enabled: true };
}
