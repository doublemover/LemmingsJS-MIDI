import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildBundle,
  createCopyList,
  parseArgs,
  resolveSurfaceFile
} from '../scripts/build-mcpb-bundle.js';

const withTempDir = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-bundle-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('build-mcpb-bundle helpers', function () {
  it('parses and validates surface arguments', function () {
    expect(parseArgs(['--surface=EDITOR'])).to.deep.equal({ surface: 'editor' });
    expect(parseArgs(['--surface', 'game'])).to.deep.equal({ surface: 'game' });
    expect(() => parseArgs(['--surface'])).to.throw(/Missing value for --surface/);
    expect(() => parseArgs(['--surface='])).to.throw(/Missing value for --surface/);
    expect(() => parseArgs(['--surface=bad'])).to.throw(/Invalid surface/);
  });

  it('resolves candidate files for surface bundles', function () {
    expect(resolveSurfaceFile(null, 'manifest', 'mcpb/manifest.json')).to.deep.equal({
      candidate: null,
      fallbackPath: 'mcpb/manifest.json'
    });
    expect(resolveSurfaceFile('editor', 'manifest', 'mcpb/manifest.json')).to.deep.equal({
      candidate: 'mcpb/manifest.editor.json',
      fallbackPath: 'mcpb/manifest.json'
    });
    const copyList = createCopyList('editor');
    expect(copyList[0].candidate).to.equal('mcpb/manifest.editor.json');
    expect(copyList[3].candidate).to.equal('mcpb/package.editor.json');
  });

  it('builds surface bundles using candidate files with fallback support', async function () {
    await withTempDir(async (rootDir) => {
      fs.mkdirSync(path.join(rootDir, 'mcpb'), { recursive: true });
      fs.mkdirSync(path.join(rootDir, 'mcp'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'mcpb', 'manifest.json'), '{"name":"fallback-manifest"}');
      fs.writeFileSync(path.join(rootDir, 'mcpb', 'manifest.editor.json'), '{"name":"editor-manifest"}');
      fs.writeFileSync(path.join(rootDir, 'mcpb', 'package.json'), '{"name":"fallback-package"}');
      fs.writeFileSync(path.join(rootDir, 'mcpb', 'package.editor.json'), '{"name":"editor-package"}');
      fs.writeFileSync(path.join(rootDir, 'mcpb', 'server.json'), '{"server":true}');
      fs.writeFileSync(path.join(rootDir, 'mcpb', '.mcpbignore'), 'node_modules');
      fs.writeFileSync(path.join(rootDir, 'keybindings.json'), '{"ok":true}');
      fs.writeFileSync(path.join(rootDir, 'mcp', 'server.js'), 'export {}');

      await buildBundle({
        argv: ['--surface=editor'],
        rootDir,
        log: { log() {} }
      });

      const outDir = path.join(rootDir, 'dist', 'mcpb-editor');
      expect(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8')).to.equal('{"name":"editor-manifest"}');
      expect(fs.readFileSync(path.join(outDir, 'package.json'), 'utf8')).to.equal('{"name":"editor-package"}');

      await buildBundle({
        argv: ['--surface=interact'],
        rootDir,
        log: { log() {} }
      });
      const interactOutDir = path.join(rootDir, 'dist', 'mcpb-interact');
      expect(fs.readFileSync(path.join(interactOutDir, 'manifest.json'), 'utf8')).to.equal('{"name":"fallback-manifest"}');
      expect(fs.readFileSync(path.join(interactOutDir, 'package.json'), 'utf8')).to.equal('{"name":"fallback-package"}');
    });
  });
});
