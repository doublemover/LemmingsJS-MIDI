import { CIRCUIT_WORKSHOP_REVISION, CIRCUIT_WORKSHOP_VARIANTS, CIRCUIT_WORKSHOP_VOICES } from '../../midi/content/CircuitWorkshopProfile.js';
import { validateDrumKitDefinition } from '../../midi/content/DrumKitDefinition.js';
import { compileSoundContent } from '../../midi/content/SoundContentCompiler.js';
import { canonicalDataText, freezeData, hashDataText } from '../../core/CanonicalData.js';

const RATE = 48000, TAU = 2 * Math.PI, LN1000 = Math.log(1000), fail = message => { throw new TypeError('Circuit Workshop: ' + message); };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const quantity = (value, unit) => ({ value, unit });
const component = (id, parameters) => ({ id, role: id, parameters });

function metalPartials(profile) {
  const partials = []; let sum = 0;
  for (const hz of [205, 369, 522, 800, 1068, 1569]) for (let harmonic = 1; harmonic <= 31 && hz * profile.frequencyScale * harmonic < RATE * 0.4; harmonic += 2) { const gain = 1 / harmonic; sum += gain; partials.push({ radians: TAU * hz * profile.frequencyScale * harmonic, gain }); }
  for (const partial of partials) partial.gain /= sum;
  return partials;
}

