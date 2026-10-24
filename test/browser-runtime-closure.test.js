import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectBrowserRuntimeClosure } from '../scripts/BrowserRuntimeClosure.js';

describe('browser executable and resource closure inventory', () => {
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-browser-closure-'));
    const files = { 'index.html': '<link rel="stylesheet" href="css/shell.css"><script type="module" src="js/entry.js"></script>',
      'js/entry.js': 'export { value } from "./leaf.js"; export const load = () => import("./optional.js");',
      'js/leaf.js': 'export const value = 1;', 'js/optional.js': 'export const data = new URL("../assets/data.json", import.meta.url);',
      'js/runtime/ActiveExecutionIdentity.js': 'export const identity = null;',
      'js/runtime/BrowserBuildManifest.js': 'export const schema = "fixture";',
      'js/runtime/BrowserGenerationService.js': 'export const service = "fixture";',
      'js/runtime/BrowserGenerationClient.js': 'export const client = "fixture";',
      'css/shell.css': '@import "./panel.css"; .icon { background: url("../assets/icon.svg"); }', 'css/panel.css': '.panel { display: block; }',
      'config.json': '[{"path":"classic"}]', 'keybindings.json': '{}', 'site.webmanifest': '{}', 'provenance/runtime-artifacts.json': '{"version":1}',
      'assets/data.json': '{}', 'assets/icon.svg': '<svg/>', 'classic/MAIN.DAT': 'fixture' };
    for (const [file, source] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), source); }
  });
  afterEach(async () => {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('lemmings-browser-closure-')) throw new Error('Unexpected closure fixture cleanup target.');
    await fs.rm(root, { recursive: true, force: true });
  });
  const collect = () => collectBrowserRuntimeClosure({ rootDir: root, routes: ['index.html'], inventory: ['classic/MAIN.DAT'] });
  it('includes static/dynamic executable dependencies and required CSS/data resources', async () => {
    const first = await collect();
    expect(first.files.map(file => file.path)).to.include.members(['js/entry.js', 'js/leaf.js', 'js/optional.js', 'assets/data.json', 'css/panel.css', 'assets/icon.svg', 'classic/MAIN.DAT']);
    expect(first.executionQualification).to.equal('artifact-inventory-only-until-generated-immutable-entry-executes');
    expect((await collect()).closureDigest).to.equal(first.closureDigest);
    await fs.writeFile(path.join(root, 'js/leaf.js'), 'export const value = 2;');
    expect((await collect()).closureDigest).not.to.equal(first.closureDigest);
  });
  it('refuses a missing transitive module, missing style resource and computed import', async () => {
    await fs.unlink(path.join(root, 'js/leaf.js'));
    let error; try { await collect(); } catch (failure) { error = failure; } expect(error.code).to.equal('ENOENT');
    await fs.writeFile(path.join(root, 'js/leaf.js'), 'export const value = 1;');
    await fs.unlink(path.join(root, 'assets/icon.svg'));
    try { await collect(); } catch (failure) { error = failure; } expect(error.code).to.equal('ENOENT');
    await fs.writeFile(path.join(root, 'assets/icon.svg'), '<svg/>'); await fs.writeFile(path.join(root, 'js/entry.js'), 'export const load = name => import(name);');
    try { await collect(); } catch (failure) { error = failure; } expect(error.message).to.include('explicit packaging contract');
  });
});
