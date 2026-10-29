import { collectBrowserCases } from './BrowserTestCatalog.js';

const required = Object.freeze({ 'chromium-semantic': 4, 'firefox-lifecycle': 7, 'webkit-lifecycle': 7 });
const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const semanticReceipt = (report, project) => {
  const receipts = [];
  const visit = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) if (test.projectName === project)
      for (const attachment of test.results?.at(-1)?.attachments || []) if (attachment.name === 'native-engine-semantics.json') {
        if (attachment.contentType !== 'application/json' || typeof attachment.body !== 'string' || attachment.body.length > 2 * 1048576) throw new Error('Invalid native semantic attachment: ' + project);
        receipts.push(JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')));
      }
    for (const child of suite.suites || []) visit(child);
  };
  for (const suite of report.suites || []) visit(suite);
  if (receipts.length !== 1) throw new Error('Expected exactly one native semantic receipt: ' + project);
  const receipt = receipts[0], source = receipt.source;
  if (receipt.project !== project || typeof receipt.browser !== 'string' || !receipt.browser || source?.schema !== 'lemmings-engine-semantics/v1' ||
      source.recipe?.seed !== 42 || source.recipe?.lanes !== 8 || source.recipe?.ticks !== 64 || source.initialTick !== 0 || source.finalTick !== 64 || source.batches !== 64 ||
      !Number.isSafeInteger(source.facts) || source.facts < 1 || source.facts > 1000000 || source.complete !== true || source.stablePaused !== true || source.outputEnabled !== false ||
      !sha256(source.initialHash) || !sha256(source.physicsHash) || !sha256(source.causalHash) || source.initialHash === source.physicsHash ||
      source.renderer?.path !== 'canvas2d_main_thread' || source.renderer.state !== 'ready' || source.renderer.hardwareAcceleration !== 'unqualified' ||
      !Number.isSafeInteger(source.viewport?.width) || source.viewport.width < 1920 || !Number.isSafeInteger(source.viewport?.height) || source.viewport.height < 1080 ||
      !Number.isSafeInteger(source.observerListeners?.before) || source.observerListeners.before < 0 || source.observerListeners.before !== source.observerListeners.after ||
      !Array.isArray(source.assets) || !source.assets.length || typeof source.audioContextAvailable !== 'boolean') throw new Error('Incomplete native semantic qualification: ' + project);
  return receipt;
};

export function qualifyLifecycleEngineResults(report) {
  const engines = [];
  for (const [project, count] of Object.entries(required)) {
    const cases = collectBrowserCases(report, project);
    if (cases.length !== count || cases.some(value => value.expectedStatus !== 'passed' || value.lastStatus !== 'passed')) throw new Error('Required engine cases did not pass: ' + project);
    engines.push({ project, passed: cases.length, ...semanticReceipt(report, project) });
  }
  const reference = engines[0].source;
  for (const engine of engines.slice(1)) for (const key of ['initialHash', 'physicsHash', 'causalHash', 'facts', 'assets'])
    if (JSON.stringify(engine.source[key]) !== JSON.stringify(reference[key])) throw new Error('Cross-engine semantic mismatch: ' + engine.project + ' / ' + key);
  return { schema: 'lemmings-lifecycle-engine-qualification/v1', passed: engines.reduce((sum, value) => sum + value.passed, 0), engines,
    scope: 'Exact muted fixture physics/causal parity plus qualified history/storage/audio capability paths. No acoustic, native GPU/MIDI or archived-execution qualification.' };
}