async function prepareStrike(spec, profile, ordinal, { check, yieldControl }) {
  const t60 = spec.t60 * profile.decayScale, clapLead = spec.kind === 'clap' ? 0.033 : 0, support = clapLead + t60 * 1.4 + 0.002, dryFrames = Math.ceil(support * RATE), roomFrames = Math.ceil((profile.roomTaps.at(-1)?.seconds || 0) * RATE), frames = dryFrames + roomFrames, values = new Float64Array(frames), partials = ['hat', 'crash'].includes(spec.kind) ? metalPartials(profile) : [];
  if (frames > RATE * 2) fail('The finite source exceeds its two-second profile.');
  let random = ((0x13579bdf ^ Math.imul(ordinal + 1, 0x9e3779b1)) >>> 0) || 1, phase = 0, noiseLow = 0, noiseBand = 0, metalLow = 0, metalBand = 0, color = 0;
  const highHz = spec.kind === 'snare' || spec.kind === 'clap' ? 900 : 5000, highAlpha = -Math.expm1(-TAU * highHz / RATE), bandAlpha = -Math.expm1(-TAU * 10000 / RATE), colorAlpha = -Math.expm1(-TAU * Math.min(profile.lowpassHz, RATE * 0.4) / RATE), hz = spec.hz * profile.frequencyScale;
  for (let first = 0; first < dryFrames; first += 4096) {
    check(); const end = Math.min(dryFrames, first + 4096);
    for (let frame = first; frame < end; frame++) {
      const t = frame / RATE; random ^= random << 13; random ^= random >>> 17; random ^= random << 5; const noise = (random >>> 0) / 2147483648 - 1; noiseLow += highAlpha * (noise - noiseLow); noiseBand += bandAlpha * (noise - noiseLow - noiseBand);
      let value = 0;
      if (spec.kind === 'kick') {
        const frequency = hz + (spec.startHz * profile.frequencyScale - hz) * Math.exp(-LN1000 * t / spec.settleSeconds); phase += TAU * frequency / RATE;
        value = 0.6 * profile.bodyScale * Math.sin(phase) * Math.exp(-LN1000 * t / t60) + (t < 0.002 ? noiseBand * 0.07 * profile.noiseScale * (1 - t / 0.002) : 0);
      } else if (spec.kind === 'snare') {
        value = profile.bodyScale * (0.2 * Math.sin(TAU * hz * t) * Math.exp(-LN1000 * t / (0.09 * t60 / 0.13)) + 0.12 * Math.sin(TAU * hz * 330 / 180 * t) * Math.exp(-LN1000 * t / (0.065 * t60 / 0.13))) + 0.18 * profile.noiseScale * noiseBand * Math.exp(-LN1000 * t / t60);
      } else if (spec.kind === 'rim') {
        value = (0.25 * Math.sin(TAU * hz * t) + 0.15 * Math.sin(TAU * hz * 1690 / 880 * t) + 0.05 * profile.noiseScale * noiseBand) * Math.exp(-LN1000 * t / t60);
      } else if (spec.kind === 'clap') {
        let envelope = t >= clapLead ? 0.12 * Math.exp(-LN1000 * (t - clapLead) / t60) : 0;
        for (let lobe = 0; lobe < 4; lobe++) { const local = t - lobe * 0.011; if (local >= 0 && local < 0.008) envelope += 0.2 * (1 - local / 0.008); }
        value = profile.noiseScale * noiseBand * envelope;
      } else if (spec.kind === 'tom') {
        phase += TAU * hz * (1 + (2 ** (4 / 12) - 1) * Math.exp(-LN1000 * t / 0.02)) / RATE;
        value = profile.bodyScale * (0.55 * Math.sin(phase) + 0.08 * Math.sin(phase * 1.59)) * Math.exp(-LN1000 * t / t60);
      } else {
        let metal = 0; for (const partial of partials) metal += partial.gain * Math.sin(partial.radians * t); metalLow += highAlpha * (metal - metalLow); metalBand += bandAlpha * (metal - metalLow - metalBand);
        value = (metalBand * (spec.kind === 'crash' ? 0.22 : 0.18) * profile.bodyScale + noiseBand * 0.1 * profile.noiseScale) * Math.exp(-LN1000 * t / t60);
      }
      color += colorAlpha * (value - color); values[frame] = color;
    }
    await yieldControl();
  }
  // Descending writes use only untouched dry samples: these are three finite
  // printed taps, never an accidental feedback room or another source onset.
  for (let frame = frames - 1; frame >= 0; frame--) for (const tap of profile.roomTaps) { const at = frame - Math.round(tap.seconds * RATE); if (at >= 0 && at < dryFrames) values[frame] += values[at] * tap.gain; }
  let weightedSum = 0, weights = 0;
  const edge = frame => Math.max(0, Math.min(1, frame / 24, (frames - 1 - frame) / 96));
  for (let frame = 0; frame < frames; frame++) { const weight = edge(frame); weightedSum += values[frame] * weight; weights += weight; } const mean = weightedSum / weights;
  const bytes = new Uint8Array(44 + frames * 2), view = new DataView(bytes.buffer), four = (offset, text) => { for (let index = 0; index < 4; index++) bytes[offset + index] = text.charCodeAt(index); };
  four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); four(36, 'data'); view.setUint32(40, frames * 2, true);
  let peak = 0, squares = 0, sum = 0, leadingZeroFrames = 0, nonzero = false;
  for (let frame = 0; frame < frames; frame++) { const value = (values[frame] - mean) * edge(frame); if (!Number.isFinite(value) || Math.abs(value) > 0.95) fail('A source exceeded its fixed peak bound; no clipping, limiter or loudness normalization was applied.'); const quantized = Math.round(value * 32767), actual = quantized / 32768; view.setInt16(44 + frame * 2, quantized, true); if (!nonzero) { if (quantized === 0) leadingZeroFrames++; else nonzero = true; } peak = Math.max(peak, Math.abs(actual)); squares += actual * actual; sum += actual; }
  check(); const sha256 = await digest(bytes); check();
  return { bytes, sha256, frames, nominalT60: t60, nominalBodyHz: hz, statistics: { peak, rms: Math.sqrt(squares / frames), dcMean: sum / frames, preparedSineTerms: partials.length, scheduledSourceDelayFrames: 0, leadingZeroFrames, onsetEdgeFrames: 24, tailEdgeFrames: 96, dcPolicy: 'weighted-finite-support-DC-removal;PCM16-quantization-follows', normalization: 'none;fixed-authored-gains' } };
}

