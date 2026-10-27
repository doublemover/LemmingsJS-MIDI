import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { collectRuntimeSourceClosure } from './RuntimeSourceClosure.js';
import { collectInstrumentArtifactProfiles } from './InstrumentArtifactClosure.js';
import { computeInstrumentArtifacts } from '../js/runtime/InstrumentArtifactManifest.js';
import { canonicalDataText } from '../js/core/CanonicalData.js';
import { launchAudioEvidenceBrowser } from './audio-evidence-runtime.js';
const root = fileURLToPath(new URL('../', import.meta.url)), args = process.argv.slice(2), options = {};
for (const arg of args) { const match = /^--(input|patch|traces|out-dir|sample-rates|maximum-cases|maximum-render-seconds|maximum-output-bytes|browser|channel|executable)=(.+)$/.exec(arg); if (!match || options[match[1]]) throw new Error('Unknown or repeated sound qualification option.'); options[match[1]] = match[2]; }
if (!options.input || !options.patch || !options['out-dir']) throw new Error('Explicit --input= recipe, --patch= identity and new --out-dir= under temp/ are required. This command performs deferred runtime qualification.');
const inside = (parent, child) => { const relative = path.relative(parent, child); return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
const input = await fs.realpath(path.resolve(root, options.input)); if (!inside(path.join(root, 'content', 'sounds'), input)) throw new Error('Recipe must be inside content/sounds.');
const sourceBytes = await fs.readFile(input); if (sourceBytes.length > 8 * 1048576) throw new Error('Recipe exceeds its source bound.'); const source = JSON.parse(sourceBytes);
const traces = [];
if (options.traces) { const filename = await fs.realpath(path.resolve(root, options.traces)); if (!inside(root, filename)) throw new Error('Trace fixture must be inside the project.'); const bytes = await fs.readFile(filename); if (bytes.length > 12 * 1048576) throw new Error('Trace fixture exceeds its bound.'); traces.push(...JSON.parse(bytes).fixtures); }
const output = path.resolve(root, options['out-dir']); if (!inside(path.join(root, 'temp'), output)) throw new Error('Qualification artifacts belong under temp, never runtime bundles.');
await fs.mkdir(path.dirname(output), { recursive: true }); if (!inside(path.join(await fs.realpath(root), 'temp'), path.join(await fs.realpath(path.dirname(output)), path.basename(output)))) throw new Error('Output ancestor escapes temp.'); await fs.mkdir(output);
const entries = ['js/midi/qualification/SoundQualificationRunner.js', 'js/midi/qualification/SoundQualificationPlan.js', 'js/midi/qualification/SharedSoundQualificationRenderer.js', 'js/midi/qualification/SoundListeningReview.js',
  'js/midi/content/SoundContentCompiler.js', 'js/app/midi-ui/NativeInstrumentSchema.js'];
const closure = await collectRuntimeSourceClosure({ rootDir: root, entries, maxFiles: 1024, maxBytes: 64 * 1048576 });
if (closure.dependencies.length) throw new Error('Qualification browser source has unresolved dependencies.');
const profiles = await collectInstrumentArtifactProfiles({ rootDir: root }), artifacts = await computeInstrumentArtifacts(profiles.files, profiles.profiles), inventory = new Map();
for (const file of [...closure.files, ...profiles.files]) { const previous = inventory.get(file.path); if (previous && previous.sha256 !== file.sha256) throw new Error('Source changed during qualification snapshot.'); inventory.set(file.path, file); }
const snapshot = new Map(); for (const file of inventory.values()) { const bytes = await fs.readFile(path.join(root, file.path)); if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Source changed before immutable browser snapshot.'); snapshot.set('/' + file.path, bytes); }
const manifest = { schema: 'lemmings-qualification-source-snapshot/v1', files: [...inventory.values()].sort((a, b) => a.path.localeCompare(b.path)), recipeHash: createHash('sha256').update(sourceBytes).digest('hex'), artifacts };
const applicationBuildId = createHash('sha256').update(canonicalDataText(manifest).bytes).digest('hex');
await fs.writeFile(path.join(output, 'source-snapshot.json'), JSON.stringify({ ...manifest, applicationBuildId }, null, 2), { flag: 'wx' });
const { browser, environment } = await launchAudioEvidenceBrowser(); let context;
try {
  context = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, permissions: [] }); const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()); if (url.origin !== 'http://127.0.0.1:8138') return route.abort();
    if (request.method() === 'POST' && url.pathname === '/artifact') {
      const name = url.searchParams.get('name'), expected = url.searchParams.get('sha256'), bytes = request.postDataBuffer();
      if (!/^(?:case-\d+\.wav|case-\d+\.json|plan\.json)$/.test(name || '') || !/^[a-f0-9]{64}$/.test(expected || '') || !bytes || bytes.length > 64 * 1048576 || createHash('sha256').update(bytes).digest('hex') !== expected) return route.fulfill({ status: 400, body: 'Invalid qualification artifact.' });
      try { await fs.writeFile(path.join(output, name), bytes, { flag: 'wx' }); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ path: name, sha256: expected, bytes: bytes.length }) }); }
      catch (error) { return route.fulfill({ status: 409, body: error.message }); }
    }
    if (request.method() !== 'GET') return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Private source-bound sound qualification</title>' });
    const bytes = snapshot.get(url.pathname); if (!bytes) return route.abort(); return route.fulfill({ contentType: url.pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body: bytes });
  });
  await page.goto('http://127.0.0.1:8138/');
  const report = await page.evaluate(async ({ source, traces, artifacts, applicationBuildId, options }) => {
    const { describeNativeInstrumentEngines } = await import('/js/app/midi-ui/NativeInstrumentSchema.js');
    const { compileSoundContent } = await import('/js/midi/content/SoundContentCompiler.js');
    const { createSoundQualificationPlan } = await import('/js/midi/qualification/SoundQualificationPlan.js');
    const { createSharedSoundQualificationRenderer } = await import('/js/midi/qualification/SharedSoundQualificationRenderer.js');
    const { runSoundQualification } = await import('/js/midi/qualification/SoundQualificationRunner.js');
    const { canonicalDataText } = await import('/js/core/CanonicalData.js');
    const descriptors = await describeNativeInstrumentEngines(artifacts), compiled = await compileSoundContent(source, { targets: descriptors.map(descriptor => ({ descriptor })) });
    const patch = compiled.prepared.patches.find(value => value.definition.id === options.patch); if (!patch) throw new Error('Selected patch is not a compiled concrete recipe.');
    const descriptor = descriptors.find(value => value.engineId === patch.definition.engineId), plan = await createSoundQualificationPlan({ definition: patch.archivedDefinition, descriptor, applicationBuildId, traces,
      ...(options['sample-rates'] ? { sampleRates: options['sample-rates'].split(',').map(Number) } : {}), source: { packId: compiled.prepared.pack.id, packVersion: compiled.prepared.pack.version,
        contentHash: compiled.prepared.contentHash, patchIdentity: patch.definition.id + '@' + patch.definition.revision, definitionHash: patch.definitionHash, attribution: compiled.prepared.pack.attribution } });
    const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    const write = async ({ name, bytes, sha256 }) => { const response = await fetch('/artifact?name=' + encodeURIComponent(name) + '&sha256=' + sha256, { method: 'POST', body: bytes }); if (!response.ok) throw new Error('Artifact publication rejected: ' + await response.text()); return response.json(); };
    const planBytes = canonicalDataText(plan, { maxBytes: 16 * 1048576, maxNodes: 1048576 }).bytes; await write({ name: 'plan.json', bytes: planBytes, sha256: await digest(planBytes) });
    const renderer = createSharedSoundQualificationRenderer();
    try { return await runSoundQualification(plan, { renderer, writeArtifact: write, writeCase: async ({ id, row }) => { const bytes = canonicalDataText(row, { maxBytes: 262144, maxNodes: 32768 }).bytes; await write({ name: id.replace(':', '-') + '.json', bytes, sha256: await digest(bytes) }); },
      ...(options['maximum-cases'] ? { maximumCases: Number(options['maximum-cases']) } : {}), ...(options['maximum-render-seconds'] ? { maximumRenderSeconds: Number(options['maximum-render-seconds']) } : {}),
      ...(options['maximum-output-bytes'] ? { maximumOutputBytes: Number(options['maximum-output-bytes']) } : {}) }); }
    finally { if (!renderer.diagnostics().blocked && !renderer.diagnostics().active) { const receipt = renderer.dispose(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Qualification renderer retirement unresolved.'); } }
  }, { source, traces, artifacts, applicationBuildId, options });
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ report, environment, browserErrors: errors }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ reportHash: report.reportHash, state: report.state, coverage: report.coverage, acceptance: report.acceptance, directory: path.relative(root, output) }, null, 2));
  if (errors.length || !report.coverage.complete || report.acceptance.technicalFailures) process.exitCode = 1;
} finally { await context?.close(); await browser.close(); }
