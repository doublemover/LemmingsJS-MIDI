import { canonicalDataText, freezeData, hashDataText } from '../../core/CanonicalData.js';

export const SOUND_SEED_RECIPE_REVISION = 'frozen-seed-recipes-v1';
export const SOUND_SEED_TRANSFORMS = Object.freeze(['hammer-seed', 'ice-dust', 'route-relic']);
const fail = message => { throw new TypeError('Sound seed recipe: ' + message); };
const quantity = (value, unit) => ({ value, unit });
const component = (id, values) => ({ id, role: id, parameters: Object.fromEntries(Object.entries(values).map(([key, [value, unit]]) => [key, quantity(value, unit)])) });
const macro = (id, name, parameter, minimum, maximum, unit, default01 = 0.5) => ({ id, name, mode: 'onset-only', default01, smoothingMs: 0,
  perceptualDirection: name + ' increases for new owned voices; existing voices retain their onset settings.',
  targets: [{ parameter, minimum: quantity(minimum, unit), maximum: quantity(maximum, unit), curve: 'linear', composition: 'replace', clamp: true }] });

// Raw parent takes are regeneration evidence, never required playback assets.
export async function createSoundSeedRecipe({ manifest, assetHash, byteLength, transform = 'hammer-seed', pitch = { mode: 'unpitched' } } = {}) {
  if (manifest?.schema !== 'lemmings-sound-seed/v1' || !/^[a-f0-9]{64}$/.test(assetHash) || !Number.isSafeInteger(byteLength) || byteLength < 64 || byteLength > 16 * 1048576 ||
      !Number.isSafeInteger(manifest.frames) || manifest.frames < 2 || manifest.frames * 8 > 15 * 1048576 || !Number.isSafeInteger(manifest.sampleRate) || manifest.sampleRate < 8000 || manifest.sampleRate > 192000 ||
      !Array.isArray(manifest.ancestry) || !manifest.ancestry.length || manifest.ancestry.length > 16 || manifest.coverage?.status !== 'known-material' ||
      !SOUND_SEED_TRANSFORMS.includes(transform) || !pitch || !['pitched', 'unpitched'].includes(pitch.mode) || Object.keys(pitch).some(key => !['mode', 'rootCents'].includes(key))) fail('Select a complete frozen material region and a supported transform. Missing/unknown source coverage cannot become playable verified material.');
  if (pitch.mode === 'pitched' ? !Number.isFinite(pitch.rootCents) || pitch.rootCents < 2400 || pitch.rootCents > 9600 : pitch.rootCents != null) fail('Declare an editable root pitch or Unpitched without a fictional root.');
  if (transform === 'ice-dust' && pitch.mode === 'unpitched') fail('Ice dust currently requires a declared root pitch for its varispeed granular renderer. Unpitched material remains available to the sampler recipes.');
  const duration = manifest.frames / manifest.sampleRate, warnings = [];
  if (manifest.statistics?.silence) warnings.push('Selected PCM is silent.');
  if (manifest.statistics?.clippedSamples) warnings.push('Selected PCM contains clipping; no normalization or repair was applied.');
  if (transform === 'hammer-seed' && duration > 0.5) warnings.push('This selection is longer than a short contact body. Trim explicitly to shorten it.');
  if (transform === 'ice-dust' && (duration < 0.4 || duration > 1.5)) warnings.push('This tail is outside the suggested 400–1500 ms starting range.');
  if (manifest.bakedEffects !== 'none-declared') warnings.push('Original effects are printed into this PCM. This recipe adds no creative effect graph; review the destination lane sends before applying.');
  const contract = freezeData({ schema: 'lemmings-sound-seed-recipe/v1', algorithmRevision: SOUND_SEED_RECIPE_REVISION, assetHash, frames: manifest.frames, sampleRate: manifest.sampleRate,
    parentAssetHash: manifest.ancestry.at(-1).completeParentArtifactHash, sourceTakeRefs: manifest.ancestry.map(entry => ({ takeId: entry.takeId, revision: entry.takeRevision, manifestHash: entry.parentManifestHash, immutableSourceRef: entry.immutableSourceRef })),
    regionFrames: [0, manifest.frames], transform, pitchDeclaration: pitch, printedEffects: manifest.bakedEffects, ancestry: manifest.ancestry, coverage: manifest.coverage,
    loop: 'disabled', newOnsets: 'new-actor-owns-playback;old-events-are-baked-ancestry-only', regeneration: 'requires-separately-retained-original-source', rightsClosure: 'retained-origin-annotations;redistribution-not-asserted', warnings });
  const encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text), suffix = contractHash.slice(0, 24), recipeId = 'seed.' + suffix;
  const rights = kind => ({ kind, creator: 'Local sound-seed author', sourceUrl: 'urn:lemmings:sound-seed:' + assetHash, licenseId: 'NOASSERTION', licenseUrl: null,
    attribution: 'Frozen local material. Original provenance is embedded in its WAV and seed recipe.', modifications: [SOUND_SEED_RECIPE_REVISION + '; ' + transform], declaredUse: 'unknown' });
  const granular = transform === 'ice-dust', root = pitch.mode === 'pitched' ? pitch.rootCents : 6900;
  const recipe = { id: recipeId, revision: 1, name: { 'hammer-seed': 'Hammer seed', 'ice-dust': 'Ice dust', 'route-relic': 'Route relic · recorded phrase' }[transform], author: 'Local sound-seed author',
    tags: ['sound-seed', transform, 'baked-ancestry', pitch.mode], engine: { id: granular ? 'worklet-granular' : 'worklet-sample', version: 1 }, rights: rights('patch-recipe'),
    sampleRefs: [{ id: 'seed-material', sha256: assetHash, bytes: byteLength, required: true }], dependencies: [assetHash, contractHash], voicePolicy: { maxVoices: 2, steal: 'reject' }, mix: { gain01: 0.7, pan01: 0 },
    components: [component('envelope', { attackSeconds: [granular ? 0.01 : 0.003, 's'], decaySeconds: [0, 's'], sustain01: [1, 'ratio'], releaseSeconds: [granular ? 0.15 : 0.04, 's'] }), component('output', { gain01: [0.6, 'amplitude-linear'], pan01: [0, 'normalized'] })], macros: [] };
  if (granular) {
    recipe.components.push(component('exciter', { pitchRatio: [1, 'ratio'], regionStart01: [0, 'normalized'], regionEnd01: [1, 'normalized'], motionRequired: [0, 'enum'], reverse: [0, 'enum'], rootHz: [440 * 2 ** ((root - 6900) / 1200), 'Hz'] }),
      component('resonator', { position01: [0.5, 'normalized'], densityHz: [16, 'Hz'], grainMilliseconds: [65, 'ms'], spread01: [0.15, 'normalized'], activity01: [1, 'normalized'], tone01: [0.65, 'normalized'], freezePosition: [0, 'enum'] }));
    recipe.causalBindings = [{ id: 'observed-travel-position', sourceKind: 'MotionCommitted', payloadField: 'positionXWorldPixels', target: 'position01', unit: 'world-pixel', inputMin: 0, inputMax: 1024, outputMin: 0.05, outputMax: 0.95, outputUnit: 'normalized', curve: 'linear', composition: 'replace', mode: 'continuous', smoothingMs: 10 }];
    recipe.macros = [macro('seed-position', 'SEED POSITION', 'position01', 0.05, 0.95, 'normalized'), macro('body', 'BODY', 'densityHz', 8, 24, 'Hz'),
      macro('grain-edge', 'GRAIN / EDGE', 'grainMilliseconds', 40, 90, 'ms'), macro('damp', 'DAMP', 'tone01', 0.9, 0.2, 'normalized')];
  } else {
    recipe.components.push(component('exciter', { sampleLowpassHz: [transform === 'hammer-seed' ? 9000 : 20000, 'Hz'], sampleVelocityTone01: [transform === 'hammer-seed' ? 0.8 : 0, 'normalized'] }));
    recipe.macros = [macro('body', 'BODY', 'releaseSeconds', 0.02, 0.3, 's'), macro('grain-edge', 'EDGE', 'attackSeconds', 0.001, 0.04, 's'), macro('damp', 'DAMP', 'sampleLowpassHz', 14000, 250, 'Hz')];
    recipe.sampleMap = { schema: 'lemmings-sample-instrument-map/v1', rendererProfile: 'owned-sample-v1', mapId: recipeId + '.map', revision: 1,
      articulations: [{ id: 'contact', name: 'New contact' }], neutralArticulationId: 'contact', selectionPolicy: { algorithmVersion: 'stable-semantic-onset-fnv32-v1', seed: 0, advanceOn: 'semantic-onset', unknownArticulation: 'neutral', rootSelection: 'nearest-lower-tie' },
      releasePolicy: 'owned-end', normalizationRef: null, rightsRef: 'embedded-source-ancestry', zones: [{ id: 'seed', articulationId: 'contact', roundRobinGroup: 'seed', alternateIndex: 0, velocityMin01: 0, velocityMax01: 1,
        assetHash, onsetFrame: 0, endFrame: manifest.frames, rootCents: root, gain01: 0.8, tuningCents: 0, pitchTracking: pitch.mode === 'unpitched' ? 'fixed' : 'varispeed',
        pitchRange: pitch.mode === 'unpitched' ? { minCents: 0, maxCents: 12700, maxTransposeCents: 0 } : { minCents: root - 2400, maxCents: root + 2400, maxTransposeCents: 2400 },
        playbackMode: 'forward', loop: null, releaseRegion: null, chokeGroup: null }] };
  }
  return freezeData({ contract, contractHash, contractText: encoded.text, source: { schema: 'lemmings-sound-recipes/v1',
    pack: { id: recipeId, version: '1.0.0', name: recipe.name, author: recipe.author, sourceUrl: 'urn:lemmings:sound-seed:' + assetHash, licenseId: 'NOASSERTION', licenseUrl: null,
      attribution: 'Immutable local frozen sound with separate baked ancestry.', modifications: [], redistributionPolicy: 'unknown', licenses: [] },
    files: [{ path: 'seed/material.wav', sha256: assetHash, bytes: byteLength, kind: 'sample', mediaType: 'audio/wav', parents: [], rights: rights('sample-recording') },
      { path: 'seed/recipe.json', sha256: contractHash, bytes: encoded.bytes.length, kind: 'generated-data', mediaType: 'application/json', parents: [], rights: rights('derived-data') }], recipes: [recipe] } });
}
