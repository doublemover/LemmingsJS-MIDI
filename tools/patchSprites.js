import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingsBootstrap.js';
import { NodeFileProvider } from './NodeFileProvider.js';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import { PackFilePart } from '../js/PackFilePart.js';

function usage() {
  console.log('Usage: node tools/patchSprites.js <target DAT> <png dir> <out DAT>');
}

(async () => {
  const [datFile, pngDir, outFile] = process.argv.slice(2);
  if (!datFile || !pngDir || !outFile) {
    usage();
    return;
  }

  const provider = new NodeFileProvider('.');
  const datReader = await provider.loadBinary(path.dirname(datFile), path.basename(datFile));
  const container = new Lemmings.FileContainer(datReader);

  // Map of part index -> new raw buffer
  const replacements = new Map();
  for (const file of fs.readdirSync(pngDir)) {
    const m = file.match(/(\d+)\.png$/i);
    if (!m) continue;
    const index = parseInt(m[1], 10);
    if (index >= container.parts.length) continue;
    const png = PNG.sync.read(fs.readFileSync(path.join(pngDir, file)));
    const part = container.parts[index];
    const old = part.unpack();
    const expectedSize = old.length;
    if (png.data.length !== expectedSize) {
      console.log(`Skipping ${file}: size mismatch`);
      continue;
    }
    replacements.set(index, png.data);
  }

  // Apply replacements
  for (const [idx, buf] of replacements.entries()) {
    const packed = PackFilePart.pack(buf);
    const part = container.parts[idx];
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum;
    part.decompressedSize = buf.length;
    part.compressedSize = packed.data.length;
    part._compressedData = packed.data; // store temporarily
  }

  // Serialize new container
  const HEADER_SIZE = 10;
  let total = 0;
  for (const part of container.parts) {
    const size = (part._compressedData ? part._compressedData.length : part.compressedSize) + HEADER_SIZE;
    total += size;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of container.parts) {
    const data = part._compressedData || datReader.data.subarray(part.offset, part.offset + part.compressedSize);
    out[offset] = part.initialBufferLen;
    out[offset+1] = part.checksum;
    out[offset+2] = (part.unknown1 >> 8) & 0xFF;
    out[offset+3] = part.unknown1 & 0xFF;
    out[offset+4] = (part.decompressedSize >> 8) & 0xFF;
    out[offset+5] = part.decompressedSize & 0xFF;
    out[offset+6] = (part.unknown0 >> 8) & 0xFF;
    out[offset+7] = part.unknown0 & 0xFF;
    const size = data.length + HEADER_SIZE;
    out[offset+8] = (size >> 8) & 0xFF;
    out[offset+9] = size & 0xFF;
    out.set(data, offset + HEADER_SIZE);
    offset += size;
  }

  fs.writeFileSync(outFile, out);
  console.log(`Wrote ${outFile}`);
})();
