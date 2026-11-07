import { createOwnedStretchMaterial } from '../js/app/midi-ui/OwnedStretchMaterial.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createOwnedResourceReservation } from '../js/app/resources/OwnedResourceReservation.js';
import { OWNED_STRETCH_CORE } from '../js/midi/content/OwnedStretchCoreIdentity.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareOwnedStretchCore } from '../js/app/resources/OwnedStretchCore.js';
import { materializePinnedStretchCore } from './materialize-stretch-core.mjs';

// Deliberately separate from ordinary format/build. This executes real DSP and
// belongs to the deferred combined qualification pass. Finite stereo output and
// heap observations alone never publish a spectral/perceptual/device quality tier.
export async function qualifyStretchCore({ wasmBytes, onProgress = () => {} } = {}) {
  const budget = createResourceBudget(), material = createOwnedStretchMaterial({ resourceBudget: budget, getBuild: () => ({ buildId: 'b'.repeat(64) }), getRoot: () => new URL('https://fixture.invalid/immutable/'), fetchImpl: async () => new Response(new Blob([wasmBytes]), { headers: { 'content-length': String(OWNED_STRETCH_CORE.wasmBytes) } }) });
  const copyWorkspace = createOwnedResourceReservation({ budget, owner: 'stretch-core-material-probe', kind: 'independent-reader-copy', bytes: 1048576 }), copyOnlyBytes = budget.diagnostics().accountedBytes; let first, second;
  try { first = await material.borrow(); second = await material.borrow(); const retirement = material.dispose(); await retirement.completion; if (retirement.outcome !== 'complete' || budget.diagnostics().accountedBytes <= copyOnlyBytes) throw new Error('The independent core readers lost their charged lifetime.'); const bytes = new Uint8Array(await first.blob.arrayBuffer()); if (bytes.length !== OWNED_STRETCH_CORE.wasmBytes) throw new Error('The independent copied core reader changed.'); }
  finally { first?.release(); second?.release(); await material.dispose().completion; copyWorkspace.release(); }
  if (budget.diagnostics().accountedBytes !== 0) throw new Error('Core material readers retained known released storage.');
  const rows = [];
  for (const sampleRate of [44100, 48000, 96000]) for (const rateRatio of [0.75, 1, 1.5]) for (const pitchRatio of [0.5, 1, 2]) {
    const started = performance.now(), core = await prepareOwnedStretchCore(wasmBytes, { sampleRate, estimatedPeakBytes: 64 * 1048576 }), preparedMs = performance.now() - started;
    try {
      core.setPitch(pitchRatio); const left = new Float32Array(192), right = new Float32Array(192), outLeft = new Float32Array(128), outRight = new Float32Array(128), costs = [];
      let peak = 0, antiPhaseMaximumError = 0, sourceFrame = 0, squares = 0, outputFrames = 0;
      const blocks = Math.ceil(sampleRate * 0.5 / 128), inputFrames = Math.round(128 * rateRatio);
      for (let block = 0; block < blocks; block++) {
        for (let frame = 0; frame < inputFrames; frame++) { left[frame] = Math.sin(2 * Math.PI * 440 * (sourceFrame + frame) / sampleRate) * 0.1; right[frame] = -left[frame]; }
        const at = performance.now(); core.process(left, right, 0, inputFrames, outLeft, outRight, 0, 128); costs.push(performance.now() - at); sourceFrame += inputFrames;
        for (let frame = 0; frame < 128; frame++) { if (!Number.isFinite(outLeft[frame]) || !Number.isFinite(outRight[frame])) throw new Error('The pinned core produced nonfinite PCM.'); peak = Math.max(peak, Math.abs(outLeft[frame]), Math.abs(outRight[frame])); antiPhaseMaximumError = Math.max(antiPhaseMaximumError, Math.abs(outLeft[frame] + outRight[frame])); squares += outLeft[frame] ** 2 + outRight[frame] ** 2; } outputFrames += 128;
      }
      const rms = Math.sqrt(squares / (outputFrames * 2)); if (rms < 1e-8 || peak > 32 || antiPhaseMaximumError > 1e-5) throw new Error('The pinned core finite/stereo smoke gate failed.');
      costs.sort((a, b) => a - b); const row = { sampleRate, rateRatio, pitchRatio, preparedMs, peak, rms, antiPhaseMaximumError, inputFrames: sourceFrame, outputFrames, blockCostMs: { p50: costs[Math.floor(costs.length * 0.5)], p95: costs[Math.floor(costs.length * 0.95)], max: costs.at(-1) }, core: core.diagnostics(), configuration: core.configuration };
      rows.push(row); onProgress({ completed: rows.length, total: 27 });
    } finally { core.dispose(); }
  }
  return { schema: 'lemmings-owned-stretch-core-smoke/v1', rows, evidence: 'Node-WASM-core-finite-and-linked-stereo-only', qualifiedTier: false, preparationDeadlineEvidence: false, browserCostEvidence: false, spectralPitchEvidence: false, sourceOnsetMappingEvidence: false, listeningEvidence: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); let name = 'qualifier', sourceFile = null;
  for (const arg of process.argv.slice(2)) { if (arg.startsWith('--name=')) name = arg.slice(7); else if (arg.startsWith('--source=')) sourceFile = path.resolve(arg.slice(9)); else throw new Error('Unknown core probe option: ' + arg); }
  const material = await materializePinnedStretchCore({ rootDir, sourceFile }), result = await qualifyStretchCore({ wasmBytes: new Uint8Array(await fs.readFile(material.path)) });
  process.stdout.write(JSON.stringify({ name, ...result }) + '\n');
}
