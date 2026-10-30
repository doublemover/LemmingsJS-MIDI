import { OWNED_STRETCH_CORE } from '../js/midi/content/OwnedStretchCoreIdentity.js';
import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { verifyBrowserBuildManifest, computeBrowserBuildIdentity, renderBrowserBuildIdentity } from '../js/runtime/BrowserBuildManifest.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
describe('immutable browser generation staging', () => {
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-browser-build-'));
    const files = { 'index.html': '<script type="module" src="js/entry.js"></script>',
      'editor.html': '<script type="module" src="js/entry.js"></script>', 'procgen.html': '<script type="module" src="js/entry.js"></script>',
      'procgen-survey.html': '<script type="module" src="js/entry.js"></script>',
      'js/entry.js': 'export { getActiveExecutionIdentity } from "./runtime/ActiveExecutionIdentity.js";',
      'js/app/procgen/survey/ProcgenSurveyCanonical.js': 'export const SURVEY_STATE_SCHEMA = 3;',
      'config.json': '[{"path":"classic"}]', 'classic/MAIN.DAT': 'fixture', 'keybindings.json': '{}',
      'site.webmanifest': '{}', 'provenance/runtime-artifacts.json': JSON.stringify({ version: 1,
        selectedBackends: { browserMidi: 'fixture', nativeUmp: 'fixture', audioRuntime: 'fixture', optionalAudioBank: 'fixture' }, workerSources: [], components: [] }) };
    for (const [file, source] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), source); }
    for (const file of ['js/runtime/ActiveExecutionIdentity.js', 'js/runtime/BrowserBuildManifest.js', 'js/runtime/BrowserGenerationService.js',
      'js/runtime/BrowserGenerationClient.js', 'js/runtime/BrowserGenerationPins.js', 'js/runtime/InstrumentArtifactManifest.js', 'js/core/CanonicalData.js', 'scripts/BrowserRuntimeBuild.js',
      'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js', 'scripts/RuntimeProvenance.js', 'scripts/InstrumentArtifactClosure.js']) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.copyFile(path.join(repo, file), path.join(root, file));
    }
  });
  afterEach(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('lemmings-browser-build-')) throw new Error('Unexpected build fixture cleanup target.');
    await fs.rm(root, { recursive: true, force: true });
  });
  const build = () => buildBrowserRuntime({ rootDir: root, inventory: ['classic/MAIN.DAT'] });
  it('refuses a foreign prepared core before staging or replacing a browser generation', async () => {
    const target = path.join(root, OWNED_STRETCH_CORE.cachePath); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, new Uint8Array(OWNED_STRETCH_CORE.wasmBytes));
    let error; try { await build(); } catch (caught) { error = caught; } expect(error?.message).to.include('pinned byte identity'); expect((await fs.readFile(target)).byteLength).to.equal(OWNED_STRETCH_CORE.wasmBytes);
    expect(await fs.stat(path.join(root, 'dist', 'browser')).then(() => true, () => false)).to.equal(false);
  });
  it('reproduces one immutable namespace and records actual generated carrier bytes separately from its normalized source', async () => {
    const first = await build(), repeat = await build();
    expect(repeat.buildId).to.equal(first.buildId); expect(first.path).to.equal(path.join(root, 'dist', 'browser', first.buildId));
    expect(first).to.include({ offlineInstallation: 'not-installed', activeExecution: 'entry-not-executed' });
    expect(await fs.readFile(path.join(root, 'dist/browser/service-worker.js'), 'utf8')).to.include('./' + first.buildId + '/js/runtime/BrowserGenerationService.js');
    expect(await fs.readFile(first.entryPath, 'utf8')).to.include('startBrowserGenerationEntry');
    const carrier = await fs.readFile(path.join(first.path, 'js/runtime/ActiveExecutionIdentity.js'));
    const expected = first.manifest.files.find(file => file.path === 'js/runtime/ActiveExecutionIdentity.js');
    expect(createHash('sha256').update(carrier).digest('hex')).to.equal(expected.sha256);
    expect(carrier.toString()).to.include(first.buildId); expect(expected.sha256).not.to.equal(first.manifest.sourceNormalization.templateSha256);
    const template = await fs.readFile(path.join(first.path, first.manifest.sourceNormalization.templatePath), 'utf8');
    expect((await verifyBrowserBuildManifest(first.manifest, { expectedBuildId: first.buildId, template })).templateVerified).to.equal(true);
    await fs.writeFile(path.join(root, 'classic/MAIN.DAT'), 'new fixture');
    const changed = await build(); expect(changed.buildId).not.to.equal(first.buildId);
    expect(await fs.readFile(path.join(first.path, 'classic/MAIN.DAT'), 'utf8')).to.equal('fixture');
  });
  it('refuses to overwrite changed bytes under an existing build identity', async () => {
    const first = await build(); await fs.writeFile(path.join(first.path, 'js/entry.js'), 'changed');
    let error; try { await build(); } catch (failure) { error = failure; }
    expect(error.message).to.include('immutable browser generation has changed bytes');
    expect(await fs.readFile(path.join(first.path, 'js/entry.js'), 'utf8')).to.equal('changed');
  });
  it('rejects inventory tampering and a generated carrier hidden behind an unchanged normalized slot', async () => {
    const first = await build(), template = await fs.readFile(path.join(first.path, first.manifest.sourceNormalization.templatePath), 'utf8');
    const tampered = structuredClone(first.manifest); tampered.files.find(file => file.path === 'js/entry.js').sha256 = 'f'.repeat(64);
    let error; try { await verifyBrowserBuildManifest(tampered, { expectedBuildId: first.buildId, template }); } catch (failure) { error = failure; }
    expect(error.message).to.include('complete inventory');
    const forged = structuredClone(first.manifest), slot = forged.files.find(file => file.path === 'js/runtime/ActiveExecutionIdentity.js');
    slot.sha256 = 'e'.repeat(64);
    try { await verifyBrowserBuildManifest(forged, { expectedBuildId: first.buildId, template }); } catch (failure) { error = failure; }
    expect(error.message).to.include('carrier does not follow');
  });
  it('accepts a pinned three-route v1 generation while binding route claims to its file inventory', async () => {
    const first = await build(), template = await fs.readFile(path.join(first.path, first.manifest.sourceNormalization.templatePath), 'utf8');
    const legacy = structuredClone(first.manifest);
    legacy.recipe = legacy.recipe.slice(0, 3);
    delete legacy.instrumentArtifacts; delete legacy.instrumentArtifactProfiles;
    legacy.files = legacy.files.filter(file => file.path !== 'procgen-survey.html');
    legacy.routes = legacy.routes.filter(route => route !== 'procgen-survey.html');
    const normalized = legacy.files.map(file => file.path === legacy.sourceNormalization.path ?
      { path: file.path, bytes: Buffer.byteLength(template), sha256: legacy.sourceNormalization.templateSha256 } : file);
    const identity = await computeBrowserBuildIdentity(normalized, legacy.recipe);
    Object.assign(legacy, identity);
    const carrier = Buffer.from(renderBrowserBuildIdentity(template, identity));
    Object.assign(legacy.files.find(file => file.path === legacy.sourceNormalization.path),
      { bytes: carrier.byteLength, sha256: createHash('sha256').update(carrier).digest('hex') });
    legacy.sourceBytes = legacy.files.reduce((total, file) => total + file.bytes, 0);
    expect((await verifyBrowserBuildManifest(legacy, { template })).templateVerified).to.equal(true);
    for (const routes of [first.manifest.routes.slice(0, 3), [...legacy.routes, 'procgen.html'], [...legacy.routes, 'other.html']]) {
      const invalid = structuredClone(first.manifest); invalid.routes = routes;
      let error; try { await verifyBrowserBuildManifest(invalid, { template }); } catch (failure) { error = failure; }
      expect(error).to.be.instanceOf(Error);
    }
  });
  it('refuses unreviewed vendored content before publishing an installer', async () => {
    await fs.mkdir(path.join(root, 'js/vendor'), { recursive: true }); await fs.writeFile(path.join(root, 'js/vendor/unreviewed.js'), 'export const unreviewed = true;');
    let error; try { await build(); } catch (failure) { error = failure; }
    expect(error.message).to.include('unlisted vendored file');
    let published = false; try { await fs.stat(path.join(root, 'dist/browser/index.html')); published = true; } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    expect(published).to.equal(false);
  });
});
