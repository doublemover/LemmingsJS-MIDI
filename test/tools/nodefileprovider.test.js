import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { fileURLToPath } from 'url';
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

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packFile = path.join(rootDir, 'lemmings', 'LEVEL000.DAT');

describe('NodeFileProvider', function() {
  let tmpDir;

  beforeEach(async function() {
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'test', 'tmp-nodefileprovider-'));
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    fs.copyFileSync(packFile, path.join(tmpDir, 'LEVEL000.DAT'));
    fs.copyFileSync(packFile, path.join(tmpDir, 'data', 'LEVEL000.DAT'));
    const zip = new AdmZip();
    zip.addFile('data/LEVEL000.DAT', fs.readFileSync(packFile));
    zip.writeZip(path.join(tmpDir, 'pack.zip'));
    await tar.c({ file: path.join(tmpDir, 'pack.tar'), cwd: tmpDir }, ['data/LEVEL000.DAT']);
  });

  afterEach(function() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads plain files and archive entries', async function() {
    const provider = new NodeFileProvider(tmpDir);

    const buffer = fs.readFileSync(packFile);
    const plain = await provider.loadBinary('.', 'LEVEL000.DAT');
    expect(plain.length).to.equal(buffer.length);
    plain.setOffset(0);
    expect(plain.readByte()).to.equal(buffer[0]);

    const zipReader = await provider.loadBinary('pack.zip', 'data/LEVEL000.DAT');
    expect(zipReader.length).to.equal(buffer.length);

    const tarReader = await provider.loadBinary('pack.tar', 'data/LEVEL000.DAT');
    expect(tarReader.length).to.equal(buffer.length);
  });

  it('loads archive strings and validates entries', async function() {
    const provider = new NodeFileProvider(tmpDir);

    const zipText = await provider.loadString('pack.zip/data/LEVEL000.DAT');
    expect(zipText.length).to.be.greaterThan(0);

    const tarText = await provider.loadString('pack.tar/LEVEL000.DAT');
    expect(tarText.length).to.be.greaterThan(0);

    expect(() => provider._validateEntry('../evil.txt')).to.throw();
  });

  it('loads rar entries using a stubbed extractor', async function() {
    const provider = new NodeFileProvider(tmpDir);
    provider._getRar = async () => new Map([
      ['data/LEVEL000.DAT', fs.readFileSync(packFile)]
    ]);

    const reader = await provider.loadBinary('pack.rar', 'LEVEL000.DAT');
    expect(reader.length).to.equal(fs.readFileSync(packFile).length);
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
