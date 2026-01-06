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
  const makeProvider = (options) => new NodeFileProvider(tmpDir, options);
  const writeRarStub = () => {
    const rarPath = path.join(tmpDir, 'pack.rar');
    fs.writeFileSync(rarPath, Buffer.from([0]));
    return rarPath;
  };

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
    const provider = makeProvider();

    const buffer = fs.readFileSync(packFile);
    const plain = await provider.loadBinary('.', 'LEVEL000.DAT');
    expect(plain.length).to.equal(buffer.length);
    plain.setOffset(0);
    expect(plain.readByte()).to.equal(buffer[0]);

    const zipReader = await provider.loadBinary('pack.zip', 'data/LEVEL000.DAT');
    expect(zipReader.length).to.equal(buffer.length);

    const zipLower = await provider.loadBinary('pack.zip', 'data/level000.dat');
    expect(zipLower.length).to.equal(buffer.length);

    const tarReader = await provider.loadBinary('pack.tar', 'data/LEVEL000.DAT');
    expect(tarReader.length).to.equal(buffer.length);

    const tarLower = await provider.loadBinary('pack.tar', 'data/level000.dat');
    expect(tarLower.length).to.equal(buffer.length);
  });

  it('loads archive strings and validates entries', async function() {
    const provider = makeProvider();

    const zipText = await provider.loadString('pack.zip/data/LEVEL000.DAT');
    expect(zipText.length).to.be.greaterThan(0);

    const tarText = await provider.loadString('pack.tar/LEVEL000.DAT');
    expect(tarText.length).to.be.greaterThan(0);

    expect(() => provider._validateEntry('../evil.txt')).to.throw();        
  });

  it('throws when archive text entries are missing', async function() {
    const provider = makeProvider();
    await expectReject(
      provider.loadString('pack.zip/missing.txt'),
      /not found/i
    );
    await expectReject(
      provider.loadString('pack.tar/missing.txt'),
      /not found/i
    );
  });

  it('throws when archive binary entries are missing', async function() {
    const provider = makeProvider();
    await expectReject(
      provider.loadBinary('pack.zip', 'missing.dat'),
      /not found/i
    );
    await expectReject(
      provider.loadBinary('pack.tar', 'missing.dat'),
      /not found/i
    );
    provider._getRar = async () => new Map();
    await expectReject(
      provider.loadBinary('pack.rar', 'missing.dat'),
      /not found/i
    );
  });

  it('normalizes validated entry paths', function() {
    const provider = makeProvider();
    expect(provider._validateEntry('data\\LEVEL000.DAT')).to.equal('data/LEVEL000.DAT');
  });

  it('reads plain strings from disk', async function() {
    const provider = makeProvider();
    const textPath = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(textPath, 'hello');
    const text = await provider.loadString('note.txt');
    expect(text).to.equal('hello');
  });

  it('reads plain strings from absolute paths', async function() {
    const provider = makeProvider();
    const textPath = path.join(tmpDir, 'abs.txt');
    fs.writeFileSync(textPath, 'abs');
    const text = await provider.loadString(textPath);
    expect(text).to.equal('abs');
  });

  it('reads binary data from an absolute directory', async function() {
    const provider = makeProvider();
    const reader = await provider.loadBinary(tmpDir, 'LEVEL000.DAT');
    expect(reader.length).to.equal(fs.readFileSync(packFile).length);
  });

  it('caches zip and tar readers', async function() {
    const provider = makeProvider();
    const zip1 = provider._getZip('pack.zip');
    const zip2 = provider._getZip('pack.zip');
    expect(zip1).to.equal(zip2);

    const tar1 = await provider._getTar('pack.tar');
    const tar2 = await provider._getTar('pack.tar');
    expect(tar1).to.equal(tar2);
  });

  it('skips non-file tar entries', async function() {
    const provider = makeProvider();
    const emptyDir = path.join(tmpDir, 'emptydir');
    fs.mkdirSync(emptyDir, { recursive: true });
    await tar.c(
      { file: path.join(tmpDir, 'dir-only.tar'), cwd: tmpDir },
      ['emptydir']
    );
    const map = await provider._getTar('dir-only.tar');
    expect(map.size).to.equal(0);
  });

  it('loads rar entries using injected extractor', async function() {
    writeRarStub();
    let calls = 0;
    const provider = makeProvider({
      rar: {
        createExtractorFromData: async () => {
          calls += 1;
          return {
            getFileList() {
              return { fileHeaders: [{ name: 'data/LEVEL000.DAT', flags: { directory: false } }] };
            },
            extract() {
              return { files: [{ extraction: Buffer.from('abc') }] };
            }
          };
        }
      }
    });

    const reader = await provider.loadBinary('pack.rar', 'LEVEL000.DAT');
    expect(reader.length).to.equal(3);
    const text = await provider.loadString('pack.rar/LEVEL000.DAT');
    expect(text).to.equal('abc');

    await provider.loadBinary('pack.rar', 'LEVEL000.DAT');
    expect(calls).to.equal(1);
  });

  it('skips rar directory entries and finds lower-case keys', async function() {
    writeRarStub();
    const extracted = [];
    const provider = makeProvider({
      rar: {
        createExtractorFromData: async () => ({
          getFileList() {
            return {
              fileHeaders: [
                { name: 'data/', flags: { directory: true } },
                { name: 'data/LEVEL000.DAT', flags: { directory: false } }
              ]
            };
          },
          extract({ files }) {
            extracted.push(files);
            return { files: [{ extraction: Buffer.from('abc') }] };
          }
        })
      }
    });

    const map = await provider._getRar('pack.rar');
    expect(map.has('data/LEVEL000.DAT')).to.equal(true);
    expect(extracted).to.eql([['data/LEVEL000.DAT']]);

    const lowerMap = new Map([['data/level000.dat', Buffer.from('x')]]);
    const found = provider._findEntry(lowerMap, 'data/LEVEL000.DAT');
    expect(found).to.equal(lowerMap.get('data/level000.dat'));

    const exactMap = new Map([['data/LEVEL000.DAT', Buffer.from('y')]]);
    const exactFound = provider._findEntry(exactMap, 'data/LEVEL000.DAT');
    expect(exactFound).to.equal(exactMap.get('data/LEVEL000.DAT'));

    const nestedMap = new Map([['nested/data/level000.dat', Buffer.from('z')]]);
    const nestedFound = provider._findEntry(nestedMap, 'data/LEVEL000.DAT');
    expect(nestedFound).to.equal(nestedMap.get('nested/data/level000.dat'));
  });

  it('finds zip entries by exact and lower-case names', function() {
    const provider = makeProvider();
    const zip = provider._getZip('pack.zip');
    const entry = provider._findZipEntry(zip, 'data/LEVEL000.DAT');
    expect(entry).to.be.ok;
    const lowerEntry = provider._findZipEntry(zip, 'data/level000.dat');
    expect(lowerEntry).to.be.ok;
  });

  it('loads rar entries using a stubbed extractor', async function() {
    const provider = makeProvider();
    provider._getRar = async () => new Map([
      ['data/LEVEL000.DAT', fs.readFileSync(packFile)]
    ]);

    const reader = await provider.loadBinary('pack.rar', 'LEVEL000.DAT');
    expect(reader.length).to.equal(fs.readFileSync(packFile).length);
  });

  it('throws when archive entries are missing', async function() {
    const provider = makeProvider();
    provider._getRar = async () => new Map();

    await expectReject(
      provider.loadString('pack.rar/missing.txt'),
      /not found/i
    );
  });

  it('clears cached archives', async function() {
    const provider = makeProvider();
    provider._getZip('pack.zip');
    await provider._getTar('pack.tar');
    provider.rarCache.set('rar', new Map());
    provider.clearCache();
    expect(provider.zipCache.size).to.equal(0);
    expect(provider.tarCache.size).to.equal(0);
    expect(provider.rarCache.size).to.equal(0);
  });
});
