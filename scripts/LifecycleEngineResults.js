import { collectBrowserCases } from './BrowserTestCatalog.js';
import { NATIVE_CLOCK_SCENARIOS, qualifyNativeClockReceipt } from './NativeClockResults.js';

export const LIFECYCLE_ENGINE_CASES = Object.freeze({ 'chromium-semantic': 15, 'firefox-lifecycle': 18, 'webkit-lifecycle': 18 });
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

const clockReceipts = (report, project) => {
  const receipts = [];
  const visit = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) if (test.projectName === project)
      for (const attachment of test.results?.at(-1)?.attachments || []) if (attachment.name === 'native-physical-clock.json') {
        if (attachment.contentType !== 'application/json' || typeof attachment.body !== 'string' || attachment.body.length > 12 * 1048576) throw new Error('Invalid native clock attachment: ' + project);
        receipts.push(qualifyNativeClockReceipt(JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')), project));
      }
    for (const child of suite.suites || []) visit(child);
  };
  for (const suite of report.suites || []) visit(suite);
  if (receipts.length !== NATIVE_CLOCK_SCENARIOS.length || new Set(receipts.map(row => row.scenario)).size !== NATIVE_CLOCK_SCENARIOS.length) throw new Error('Missing or duplicate native clock qualification: ' + project);
  return receipts;
};

const runtimeReceipt = (report, project, available) => {
  const receipts = [];
  const visit = suite => {
    for (const spec of suite.specs || []) for (const test of spec.tests || []) if (test.projectName === project)
      for (const attachment of test.results?.at(-1)?.attachments || []) if (attachment.name === 'native-runtime-transitions.json') {
        if (attachment.contentType !== 'application/json' || typeof attachment.body !== 'string' || attachment.body.length > 512 * 1024) throw new Error('Invalid native runtime attachment: ' + project);
        receipts.push(JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')));
      }
    for (const child of suite.suites || []) visit(child);
  };
  for (const suite of report.suites || []) visit(suite);
  if (receipts.length !== 1) throw new Error('Expected exactly one native runtime receipt: ' + project);
  const value = receipts[0];
  if (value.schema !== 'lemmings-native-runtime-transitions/v1' || value.project !== project || typeof value.browser !== 'string' || !value.browser || value.available !== available || !Array.isArray(value.cycles)) throw new Error('Incomplete native runtime qualification: ' + project);
  if (!available) {
    if (value.reason !== 'native-AudioContext-absent' || value.cycles.length || value.final !== null || value.deviceSignal !== null) throw new Error('Contradictory native runtime absence: ' + project);
    return value;
  }
  const expected = [['balanced', 44100], ['performance', 48000], ['robust', 96000]], final = value.final, signal = value.deviceSignal;
  if (value.cycles.length !== 3 || expected.some(([profile, rate], index) => {
    const cycle = value.cycles[index];
    return cycle.config?.latencyProfile !== profile || cycle.config?.preferredSampleRate !== rate || cycle.result?.status !== 'rebuild-ready' || cycle.result.requiresEnable !== true || cycle.result.acousticReceipt !== false ||
      cycle.contextsBefore !== index + 1 || cycle.contextsAfter !== cycle.contextsBefore || cycle.oldClosed !== true || cycle.currentNull !== true || cycle.enabled !== false || cycle.activeVoices !== 0 ||
      !Number.isFinite(cycle.wallMs) || cycle.wallMs < 0 || !Number.isFinite(cycle.before?.actualSampleRate) || cycle.before.actualSampleRate <= 0 || cycle.before.acousticMeasurement !== false;
  }) || final?.retirement?.state !== 'retired' || final.retirement.outcome !== 'complete' || !Array.isArray(final.contexts) || final.contexts.length !== 4 ||
    final.contexts.some((context, index) => context.closed !== true || !Number.isFinite(context.actualSampleRate) || context.actualSampleRate <= 0 ||
      context.requested?.latencyHint !== ['interactive', 'balanced', 'interactive', 'playback'][index] || (index ? context.requested.sampleRate !== [44100, 48000, 96000][index - 1] : Object.hasOwn(context.requested, 'sampleRate'))) ||
    final.observation?.config?.latencyProfile !== 'robust' || final.observation.config.preferredSampleRate !== 96000 || final.observation.acousticMeasurement !== false || final.observation.actualSampleRate !== final.contexts[3].actualSampleRate || final.outputWatch?.devicesListening !== false || final.outputWatch.speakerPermission !== 'retired' ||
    signal?.controlled !== true || signal.enabled !== false || signal.activeVoices !== 0 || signal.sameContext !== true || signal.contexts !== 1 ||
    !Number.isSafeInteger(signal.beforeEpoch) || !Number.isSafeInteger(signal.afterEpoch) || signal.afterEpoch <= signal.beforeEpoch) throw new Error('Incomplete native runtime qualification: ' + project);
  return value;
};

export function qualifyLifecycleEngineResults(report) {
  const engines = [];
  for (const [project, count] of Object.entries(LIFECYCLE_ENGINE_CASES)) {
    const cases = collectBrowserCases(report, project);
    if (cases.length !== count || cases.some(value => value.expectedStatus !== 'passed' || value.lastStatus !== 'passed')) throw new Error('Required engine cases did not pass: ' + project);
    engines.push({ project, passed: cases.length, ...semanticReceipt(report, project), nativeClock: clockReceipts(report, project) });
    const engine = engines.at(-1);
    if (engine.nativeClock.some(row => row.availability.available !== engine.source.audioContextAvailable)) throw new Error('Native clock capability contradicts engine semantics: ' + project);
    engine.nativeRuntime = runtimeReceipt(report, project, engine.source.audioContextAvailable);
  }
  const reference = engines[0].source;
  for (const engine of engines.slice(1)) for (const key of ['initialHash', 'physicsHash', 'causalHash', 'facts', 'assets'])
    if (JSON.stringify(engine.source[key]) !== JSON.stringify(reference[key])) throw new Error('Cross-engine semantic mismatch: ' + engine.project + ' / ' + key);
  return { schema: 'lemmings-lifecycle-engine-qualification/v1', passed: engines.reduce((sum, value) => sum + value.passed, 0), engines,
    scope: 'Exact muted fixture physics/causal parity plus history/storage/audio capabilities and native scheduled source clock, rearm, cancellation and owner isolation where available; explicit constructor absence otherwise. Native source probes precede the envelope; device/acoustic latency, native GPU/MIDI and archived execution remain unqualified.' };
}
