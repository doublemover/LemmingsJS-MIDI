import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { Lemmings } from '../../js/LemmingsNamespace.js';
import '../../js/LogHandler.js';
import { BinaryReader } from '../../js/BinaryReader.js';
import { PackFilePart } from '../../js/PackFilePart.js';
import '../../js/UnpackFilePart.js';
import '../../js/BitReader.js';
import '../../js/BitWriter.js';
import { FileContainer } from '../../js/FileContainer.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('tools/patchSprites.js (mocked PNG)', function () {
  it('updates frames in an existing sprite sheet', async function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprites-'));
    const pngDir = path.join(dir, 'png');
    fs.mkdirSync(pngDir);

    const raws = [
      Uint8Array.from({ length: 16 }, (_, i) => i),
      Uint8Array.from({ length: 16 }, (_, i) => i + 16),
      Uint8Array.from({ length: 16 }, (_, i) => i + 32)
    ];
    const parts = raws.map(raw => {
      const packed = PackFilePart.pack(raw);
      const size = packed.byteArray.length + 10;
      const header = new Uint8Array([
        packed.initialBits,
        packed.checksum,
        0, 0,
        0, 16,
        0, 0,
        (size >> 8) & 0xFF,
        size & 0xFF
      ]);
      return { header, packed: packed.byteArray, size };
    });
    const total = parts.reduce((s, p) => s + p.size, 0);
    const datBuf = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      datBuf.set(p.header, off);
      datBuf.set(p.packed, off + 10);
      off += p.size;
    }
    const datFile = path.join(dir, 'orig.dat');
    fs.writeFileSync(datFile, datBuf);

    const outFile = path.join(dir, 'out.dat');
    const origPath = new URL('../../tools/patchSprites.js', import.meta.url);
    // stub PNG module
    const stubPath = path.join(path.dirname(fileURLToPath(origPath)), 'pngjs-stub.js');
    fs.writeFileSync(stubPath, 'let results=[];export function __setReadResults(r){results=r.slice();}export const PNG={sync:{read(){return results.shift();}}};');
    let code = fs.readFileSync(fileURLToPath(origPath), 'utf8');
    code = code
      .replace('import \'../js/LemmingsBootstrap.js\';', '')
      .replace('import { PNG } from \'pngjs\';', 'import { PNG } from \'./pngjs-stub.js\';');
    const tempScript = path.join(path.dirname(fileURLToPath(origPath)), 'patchSprites.test-run.js');
    fs.writeFileSync(tempScript, code);
    expect(fs.existsSync(tempScript)).to.be.true;

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    expect(fs.existsSync(path.dirname(outFile))).to.be.true;

    const { __setReadResults } = await import(pathToFileURL(stubPath).href);
    const new1 = Uint8Array.from(raws[1].map(v => v + 1));
    const new2 = Uint8Array.from(raws[2].map(v => v + 1));
    const sheetData = new Uint8Array([...new1, ...new2]);
    __setReadResults([{ width: 2, height: 4, data: Buffer.from(sheetData) }]);

    // create dummy file so fs.readdirSync finds it
    fs.writeFileSync(path.join(pngDir, '1.png'), Buffer.alloc(0));

    const origArgv = process.argv;
    process.argv = ['node', tempScript, '--sheet-orientation=vertical', datFile, pngDir, outFile];
    await import(pathToFileURL(tempScript).href + `?t=${Date.now()}`);
    process.argv = origArgv;
    fs.unlinkSync(tempScript);
    fs.unlinkSync(stubPath);

    expect(fs.existsSync(outFile)).to.be.true;
    const outBuf = fs.readFileSync(outFile);
    const fc = new FileContainer(new BinaryReader(new Uint8Array(outBuf)));
    expect(fc.count()).to.equal(3);
    const expectData = [raws[0], new1, new2];
    fc.parts.forEach((part, idx) => {
      const unpacked = fc.getPart(idx);
      expect(Array.from(unpacked.data.slice(0, unpacked.length))).to.eql(Array.from(expectData[idx]));
    });
  });
});
