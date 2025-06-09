import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

import { spawnSync } from 'child_process';
import * as tar from 'tar';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { archiveDir } from '../tools/archiveDir.js';
import { createExtractorFromData } from 'node-unrar-js';
import '../js/BinaryReader.js';

const rarCheck = spawnSync('rar', ['--version'], { stdio: 'ignore' });
const hasRar = !rarCheck.error;

describe('NodeFileProvider', function () {
  it('re-reads archives after clearCache', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-'));
    const zipPath = path.join(dir, 'test.zip');
    const writeZip = text => {
      const zip = new AdmZip();
      zip.addFile('foo.txt', Buffer.from(text, 'utf8'));
      zip.writeZip(zipPath);
    };

    writeZip('one');
    const provider = new NodeFileProvider(dir);
    let out = await provider.loadString('test.zip/foo.txt');
    assert.strictEqual(out, 'one');

    writeZip('two');
    out = await provider.loadString('test.zip/foo.txt');
    assert.strictEqual(out, 'one');

    provider.clearCache();
    out = await provider.loadString('test.zip/foo.txt');
    assert.strictEqual(out, 'two');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('re-reads tar.gz and rar archives after clearCache', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-'));
    const sample = path.join(dir, 'sample');
    fs.mkdirSync(sample);
    const tarPath = path.join(dir, 'test.tar.gz');
    const writeTar = async text => {
      fs.writeFileSync(path.join(sample, 'foo.txt'), text, 'utf8');
      await tar.c({ gzip: true, cwd: sample, file: tarPath }, ['foo.txt']);
    };
    await writeTar('one');
    if (hasRar) {
      await archiveDir(sample, 'rar');
    }
    const provider = new NodeFileProvider(dir);

    let out = await provider.loadString('test.tar.gz/foo.txt');
    assert.strictEqual(out, 'one');
    if (hasRar) {
      const r = await provider.loadString('sample.rar/foo.txt');
      assert.strictEqual(r, 'one');
    }

    await writeTar('two');
    if (hasRar) {
      await archiveDir(sample, 'rar');
    }
    out = await provider.loadString('test.tar.gz/foo.txt');
    assert.strictEqual(out, 'one');
    if (hasRar) {
      const r = await provider.loadString('sample.rar/foo.txt');
      assert.strictEqual(r, 'one');
    }

    provider.clearCache();
    out = await provider.loadString('test.tar.gz/foo.txt');
    assert.strictEqual(out, 'two');
    if (hasRar) {
      const r = await provider.loadString('sample.rar/foo.txt');
      assert.strictEqual(r, 'two');
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('archive reading', function () {
    const text = 'hello world';
    const binData = Uint8Array.from([1, 2, 3, 4]);
    let dir;
    let provider;
    before(async function () {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-'));
      const sample = path.join(dir, 'sample');
      fs.mkdirSync(sample);
      fs.writeFileSync(path.join(sample, 'file.txt'), text, 'utf8');
      fs.writeFileSync(path.join(sample, 'file.bin'), binData);

      const zip = new AdmZip();
      zip.addLocalFolder(sample, 'sample');
      zip.writeZip(path.join(dir, 'sample.zip'));

      await tar.c({ gzip: true, cwd: path.dirname(sample), file: path.join(dir, 'sample.tar.gz') }, ['sample']);

      if (hasRar) {
        await archiveDir(sample, 'rar');
      }

      provider = new NodeFileProvider(dir);
    });

    after(function () {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    for (const ext of ['zip', 'tar.gz', 'rar']) {
      it(`loads from ${ext}`, async function () {
        if (ext === 'rar' && !hasRar) this.skip();
        const br = await provider.loadBinary(`sample.${ext}`, 'file.bin');
        await br.ready;
        assert.deepStrictEqual(Array.from(br.data), Array.from(binData));

        const str = await provider.loadString(`sample.${ext}/file.txt`);
        assert.strictEqual(str, text);
      });

      it(`rejects absolute entry paths for ${ext}`, async function () {
        if (ext === 'rar' && !hasRar) this.skip();
        await assert.rejects(provider.loadBinary(`sample.${ext}`, '/abs.txt'));
        await assert.rejects(provider.loadString(`sample.${ext}//abs.txt`));
      });
    }
  });

  it('calls node-unrar-js with resolved paths', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-'));
    const data = Uint8Array.from([9, 8, 7]);
    let seen = null;
    class MockProvider extends NodeFileProvider {
      async _getRar(rarPath) {
        seen = path.resolve(this.rootPath, rarPath);
        return new Map([['foo.txt', Buffer.from(data)]]);
      }
    }
    const provider = new MockProvider(dir);
    const br = await provider.loadBinary('pack.rar', 'foo.txt');
    await br.ready;
    assert.deepStrictEqual(Array.from(br.data), Array.from(data));
    assert.strictEqual(seen, path.resolve(dir, 'pack.rar'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loadString decodes buffers returned from _getRar', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-rar-'));
    let seen = null;
    class MockProvider extends NodeFileProvider {
      async _getRar(rarPath) {
        seen = path.resolve(this.rootPath, rarPath);
        return new Map([['foo.txt', Buffer.from('bar')]]);
      }
    }
    const provider = new MockProvider(dir);
    const str = await provider.loadString('pack.rar/foo.txt');
    assert.strictEqual(str, 'bar');
    assert.strictEqual(seen, path.resolve(dir, 'pack.rar'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loadString reads regular files outside archives', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-file-'));
    const file = path.join(dir, 'plain.txt');
    fs.writeFileSync(file, 'hello');
    const provider = new NodeFileProvider('.');
    const result = await provider.loadString(file);
    assert.strictEqual(result, 'hello');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('nested rar archives', function () {
    const NESTED_RAR_BASE64 =
      'UmFyIRoHAQAzkrXlCgEFBgAFAQGAgAAxjDKDLQIDC9EABNEApIMCwa2wAoAAAQ9vdXRlci9pbm5lci5y' +
      'YXIKAxP0xURonbd2BVJhciEaBwEAM5K15QoBBQYABQEBgIAAwyhVFScCAwuGAASGAKSDAoxNAtCAAAEJ' +
      'aW5uZXIudHh0CgMT9MVEaB0qpgFpbm5lcgodd1ZRAwUEAEiIFwQtAgMLhgAEhgCkgwIgMDo2gAABD291' +
      'dGVyL2hlbGxvLnR4dAoDE/TFRGjFrjkFaGVsbG8K54su8x0CAwsAAQDtgwGAAAEFb3V0ZXIKAxP0xURo' +
      'nbd2BR13VlEDBQQA';
    let dir;
    let provider;
    before(async function () {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-nested-'));
      fs.writeFileSync(path.join(dir, 'outer.rar'), Buffer.from(NESTED_RAR_BASE64, 'base64'));
      provider = new NodeFileProvider(dir);
    });
    after(function () {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reads files from nested rar', async function () {
      const br = await provider.loadBinary('outer.rar', 'outer/inner.rar');
      await br.ready;
      const extractor = await createExtractorFromData({ data: br.data });
      const res = extractor.extract({ files: ['inner.txt'] });
      const file = [...res.files][0];
      assert.strictEqual(Buffer.from(file.extraction).toString(), 'inner\n');
    });

    it('fails on missing archive', async function () {
      await assert.rejects(provider.loadBinary('missing.rar', 'foo.txt'));
    });

    it('fails on missing entry', async function () {
      await assert.rejects(provider.loadBinary('outer.rar', 'nope.txt'));
    });
  });

  it('handles path separators', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfp-path-'));
    const zip = new AdmZip();
    zip.addFile('bar.txt', Buffer.from('x', 'utf8'));
    zip.writeZip(path.join(dir, 'p.zip'));
    const provider = new NodeFileProvider(dir);
    const a = await provider.loadString('p.zip/bar.txt');
    const b = await provider.loadString('p.zip\\bar.txt');
    assert.strictEqual(a, b);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('_validateEntry rejects absolute or parent paths', function () {
    const provider = new NodeFileProvider('.');
    expect(() => provider._validateEntry('/abs.txt')).to.throw();
    expect(() => provider._validateEntry('..\\foo')).to.throw();
  });

  it('_findZipEntry matches case-insensitively', function () {
    const zip = new AdmZip();
    zip.addFile('Folder/FILE.TXT', Buffer.from('x'));
    const provider = new NodeFileProvider('.');
    const entry = provider._findZipEntry(zip, 'file.txt');
    expect(entry).to.be.an('object');
  });
});
