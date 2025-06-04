import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';

import { NodeFileProvider } from '../tools/NodeFileProvider.js';

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
});
