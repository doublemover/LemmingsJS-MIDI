import { freezeData } from '../../core/CanonicalData.js';

const axis = (id, name, unit, mappings) => ({ id, name, unit, minimum: -1, maximum: 1, default: 0, mappings });
const octave = (parameter, span, unit) => ({ parameter, mode: 'octaves', span, unit });
const offset = (parameter, span, unit) => ({ parameter, mode: 'offset', span, unit });
const neighborhood = (id, name, engineId, axes, constraints = []) => ({ id, version: 1, name, engineId, engineVersion: 1,
  amount: { name: 'Variation amount', unit: 'normalized', minimum: 0, maximum: 1, default: 0.5, semantics: 'Scale both requested coordinates and a bounded quarter-axis seeded offset.' },
  axes, constraints, qualityRequirements: ['exact-engine-artifact', 'resource-admission', 'finite-reference-render', 'non-silent-reference-gesture'],
  qualification: 'authored-proposal-awaiting-listening-review' });

export const AUTHORED_PATCH_NEIGHBORHOODS = freezeData([
  neighborhood('forge.glass', 'FM Forge', 'native-fm', [
    axis('glass-size', 'Glass size', 'octaves', [octave('modulatorRatio', -0.35, 'ratio'), octave('indexSeconds', 0.45, 's')]),
    axis('hammer-hardness', 'Hammer hardness', 'normalized', [octave('indexStart', 0.65, 'dimensionless'), octave('indexEnd', 0.65, 'dimensionless'), octave('attackSeconds', -0.7, 's')])
  ], [{ kind: 'preserve-order', first: 'indexStart', second: 'indexEnd' }]),
  neighborhood('material.body', 'Modal materials', 'native-modal', [
    axis('body-size', 'Body size', 'octaves', [octave('bodySizeRatio', 0.35, 'ratio'), octave('bodyT60Seconds', 0.55, 's')]),
    axis('strike-hardness', 'Strike hardness', 'normalized', [offset('strikePosition01', 0.2, 'normalized'), octave('attackSeconds', -0.7, 's')])
  ]),
  neighborhood('pluck.material', 'Plucked strings', 'worklet-pluck', [
    axis('string-body', 'String body', 'octaves', [octave('stringT60Seconds', 0.65, 's'), octave('bodyT60Seconds', 0.4, 's')]),
    axis('pick-material', 'Pick material', 'normalized', [offset('excitationBrightness01', 0.3, 'normalized'), offset('damping01', -0.2, 'normalized'), offset('pluckPosition01', -0.08, 'normalized')])
  ]),
  neighborhood('circuit.voice', 'Circuit Workshop voice', 'worklet-sample', [
    axis('circuit-age', 'Circuit age', 'normalized', [octave('sampleLowpassHz', -0.6, 'Hz'), octave('releaseSeconds', 0.25, 's')]),
    axis('circuit-snap', 'Circuit snap', 'normalized', [offset('sampleVelocityTone01', 0.2, 'normalized'), octave('attackSeconds', -0.75, 's')])
  ]),
  neighborhood('wind.body', 'Wind and graft body', 'worklet-wind', [
    axis('tube-size', 'Tube size', 'octaves', [octave('acousticLengthRatio', 0.18, 'ratio'), octave('releaseSeconds', 0.3, 's')]),
    axis('air-edge', 'Air edge', 'normalized', [offset('breathLeak01', 0.2, 'normalized'), offset('bite01', 0.08, 'normalized')])
  ])
]);

export const findPatchNeighborhood = (engineId, neighborhoodId = null) => AUTHORED_PATCH_NEIGHBORHOODS.find(entry =>
  entry.engineId === engineId && (neighborhoodId === null || entry.id === neighborhoodId)) || null;