export async function buildCircuitWorkshop({ variant = 'clean' } = {}, { descriptors, applicationBuildId, estimatedPeakBytes, signal, current = () => true, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)), onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (!current()) fail('The original kit preparation changed.'); }; check();
  if (!Object.hasOwn(CIRCUIT_WORKSHOP_VARIANTS, variant) || !/^[a-f0-9]{64}$/.test(applicationBuildId || '') || !Number.isSafeInteger(estimatedPeakBytes) || estimatedPeakBytes < 128 * 1048576 || estimatedPeakBytes > 512 * 1048576 || typeof globalThis.registerProcessor === 'function') fail('Choose one bounded original variant and non-render worker preparation.');
  const profile = CIRCUIT_WORKSHOP_VARIANTS[variant], descriptor = descriptors?.find(engine => engine.engineId === 'worklet-sample'); if (!descriptor?.capabilities.advancedSampleMaps || descriptor.maximumVoices < 8) fail('The exact owned sample-map renderer is required.');
  const assets = [], voices = [], statistics = [], sourceUrl = 'urn:lemmings:circuit-workshop:' + CIRCUIT_WORKSHOP_REVISION + ':' + variant, rights = kind => ({ kind, creator: 'LemmingsJS-MIDI', sourceUrl, licenseId: 'NOASSERTION', licenseUrl: null, attribution: 'Original synthesized Circuit Workshop sources; no third-party sound recordings.', modifications: [CIRCUIT_WORKSHOP_REVISION + '; ' + variant], declaredUse: 'unknown' });
  for (let index = 0; index < CIRCUIT_WORKSHOP_VOICES.length; index++) {
    const model = CIRCUIT_WORKSHOP_VOICES[index]; onProgress({ phase: 'preparing-original-strike', voiceId: model.id, completedVoices: index, totalVoices: CIRCUIT_WORKSHOP_VOICES.length }); const wave = await prepareStrike(model, profile, index, { check, yieldControl }); check(); assets.push({ path: 'circuit/' + model.id + '.wav', sha256: wave.sha256, bytes: wave.bytes });
    voices.push({ id: model.id, name: model.name, gmNote: model.gmNote, articulationId: model.id, assetHash: wave.sha256, sourceRate: RATE, sourceFrames: wave.frames, sourceChannels: 1, nominalBodyHz: wave.nominalBodyHz, nominalAmplitudeT60Seconds: wave.nominalT60, preparationComponents: model.components, runtimeChildren: 1, chokeGroup: model.chokeGroup || null }); statistics.push({ id: model.id, ...wave.statistics });
  }
  const kit = validateDrumKitDefinition({ schema: 'lemmings-drum-kit/v1', id: 'circuit.workshop.' + variant, revision: 1, name: 'Circuit Workshop · ' + profile.name, generatorRevision: CIRCUIT_WORKSHOP_REVISION, variant, voices, chokeGroups: [{ id: 'hats', scope: 'lane-kit-instance', action: 'newest-admitted-voice;click-safe-end', members: ['closed-hat', 'pedal-hat', 'open-hat'] }], unknownVoiceId: 'rim', pitchPolicy: 'fixed-prepared-source;GM-note-selects-articulation', qualification: 'unqualified-original-content;device-and-listening-pending', roomPolicy: profile.roomTaps.length ? 'printed-finite-taps;not-shared-room-send' : 'dry-prepared-source' });
  const encodedKit = canonicalDataText(kit, { maxBytes: 65536, maxNodes: 8192 }), kitHash = await hashDataText(encodedKit.text); check(); assets.push({ path: 'circuit/kit.json', sha256: kitHash, bytes: encodedKit.bytes });
  const contract = freezeData({ schema: 'lemmings-circuit-workshop-production/v1', revision: CIRCUIT_WORKSHOP_REVISION, producerBuildId: applicationBuildId, runtimeTarget: { engineId: descriptor.engineId, engineVersion: descriptor.engineVersion, artifactHash: descriptor.artifactHash, parameterSchemaHash: descriptor.parameterSchemaHash, declaredVoiceLimit: Math.min(16, descriptor.maximumVoices) }, kit, kitHash, profile, models: CIRCUIT_WORKSHOP_VOICES, statistics, aliasPolicy: 'finite-sine-and-bandlimited-odd-harmonic-sources;all-metal-partials-below-0.4-source-rate;no-nonlinear-saturation', decayUnits: 'nominal-component-amplitude-T60-seconds;not-measured-whole-output-decay', runtimeCost: 'one-sample-reader-and-owned-filter-per-strike;composite-lobes-and-partials-are-prepared-PCM', determinism: 'actual-prepared-WAV-hashes;no-cross-engine-Math.sin-byte-equivalence-claim', roomControl: 'shared-send-control-not-provided-by-prepared-sample-patch', quality: 'original-unqualified-starting-values;matched-level-listening-and-device-cost-pending' }), encoded = canonicalDataText(contract, { maxBytes: 262144, maxNodes: 32768 }), contractHash = await hashDataText(encoded.text); check(); assets.push({ path: 'circuit/production.json', sha256: contractHash, bytes: encoded.bytes });
  const id = 'circuit.' + variant + '.' + contractHash.slice(0, 20), macro = (id, name, parameter, minimum, maximum, unit, default01, perceptualDirection) => ({ id, name, mode: 'onset-only', default01, smoothingMs: 0, perceptualDirection, targets: [{ parameter, minimum: quantity(minimum, unit), maximum: quantity(maximum, unit), curve: 'linear', composition: 'replace', clamp: true }] });
  const source = { schema: 'lemmings-sound-recipes/v1', pack: { id, version: '1.0.0', name: kit.name + ' · prepared strikes', author: 'LemmingsJS-MIDI', sourceUrl, licenseId: 'NOASSERTION', licenseUrl: null, attribution: 'Original finite source synthesis and explicit lane/kit-instance hat choke. Nominal models and actual WAV hashes are embedded.', modifications: [], redistributionPolicy: 'unknown', licenses: [] },
    files: assets.map(asset => ({ path: asset.path, sha256: asset.sha256, bytes: asset.bytes.length, kind: asset.path.endsWith('.wav') ? 'sample' : 'generated-data', mediaType: asset.path.endsWith('.wav') ? 'audio/wav' : 'application/json', parents: [], rights: rights(asset.path.endsWith('.wav') ? 'sample-recording' : 'derived-data') })),
    recipes: [{ id, revision: 1, name: kit.name + ' · prepared strikes', author: 'LemmingsJS-MIDI', tags: ['original', 'circuit-workshop', 'prepared-strikes', 'fixed-source-pitch', 'unqualified-content'], engine: { id: 'worklet-sample', version: descriptor.engineVersion }, rights: rights('patch-recipe'), sampleRefs: assets.filter(asset => asset.path.endsWith('.wav')).map(asset => ({ id: asset.path.slice(8, -4), sha256: asset.sha256, bytes: asset.bytes.length, required: true })), dependencies: assets.map(asset => asset.sha256), voicePolicy: { maxVoices: Math.min(16, descriptor.maximumVoices), steal: 'reject' }, mix: { gain01: 0.6, pan01: 0 },
      components: [component('exciter', { sampleLowpassHz: quantity(16000, 'Hz'), sampleVelocityTone01: quantity(0.55, 'normalized') }), component('envelope', { attackSeconds: quantity(0, 's'), decaySeconds: quantity(0, 's'), sustain01: quantity(1, 'ratio'), releaseSeconds: quantity(0.008, 's') }), component('output', { gain01: quantity(0.35, 'amplitude-linear'), pan01: quantity(0, 'normalized') })],
      macros: [macro('weight', 'WEIGHT', 'sampleLowpassHz', 16000, 1800, 'Hz', 0, 'More WEIGHT lowers the actual source low-pass cutoff on new strikes; it does not add a subsonic oscillator or a selective low shelf.'), macro('snap', 'SNAP', 'attackSeconds', 0.008, 0, 's', 1, 'More SNAP shortens the host attack edge on new strikes; the original composite source remains intact.'), macro('metal', 'METAL', 'sampleVelocityTone01', 0.1, 1, 'normalized', 0.5, 'More METAL increases velocity-dependent brightness contrast through the actual owned source filter; it does not add live partial layers.')],
      sampleMap: { schema: 'lemmings-sample-instrument-map/v1', rendererProfile: 'owned-sample-v1', mapId: id + '.map', revision: 1, articulations: voices.map(voice => ({ id: voice.articulationId, name: voice.name })), neutralArticulationId: 'rim', selectionPolicy: { algorithmVersion: 'stable-semantic-onset-fnv32-v1', seed: 21309, advanceOn: 'semantic-onset', unknownArticulation: 'neutral', rootSelection: 'nearest-lower-tie' }, releasePolicy: 'owned-end', normalizationRef: null, rightsRef: 'embedded-original-production', zones: voices.map(voice => ({ id: voice.id, articulationId: voice.articulationId, roundRobinGroup: voice.id, alternateIndex: 0, velocityMin01: 0, velocityMax01: 1, assetHash: voice.assetHash, onsetFrame: 0, endFrame: voice.sourceFrames, rootCents: voice.gmNote * 100, gain01: 0.7, tuningCents: 0, pitchTracking: 'fixed', pitchRange: { minCents: 0, maxCents: 12700, maxTransposeCents: 0 }, playbackMode: 'forward', loop: null, releaseRegion: null, chokeGroup: voice.chokeGroup })) } }] };
  const compiled = await compileSoundContent(source, { targets: [{ descriptor }], signal }); check(); onProgress({ phase: 'original-kit-prepared', completedVoices: voices.length, totalVoices: voices.length });
  return { pack: compiled.prepared.pack, contentHash: compiled.prepared.contentHash, assets, kit, kitHash, contractHash, qualification: 'original-content-preparation-only;runtime-and-listening-unqualified' };
}
