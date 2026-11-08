export const singleSampleMap = (assetHash, { frames = 64, id = 'fixture-map' } = {}) => ({ schema: 'lemmings-sample-instrument-map/v1', mapId: id, revision: 1,
  articulations: [{ id: 'center', name: 'Center' }], neutralArticulationId: 'center',
  selectionPolicy: { algorithmVersion: 'stable-semantic-onset-fnv32-v1', seed: 42, advanceOn: 'semantic-onset', unknownArticulation: 'neutral', rootSelection: 'nearest-lower-tie' },
  releasePolicy: 'owned-end', normalizationRef: null, rightsRef: 'fixture-pack-rights', zones: [{ id: 'center-0', articulationId: 'center', roundRobinGroup: 'center', alternateIndex: 0,
    velocityMin01: 0, velocityMax01: 1, assetHash, onsetFrame: 0, endFrame: frames, rootCents: 6000, gain01: 0.8, tuningCents: 0,
    pitchRange: { minCents: 5400, maxCents: 6600, maxTransposeCents: 600 }, loop: null, releaseRegion: null, chokeGroup: 'kit' }] });
