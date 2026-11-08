import { expect } from 'chai';
import { fileURLToPath } from 'node:url';
import { collectRuntimeSourceClosure } from '../scripts/RuntimeSourceClosure.js';
import { runBackgroundJobKernel } from '../js/app/resources/BackgroundJobKernels.js';
const options = { maxBytes: 1048576, estimatedPeakBytes: 16 * 1048576, yieldControl: async () => {} };

describe('specialized background module ownership', () => {
  for (const kind of ['asset-decode', 'decode-wave-source']) it('rechecks retired source ownership after loading ' + kind + ' before inspecting input', async () => {
    let current = true, inspected = 0, failure;
    const input = new Proxy({}, { get() { inspected++; throw Error('Retired input must not be inspected'); } });
    const pending = runBackgroundJobKernel(kind, input, { ...options, current: () => current }); current = false;
    try { await pending; } catch (error) { failure = error; }
    expect(failure?.code).to.equal('stale-owner'); expect(inspected).to.equal(0);
  });
  it('retains the complete literal dependency closure for immutable worker publication', async function() {
    this.timeout(30000);
    const closure = await collectRuntimeSourceClosure({ rootDir: fileURLToPath(new URL('../', import.meta.url)), entries: ['js/app/resources/BackgroundJobWorker.js'] });
    expect(closure.dependencies).to.deep.equal([]);
    const files = new Set(closure.files.map(file => file.path));
    for (const file of ['js/app/resources/CircuitWorkshopBuilder.js', 'js/app/resources/ShapeBodySolver.js', 'js/app/resources/WaveSourceDecode.js',
      'js/midi/content/SoundContentCompiler.js', 'js/app/procgen/SceneTerrainLayout.js', 'js/app/procgen/workstation/RecordedUmpClipExport.js']) expect(files.has(file), file).to.equal(true);
  });
});
