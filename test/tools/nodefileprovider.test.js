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
  const writeNxp = (nxpPath, entries) => {
    const tableEntrySize = 36;
    const headerSize = 4 + (entries.length * tableEntrySize);
    const dataSize = entries.reduce((sum, entry) => sum + entry.data.length, 0);
    const out = Buffer.alloc(headerSize + dataSize);
    out.writeUInt32LE(entries.length, 0);
    let dataOffset = headerSize;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const base = 4 + (i * tableEntrySize);
      const nameBuf = Buffer.from(entry.name, 'utf8');
      if (nameBuf.length > 27) {
        throw new Error(`NXP test entry name too long: ${entry.name}`);
      }
      nameBuf.copy(out, base);
      out.writeUInt32LE(dataOffset, base + 28);
      out.writeUInt32LE(entry.data.length, base + 32);
      entry.data.copy(out, dataOffset);
      dataOffset += entry.data.length;
    }
    fs.writeFileSync(nxpPath, out);
  };
  const writeRarStub = () => {
    const rarPath = path.join(tmpDir, 'pack.rar');
    fs.writeFileSync(rarPath, Buffer.from([0]));
    return rarPath;
  };

  beforeEach(async function() {
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'test', 'tmp-nodefileprovider-'));
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true });
    fs.copyFileSync(packFile, path.join(tmpDir, 'LEVEL000.DAT'));
    fs.copyFileSync(packFile, path.join(tmpDir, 'LEVEL..000.DAT'));
    fs.copyFileSync(packFile, path.join(tmpDir, 'data', 'LEVEL000.DAT'));
    const zip = new AdmZip();
    zip.addFile('data/LEVEL000.DAT', fs.readFileSync(packFile));
    zip.writeZip(path.join(tmpDir, 'pack.zip'));
    await tar.c({ file: path.join(tmpDir, 'pack.tar'), cwd: tmpDir }, ['data/LEVEL000.DAT']);
    writeNxp(path.join(tmpDir, 'pack.nxp'), [
      { name: 'data/LEVEL000.DAT', data: fs.readFileSync(packFile) },
      { name: 'docs/readme.txt', data: Buffer.from('nxp-text') }
    ]);
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

    const nxpReader = await provider.loadBinary('pack.nxp', 'data/LEVEL000.DAT');
    expect(nxpReader.length).to.equal(buffer.length);

    const nxpLower = await provider.loadBinary('pack.nxp', 'data/level000.dat');
    expect(nxpLower.length).to.equal(buffer.length);
  });

  it('loads archive entries when archive paths include trailing separators', async function() {
    const provider = makeProvider();
    const zipReader = await provider.loadBinary('pack.zip/', 'data/LEVEL000.DAT');
    expect(zipReader.length).to.equal(fs.readFileSync(packFile).length);

    const tarReader = await provider.loadBinary('pack.tar/', 'data/LEVEL000.DAT');
    expect(tarReader.length).to.equal(fs.readFileSync(packFile).length);
  });

  it('defaults binary directory paths to provider root when omitted', async function() {
    const provider = makeProvider();
    const reader = await provider.loadBinary(undefined, 'LEVEL000.DAT');
    expect(reader.length).to.equal(fs.readFileSync(packFile).length);
  });

  it('loads archive strings and validates entries', async function() {
    const provider = makeProvider();

    const zipText = await provider.loadString('pack.zip/data/LEVEL000.DAT');
    expect(zipText.length).to.be.greaterThan(0);

    const tarText = await provider.loadString('pack.tar/LEVEL000.DAT');
    expect(tarText.length).to.be.greaterThan(0);

    const nxpText = await provider.loadString('pack.nxp/docs/readme.txt');
    expect(nxpText).to.equal('nxp-text');

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
    await expectReject(
      provider.loadString('pack.nxp/missing.txt'),
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
    await expectReject(
      provider.loadBinary('pack.nxp', 'missing.dat'),
      /not found/i
    );
  });

  it('normalizes validated entry paths', function() {
    const provider = makeProvider();
    expect(provider._validateEntry('data\\LEVEL000.DAT')).to.equal('data/LEVEL000.DAT');
    expect(provider._validateEntry('data/LEVEL..000.DAT')).to.equal('data/LEVEL..000.DAT');
  });

  it('allows non-traversal file names with repeated dots', async function() {
    const provider = makeProvider();
    const reader = await provider.loadBinary('.', 'LEVEL..000.DAT');
    expect(reader.length).to.equal(fs.readFileSync(packFile).length);
  });

  it('reads plain strings from disk', async function() {
    const provider = makeProvider();
    const textPath = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(textPath, 'hello');
    const text = await provider.loadString('note.txt');
    expect(text).to.equal('hello');
  });

  it('rejects non-string loadString inputs', async function() {
    const provider = makeProvider();
    await expectReject(
      provider.loadString(null),
      /invalid file path/i
    );
  });

  it('reads plain strings from absolute paths', async function() {
    const provider = makeProvider();
    const textPath = path.join(tmpDir, 'abs.txt');
    fs.writeFileSync(textPath, 'abs');
    const text = await provider.loadString(textPath);
    expect(text).to.equal('abs');
  });

  it('rejects parent traversal in plain string paths', async function() {
    const provider = makeProvider();
    await expectReject(
      provider.loadString('../outside.txt'),
      /invalid file path/i
    );
  });

  it('rejects parent traversal in binary directory paths', async function() {
    const provider = makeProvider();
    await expectReject(
      provider.loadBinary('../outside', 'LEVEL000.DAT'),
      /invalid file path/i
    );
  });

  it('rejects parent traversal in archive string paths', async function() {
    const provider = makeProvider();
    await expectReject(
      provider.loadString('../pack.zip/data/LEVEL000.DAT'),
      /invalid file path/i
    );
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

    const zipUpdated = new AdmZip();
    zipUpdated.addFile('data/LEVEL000.DAT', Buffer.from([1, 2, 3, 4]));
    const zipPath = path.join(tmpDir, 'pack.zip');
    zipUpdated.writeZip(zipPath);
    const shifted = new Date(Date.now() + 2500);
    fs.utimesSync(zipPath, shifted, shifted);
    const zip3 = provider._getZip('pack.zip');
    expect(zip3).to.not.equal(zip1);

    const tar1 = await provider._getTar('pack.tar');
    const tar2 = await provider._getTar('pack.tar');
    expect(tar1).to.equal(tar2);
    await tar.c({ file: path.join(tmpDir, 'pack.tar'), cwd: tmpDir }, ['LEVEL000.DAT']);
    const tarPath = path.join(tmpDir, 'pack.tar');
    const tarShifted = new Date(Date.now() + 2500);
    fs.utimesSync(tarPath, tarShifted, tarShifted);
    const tar3 = await provider._getTar('pack.tar');
    expect(tar3).to.not.equal(tar1);

    const nxp1 = provider._getNxp('pack.nxp');
    const nxp2 = provider._getNxp('pack.nxp');
    expect(nxp1).to.equal(nxp2);
    const nxpPath = path.join(tmpDir, 'pack.nxp');
    const originalNxpStat = fs.statSync(nxpPath);
    writeNxp(path.join(tmpDir, 'pack.nxp'), [
      { name: 'data/LEVEL000.DAT', data: Buffer.from([7, 8, 9]) }
    ]);
    const nxpShifted = new Date(Date.now() + 3500);
    fs.utimesSync(nxpPath, nxpShifted, nxpShifted);
    const nxp3 = provider._getNxp('pack.nxp');
    expect(nxp3).to.not.equal(nxp1);

    writeNxp(path.join(tmpDir, 'pack.nxp'), [
      { name: 'data/LEVEL000.DAT', data: Buffer.from([1, 2, 3]) }
    ]);
    fs.utimesSync(nxpPath, originalNxpStat.atime, originalNxpStat.mtime);
    const nxp4 = provider._getNxp('pack.nxp');
    expect(nxp4).to.not.equal(nxp3);
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

    const rarPath = path.join(tmpDir, 'pack.rar');
    fs.writeFileSync(rarPath, Buffer.from([1]));
    const shifted = new Date(Date.now() + 2500);
    fs.utimesSync(rarPath, shifted, shifted);
    await provider.loadBinary('pack.rar', 'LEVEL000.DAT');
    expect(calls).to.equal(2);
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

  it('skips traversal-looking archive entries during fallback lookups', function() {
    const provider = makeProvider();
    const map = new Map([['../secret.txt', Buffer.from('secret')]]);
    expect(provider._findEntry(map, 'secret.txt')).to.equal(null);

    const fakeZip = {
      getEntry() { return null; },
      getEntries() {
        return [{ entryName: '../secret.txt' }];
      }
    };
    const found = provider._findZipEntry(fakeZip, 'secret.txt');
    expect(found).to.equal(undefined);
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
    provider._getNxp('pack.nxp');
    provider.clearCache();
    expect(provider.zipCache.size).to.equal(0);
    expect(provider.tarCache.size).to.equal(0);
    expect(provider.rarCache.size).to.equal(0);
    expect(provider.nxpCache.size).to.equal(0);
    expect(provider.getCacheStats().zip.bytes).to.equal(0);
  });

  it('bounds archive caches by entry count and bytes', function() {
    const provider = makeProvider({
      maxArchiveCacheEntries: 2,
      maxArchiveCacheBytes: 1024
    });
    for (const name of ['a.nxp', 'b.nxp', 'c.nxp', 'd.nxp']) {
      writeNxp(path.join(tmpDir, name), [
        { name: 'data/file.bin', data: Buffer.from(name) }
      ]);
    }

    provider._getNxp('a.nxp');
    provider._getNxp('b.nxp');
    provider._getNxp('c.nxp');
    expect(provider.getCacheStats().nxp.entries).to.equal(2);
    expect([...provider.nxpCache.keys()].map(key => path.basename(key))).to.deep.equal(['b.nxp', 'c.nxp']);

    provider._getNxp('b.nxp');
    provider._getNxp('d.nxp');
    expect([...provider.nxpCache.keys()].map(key => path.basename(key))).to.deep.equal(['b.nxp', 'd.nxp']);

    const byteBounded = makeProvider({
      maxArchiveCacheEntries: 10,
      maxArchiveCacheBytes: 5
    });
    writeNxp(path.join(tmpDir, 'e.nxp'), [
      { name: 'data/file.bin', data: Buffer.from([1, 2, 3, 4]) }
    ]);
    writeNxp(path.join(tmpDir, 'f.nxp'), [
      { name: 'data/file.bin', data: Buffer.from([5, 6, 7, 8]) }
    ]);
    byteBounded._getNxp('e.nxp');
    byteBounded._getNxp('f.nxp');
    expect(byteBounded.getCacheStats().nxp).to.include({
      entries: 1,
      bytes: 4
    });
  });

  it('does not retain a single oversized archive entry', function() {
    const provider = makeProvider({
      maxArchiveCacheEntries: 10,
      maxArchiveCacheBytes: 3
    });
    writeNxp(path.join(tmpDir, 'oversized.nxp'), [
      { name: 'data/file.bin', data: Buffer.from([1, 2, 3, 4]) }
    ]);

    const map = provider._getNxp('oversized.nxp');
    expect(map.get('data/file.bin').length).to.equal(4);
    expect(provider.nxpCache.size).to.equal(0);
    expect(provider.getCacheStats().nxp.bytes).to.equal(0);
  });

  it('rejects invalid nxp archives', function() {
    const provider = makeProvider();
    fs.writeFileSync(path.join(tmpDir, 'bad-count.nxp'), Buffer.from([2, 0, 0, 0]));
    expect(() => provider._getNxp('bad-count.nxp')).to.throw(/invalid nxp table size/i);

    const invalid = Buffer.alloc(4 + 36);
    invalid.writeUInt32LE(1, 0);
    Buffer.from('file.bin').copy(invalid, 4);
    invalid.writeUInt32LE(999, 32);
    invalid.writeUInt32LE(10, 36);
    fs.writeFileSync(path.join(tmpDir, 'bad-bounds.nxp'), invalid);
    expect(() => provider._getNxp('bad-bounds.nxp')).to.throw(/invalid nxp entry bounds/i);
  });
});
