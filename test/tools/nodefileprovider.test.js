import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { NodeFileProvider } from '../../tools/NodeFileProvider.js';

const expectReject = async (promise, message) => {
  let err = null;
  try {
    await promise;
  } catch (error) {
    err = error;
  }
  expect(err).to.be.instanceof(Error);
  if (message) expect(err.message).to.match(message);
};

describe('NodeFileProvider', function() {
  let tmpDir;

  beforeEach(async function() {
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'test', 'tmp-nodefileprovider-'));
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'plain.txt'), 'plain');

    fs.writeFileSync(path.join(tmpDir, 'data', 'hello.txt'), 'zip hello');
    const zip = new AdmZip();
    zip.addFile('data/hello.txt', Buffer.from('zip hello'));
    zip.writeZip(path.join(tmpDir, 'pack.zip'));

    fs.writeFileSync(path.join(tmpDir, 'data', 'hello.txt'), 'tar hello');
    await tar.c({ file: path.join(tmpDir, 'pack.tar'), cwd: tmpDir }, ['data/hello.txt']);
  });

  afterEach(function() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads plain files and archive entries', async function() {
    const provider = new NodeFileProvider(tmpDir);

    const plain = await provider.loadBinary('.', 'plain.txt');
    expect(plain.readAll()).to.equal('plain');

    const zipReader = await provider.loadBinary('pack.zip', 'data/hello.txt');
    expect(zipReader.readAll()).to.equal('zip hello');

    const tarReader = await provider.loadBinary('pack.tar', 'data/hello.txt');
    expect(tarReader.readAll()).to.equal('tar hello');
  });

  it('loads archive strings and validates entries', async function() {
    const provider = new NodeFileProvider(tmpDir);

    const zipText = await provider.loadString('pack.zip/data/hello.txt');
    expect(zipText).to.equal('zip hello');

    const tarText = await provider.loadString('pack.tar/hello.txt');
    expect(tarText).to.equal('tar hello');

    expect(() => provider._validateEntry('../evil.txt')).to.throw();
  });

  it('loads rar entries using a stubbed extractor', async function() {
    const provider = new NodeFileProvider(tmpDir);
    provider._getRar = async () => new Map([
      ['data/hello.txt', Buffer.from('rar hello')]
    ]);

    const reader = await provider.loadBinary('pack.rar', 'HELLO.TXT');
    expect(reader.readAll()).to.equal('rar hello');
  });

  it('throws when archive entries are missing', async function() {
    const provider = new NodeFileProvider(tmpDir);
    provider._getRar = async () => new Map();

    await expectReject(
      provider.loadString('pack.rar/missing.txt'),
      /not found/i
    );
  });
});
