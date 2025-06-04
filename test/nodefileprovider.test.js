import assert from 'assert';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/BinaryReader.js';

global.lemmings = { game: { showDebug: false } };

describe('NodeFileProvider', function () {
  const base = 'test/fixtures';

  const rarBase64 =
    'UmFyIRoHAQAzkrXlCgEFBgAFAQGAgAAF1NtyLwIDC4YABIYApIMCIDA6NoAAARFwbGFpbkRpci9maWxlLnR4dAoDEy94QGh0QRkSaGVsbG8K8eZhyCACAwsAAQDtgwGAAAEIcGxhaW5EaXIKAxMveEBodEEZEh13VlEDBQQA';

  before(async function () {
    const zip = new AdmZip();
    zip.addLocalFile(path.join(base, 'plainDir/file.txt'), 'plainDir');
    zip.writeZip(path.join(base, 'zipfile.zip'));

    await tar.c({ gzip: true, file: path.join(base, 'tarfile.tar.gz'), cwd: base }, ['plainDir/file.txt']);

    fs.writeFileSync(path.join(base, 'rarfile.rar'), Buffer.from(rarBase64, 'base64'));
  });

  after(function () {
    fs.unlinkSync(path.join(base, 'zipfile.zip'));
    fs.unlinkSync(path.join(base, 'tarfile.tar.gz'));
    fs.unlinkSync(path.join(base, 'rarfile.rar'));
  });

  it('loads from plain directory', async function () {
    const provider = new NodeFileProvider('.');
    const text = await provider.loadString(`${base}/plainDir/file.txt`);
    assert.strictEqual(text.trim(), 'hello');
  });

  it('loads from zip archive', async function () {
    const provider = new NodeFileProvider('.');
    const text = await provider.loadString(`${base}/zipfile.zip/plainDir/file.txt`);
    assert.strictEqual(text.trim(), 'hello');
  });

  it('loads from tar.gz archive', async function () {
    const provider = new NodeFileProvider('.');
    const text = await provider.loadString(`${base}/tarfile.tar.gz/plainDir/file.txt`);
    assert.strictEqual(text.trim(), 'hello');
  });

  it('loads from rar archive', async function () {
    const provider = new NodeFileProvider('.');
    const text = await provider.loadString(`${base}/rarfile.rar/plainDir/file.txt`);
    assert.strictEqual(text.trim(), 'hello');
  });

  it('caches archive objects', async function () {
    const provider = new NodeFileProvider('.');
    await provider.loadString(`${base}/zipfile.zip/plainDir/file.txt`);
    await provider.loadString(`${base}/tarfile.tar.gz/plainDir/file.txt`);
    await provider.loadString(`${base}/rarfile.rar/plainDir/file.txt`);

    assert.strictEqual(provider.zipCache.size, 1);
    assert.strictEqual(provider.tarCache.size, 1);
    assert.strictEqual(provider.rarCache.size, 1);

    const z1 = provider._getZip(`${base}/zipfile.zip`);
    const z2 = provider._getZip(`${base}/zipfile.zip`);
    assert.strictEqual(z1, z2);
    const t1 = await provider._getTar(`${base}/tarfile.tar.gz`);
    const t2 = await provider._getTar(`${base}/tarfile.tar.gz`);
    assert.strictEqual(t1, t2);
    const r1 = await provider._getRar(`${base}/rarfile.rar`);
    const r2 = await provider._getRar(`${base}/rarfile.rar`);
    assert.strictEqual(r1, r2);
  });

  it('sanitizes entry paths', function () {
    const provider = new NodeFileProvider('.');
    assert.throws(() => provider._validateEntry('../bad'));
    assert.throws(() => provider._validateEntry('/abs'));
    assert.strictEqual(provider._validateEntry('sub\\name'), 'sub/name');
  });
});
