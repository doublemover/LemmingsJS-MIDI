import { expect } from 'chai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { discoverRuntimeDependencies } from '../scripts/RuntimeSourceClosure.js';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
describe('ProcGen resource entry and optional runtime graph', function() {
  this.timeout(15000);
  it('keeps classic view/editor and E2E execution outside the static instrument entry', async () => {
    const pending = ['js/app/procgenBoot.js'], files = new Set();
    while (pending.length) {
      const name = pending.pop(); if (files.has(name)) continue; files.add(name);
      const source = await fs.readFile(path.join(rootDir, name), 'utf8');
      if (!name.endsWith('.js')) continue;
      const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
      for (const node of tree.statements) if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
        pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name), node.moduleSpecifier.text)));
      }
    }
    for (const name of ['js/app/bootstrap.js', 'js/game/GameView.js', 'js/game/game-view/GameViewCore.js', 'js/editor/EditorLevelLoader.js', 'js/editor/EditorSession.js', 'js/app/e2eHarness.js']) expect(files.has(name), name).to.equal(false);
    expect([...files].filter(name => name.startsWith('js/app/e2e/'))).to.deep.equal([]);
    expect(files.has('js/app/procgen/ProcgenResourceFactory.js')).to.equal(true);
    expect(files.has('js/game/GameFactory.js')).to.equal(true);
    for (const name of ['RectangularMembraneView', 'SpectralFreezeView', 'TravelColorationView', 'CrossExcitationView', 'QuarryEchoView', 'SoundContentLibrary', 'ShapeFoundryView']) expect(files.has('js/app/midi-ui/' + name + '.js'), name).to.equal(false);
  });
  it('declares deferred entries to the existing source-bound packager', async () => {
    const entry = 'js/app/procgenBoot.js', source = await fs.readFile(path.join(rootDir, entry), 'utf8');
    const files = new Set(discoverRuntimeDependencies(entry, source).map(value => path.posix.normalize(path.posix.join(path.posix.dirname(entry), value))));
    for (const name of ['js/app/bootstrap.js', 'js/game/GameView.js', 'js/editor/EditorLevelLoader.js', 'js/app/e2eHarness.js', 'js/app/procgen/ProcgenResourceFactory.js']) expect(files.has(name), name).to.equal(true);
    const controller = 'js/app/procgen/workstation/ProcgenWorkstation.js';
    const toolEntries = new Set(discoverRuntimeDependencies(controller, await fs.readFile(path.join(rootDir, controller), 'utf8')));
    for (const name of ['RectangularMembraneView', 'SpectralFreezeView', 'TravelColorationView', 'CrossExcitationView', 'QuarryEchoView', 'SoundContentLibrary', 'ShapeFoundryView']) expect(toolEntries.has('../../midi-ui/' + name + '.js'), name).to.equal(true);
    const loader = 'js/app/procgen/DeferredWebMidi.js';
    expect(discoverRuntimeDependencies(loader, await fs.readFile(path.join(rootDir, loader), 'utf8'))).to.include('../../vendor/webmidi.js');
    expect(await fs.readFile(path.join(rootDir, 'procgen.html'), 'utf8')).not.to.include('src="js/vendor/webmidi.js"');
  });
});
