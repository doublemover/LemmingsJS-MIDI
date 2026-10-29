import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectBrowserRuntimeClosure } from './BrowserRuntimeClosure.js';
import { runBrowserBoundaries } from './run-browser-boundaries.js';
import { qualifyLifecycleEngineResults } from './LifecycleEngineResults.js';

const root = fileURLToPath(new URL('../', import.meta.url)), output = path.join(root, '.tmp');
const harnessFiles = ['playwright.lifecycle.config.js', 'scripts/run-lifecycle-engines.js', 'scripts/LifecycleEngineResults.js', 'scripts/run-browser-boundaries.js',
  'e2e-portable/fixtures.js', 'e2e-portable/lifecycle.spec.js', 'e2e-portable/semantic.spec.js'];
const harness = () => Promise.all(harnessFiles.map(async name => {
  const bytes = await fs.readFile(path.join(root, name)); return { path: name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}));

export async function runLifecycleEngines() {
  await fs.mkdir(output, { recursive: true });
  const reportPath = path.join(output, 'lifecycle-engine-results.json'), summaryPath = path.join(output, 'lifecycle-engine-qualification.json');
  const receipt = { schema: 'lemmings-lifecycle-engine-run/v1', status: 'failed', node: process.version, configuredAudioBackend: process.env.LEMMINGS_LIFECYCLE_AUDIO_BACKEND || 'system-default-unqualified' };
  try {
    const before = await collectBrowserRuntimeClosure({ rootDir: root }), beforeHarness = await harness();
    receipt.source = { closureDigest: before.closureDigest, codeDigest: before.codeDigest, assetDigest: before.assetDigest, files: before.files, harness: beforeHarness,
      executionQualification: before.executionQualification };
    const code = await runBrowserBoundaries(['--config=playwright.lifecycle.config.js', '--workers=1', '--reporter=list,json'],
      { env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath } });
    const after = await collectBrowserRuntimeClosure({ rootDir: root });
    if (before.closureDigest !== after.closureDigest || JSON.stringify(beforeHarness) !== JSON.stringify(await harness())) throw new Error('Engine qualification source changed during execution.');
    if (code !== 0) throw new Error('Native engine journeys failed with exit code ' + code);
    receipt.qualification = qualifyLifecycleEngineResults(JSON.parse(await fs.readFile(reportPath, 'utf8')));
    receipt.status = 'passed'; console.log('All11 native engine journeys passed with matching physics, causal and asset identities.');
  } catch (error) {
    receipt.error = String(error?.stack || error); console.error(error?.message || error);
  } finally { await fs.writeFile(summaryPath, JSON.stringify(receipt, null, 2) + '\n'); }
  return receipt.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await runLifecycleEngines();
