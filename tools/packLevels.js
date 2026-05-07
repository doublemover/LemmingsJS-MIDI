import { PackFilePart } from '../js/data/PackFilePart.js';
import fs from 'fs';
import path from 'path';
import { once } from 'events';

function usage() {
  console.log('Usage: node tools/packLevels.js <level dir> <out DAT>');
}

(async () => {
  const [levelDir, outFile] = process.argv.slice(2);
  if (!levelDir || !outFile) {
    usage();
    return;
  }

  const files = (await fs.promises.readdir(levelDir, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();

  const HEADER_SIZE = 10;
  const outStream = fs.createWriteStream(outFile);
  let totalSize = 0;

  const writeChunk = async (chunk) => {
    if (!outStream.write(chunk)) {
      await once(outStream, 'drain');
    }
  };

  for (const file of files) {
    const buf = await fs.promises.readFile(path.join(levelDir, file));
    if (buf.length !== 2048) {
      console.warn(`Skipping ${file}: expected 2048 bytes, got ${buf.length}`);
      continue;
    }
    const { byteArray, checksum, initialBits } = PackFilePart.pack(buf);
    const decompressedSize = buf.length;
    const size = byteArray.length + HEADER_SIZE;
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
    await writeChunk(header);
    await writeChunk(byteArray);
    totalSize += size;
  }

  await new Promise((resolve, reject) => {
    outStream.once('error', reject);
    outStream.end(resolve);
  });

  console.log(`Wrote ${outFile} (${totalSize} bytes)`);
})();
