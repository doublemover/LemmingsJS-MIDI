import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { materializePinnedStretchCore } from './materialize-stretch-core.mjs';
import { bakeSeedWarp } from '../js/app/resources/SeedWarpBake.js';
import { seedDigest } from '../js/app/resources/SoundSeedDerivedAudio.js';
import { encodeOwnedAudioWav } from '../js/app/midi-ui/OwnedAudioWav.js';
import { canonicalDataText } from '../js/core/CanonicalData.js';

// An actual offline bake matrix, not a build step or an automatic quality-tier
// publisher. Run only in the deferred combined validation phase.
export async function qualifySeedWarp({ wasmBytes, onProgress = () => {} } = {}) {
  const sampleRate = 32000, frames = 9600, pcm = new Uint8Array(frames * 8), view = new DataView(pcm.buffer);
  for (let frame = 0; frame < frames; frame++) { const value = Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.1; view.setFloat32(frame * 8, value, true); view.setFloat32(frame * 8 + 4, -value, true); }
  const origin = { schema: 'lemmings-sound-seed/v1', frames, sampleRate, channels: 2, tap: 'synthetic-warp-qualification-fixture', bakedEffects: 'none-declared', bakedCausePolicy: 'synthetic-fixture;no-physical-events', coverage: { status: 'known-material', gaps: [] }, ancestry: [{ originKind: 'SYNTHETIC FIXTURE', completeParentArtifactHash: '0'.repeat(64) }] }, bytes = encodeOwnedAudioWav(pcm, frames, sampleRate, origin), assetHash = await seedDigest(bytes), rows = [];
  const source = { sampleRate, sourceFrames: frames, formatVersion: origin.schema, immutableSourceRef: assetHash };
  for (const outputRate of [44100, 48000, 96000]) for (const rateRatio of [0.75, 1, 1.5]) for (const pitchRatio of [0.5, 1, 2]) {
    const started = performance.now(), result = await bakeSeedWarp({ pcm, originBytes: canonicalDataText(origin).bytes, source, firstFrame: 0, endFrame: frames, sampleRate, generation: 1, options: { rateRatio, pitchRatio, outputRate }, wasmBytes }, { estimatedPeakBytes: 128 * 1048576, yieldControl: async () => {} }), recipe = result.recipe, output = new DataView(result.bytes.buffer, result.bytes.byteOffset + 56, result.manifest.frames * 8), crossings = [];
    if (recipe.bodyFrames !== Math.ceil(frames * outputRate / sampleRate / rateRatio) || recipe.options.pitchRatio !== pitchRatio || result.manifest.frames !== recipe.bodyFrames + recipe.tailFrames || result.manifest.ancestry.at(-1).parentSampleRate !== sampleRate) throw new Error('The concrete source-rate/body-duration/tail receipt differs.');
    let previous = 0, antiPhaseMaximumError = 0;
    for (let frame = 0; frame < recipe.bodyFrames; frame++) { const value = output.getFloat32(frame * 8, true), right = output.getFloat32(frame * 8 + 4, true); antiPhaseMaximumError = Math.max(antiPhaseMaximumError, Math.abs(value + right)); if (frame > outputRate * 0.08 && frame < recipe.bodyFrames - outputRate * 0.04 && previous <= 0 && value > 0) crossings.push(frame - 1 + -previous / (value - previous)); previous = value; }
    const measuredHz = crossings.length > 2 ? outputRate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]) : null, targetHz = 440 * pitchRatio;
    if (measuredHz === null || Math.abs(measuredHz - targetHz) > Math.max(10, targetHz * 0.05) || antiPhaseMaximumError > 1e-5) throw new Error('The coarse pitch/stereo smoke gate failed.');
    rows.push({ outputRate, rateRatio, pitchRatio, elapsedMs: performance.now() - started, assetHash: result.assetHash, bodyFrames: recipe.bodyFrames, tailFrames: recipe.tailFrames, measuredHz, targetHz, antiPhaseMaximumError, configurationHash: recipe.coreConfigurationHash, pcmHash: result.manifest.pcmHash }); onProgress({ completed: rows.length, total: 27 });
  }
  return { schema: 'lemmings-seed-warp-bake-smoke/v1', rows, evidence: 'Node-offline-buffered-core;coarse-held-sine-crossings-and-anti-phase-only', qualifiedTier: false, onsetImpulseEvidence: false, aliasSpectraEvidence: false, browserCostEvidence: false, listeningEvidence: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); let name = 'qualifier', sourceFile = null;
  for (const arg of process.argv.slice(2)) { if (arg.startsWith('--name=')) name = arg.slice(7); else if (arg.startsWith('--source=')) sourceFile = path.resolve(arg.slice(9)); else throw new Error('Unknown warp probe option: ' + arg); }
  const material = await materializePinnedStretchCore({ rootDir, sourceFile }), result = await qualifySeedWarp({ wasmBytes: new Uint8Array(await fs.readFile(material.path)) }); process.stdout.write(JSON.stringify({ name, ...result }) + '\n');
}
