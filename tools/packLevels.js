import { PackFilePart } from '../js/PackFilePart.js';
import fs from 'fs';
import path from 'path';

function usage() {
  console.log('Usage: node tools/packLevels.js <level dir> <out DAT>');
}

(async () => {
  const [levelDir, outFile] = process.argv.slice(2);
  if (!levelDir || !outFile) {
    usage();
    return;
  }

  const files = fs.readdirSync(levelDir)
    .filter(f => fs.statSync(path.join(levelDir, f)).isFile())
    .sort();

  const HEADER_SIZE = 10;
  const parts = [];
  let totalSize = 0;

  for (const file of files) {
    const buf = fs.readFileSync(path.join(levelDir, file));
    if (buf.length !== 2048) {
      console.warn(`Skipping ${file}: expected 2048 bytes, got ${buf.length}`);
      continue;
    }
    const { data, checksum, initialBits } = PackFilePart.pack(buf);
    const decompressedSize = buf.length;
    const size = data.length + HEADER_SIZE;
    const header = new Uint8Array([
      initialBits,
      checksum,
      0, 0,
      (decompressedSize >> 8) & 0xFF,
      decompressedSize & 0xFF,
      0, 0,
      (size >> 8) & 0xFF,
      size & 0xFF
    ]);
    parts.push({ header, data });
    totalSize += size;
  }

  const out = new Uint8Array(totalSize);
  let offset = 0;
  for (const { header, data } of parts) {
    out.set(header, offset);
    out.set(data, offset + HEADER_SIZE);
    offset += header.length + data.length;
  }

  fs.writeFileSync(outFile, out);
  console.log(`Wrote ${outFile}`);
})();
