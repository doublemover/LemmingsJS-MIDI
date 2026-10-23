import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { verifyBrowserBuildManifest } from '../js/runtime/BrowserBuildManifest.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
describe('immutable browser generation staging', () => {
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-browser-build-'));
    const files = { 'index.html': '<script type="module" src="js/entry.js"></script>',
      'editor.html': '<script type="module" src="js/entry.js"></script>', 'procgen.html': '<script type="module" src="js/entry.js"></script>',
      'js/entry.js': 'export { getActiveExecutionIdentity } from "./runtime/ActiveExecutionIdentity.js";',
      'js/app/procgen/survey/ProcgenSurveyCanonical.js': 'export const SURVEY_STATE_SCHEMA = 3;',
      'config.json': '[{"path":"classic"}]', 'classic/MAIN.DAT': 'fixture', 'keybindings.json': '{}',
      'site.webmanifest': '{}', 'provenance/runtime-artifacts.json': '{}' };
    for (const [file, source] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), source); }
    for (const file of ['js/runtime/ActiveExecutionIdentity.js', 'js/runtime/BrowserBuildManifest.js', 'scripts/BrowserRuntimeBuild.js', 'scripts/BrowserRuntimeClosure.js', 'scripts/RuntimeSourceClosure.js']) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.copyFile(path.join(repo, file), path.join(root, file));
    }
  });
  afterEach(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('lemmings-browser-build-')) throw new Error('Unexpected build fixture cleanup target.');
    await fs.rm(root, { recursive: true, force: true });
  });
  const build = () => buildBrowserRuntime({ rootDir: root, inventory: ['classic/MAIN.DAT'] });
  it('reproduces one immutable namespace and records actual generated carrier bytes separately from its normalized source', async () => {
    const first = await build(), repeat = await build();
    expect(repeat.buildId).to.equal(first.buildId); expect(first.path).to.equal(path.join(root, 'dist', 'browser', first.buildId));
    expect(first).to.include({ offlineInstallation: 'not-installed', activeExecution: 'entry-not-executed' });
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
});
