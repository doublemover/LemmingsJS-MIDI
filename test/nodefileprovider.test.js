import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

import { spawnSync } from 'child_process';
import * as tar from 'tar';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { archiveDir } from '../tools/archiveDir.js';
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
});
