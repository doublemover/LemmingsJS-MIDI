import * as Lemmings from '../js/exports.js';
import '../js/LemmingsBootstrap.js';
import { NodeFileProvider } from './NodeFileProvider.js';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import { once } from 'events';
import { PackFilePart } from '../js/data/PackFilePart.js';

function usage() {
  console.log('Usage: node tools/patchSprites.js [--sheet-orientation=horizontal|vertical] <target DAT> <png dir> <out DAT>');
}

async function main() {
  const args = process.argv.slice(2);
  let orientation = 'horizontal';
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--sheet-orientation=(horizontal|vertical)$/i);
    if (m) {
      orientation = m[1].toLowerCase();
      args.splice(i, 1);
      break;
    }
  }

  const [datFile, pngDir, outFile] = args;
  if (!datFile || !pngDir || !outFile) {
    usage();
    return;
  }

  // Use an empty root path so absolute input paths work correctly
  const provider = new NodeFileProvider('');
  const datReader = await provider.loadBinary(path.dirname(datFile), path.basename(datFile));
  const container = new Lemmings.FileContainer(datReader);

  // Map of part index -> new raw buffer
  const replacements = new Map();
  for (const file of fs.readdirSync(pngDir)) {
    const m = file.match(/(\d+)\.png$/i);
    if (!m) continue;
    const startIndex = parseInt(m[1], 10);
    if (startIndex >= container.parts.length) continue;
    const png = PNG.sync.read(fs.readFileSync(path.join(pngDir, file)));
    const part = container.parts[startIndex];
    const old = part.unpack();
    const expectedSize = old.length;

    if (png.data.length === expectedSize) {
      // Single frame replacement
      replacements.set(startIndex, png.data);
      continue;
    }

    // Potential sprite sheet spanning multiple parts
    if (png.data.length % expectedSize !== 0) {
      console.log(`Skipping ${file}: size mismatch`);
      continue;
    }

    const frames = png.data.length / expectedSize;
    if (startIndex + frames > container.parts.length) {
      console.log(`Skipping ${file}: not enough target parts for sheet`);
      continue;
    }

    let frameWidth, frameHeight;
    if (orientation === 'horizontal') {
      if (png.width % frames !== 0) {
        console.log(`Skipping ${file}: sheet width not divisible by frame count`);
        continue;
      }
      frameWidth = png.width / frames;
      frameHeight = png.height;
    } else {
      if (png.height % frames !== 0) {
        console.log(`Skipping ${file}: sheet height not divisible by frame count`);
        continue;
      }
      frameWidth = png.width;
      frameHeight = png.height / frames;
    }

    if (frameWidth * frameHeight * 4 !== expectedSize) {
      console.log(`Skipping ${file}: frame dimensions do not match target size`);
      continue;
    }

    console.log(`Slicing ${file} into ${frames} frames`);
    for (let f = 0; f < frames; f++) {
      const out = new Uint8Array(expectedSize);
      for (let y = 0; y < frameHeight; y++) {
        const srcRow = orientation === 'horizontal'
          ? ((y * png.width) + f * frameWidth) * 4
          : ((y + f * frameHeight) * png.width) * 4;
        const dstRow = y * frameWidth * 4;
        out.set(png.data.subarray(srcRow, srcRow + frameWidth * 4), dstRow);
      }
      replacements.set(startIndex + f, out);
    }
  }

  // Apply replacements
  for (const [idx, buf] of replacements.entries()) {
    const packed = PackFilePart.pack(buf);
    const part = container.parts[idx];
    part.initialBufferLen = packed.initialBits;
    part.checksum = packed.checksum;
    part.decompressedSize = buf.length;
    part.compressedSize = packed.byteArray.length;
    part._compressedData = packed.byteArray; // store temporarily
  }

  // Serialize new container using streamed writes so large packs do not require
  // a single contiguous output allocation.
  const HEADER_SIZE = 10;
  const outStream = fs.createWriteStream(outFile);
  let total = 0;
  const writeChunk = async (chunk) => {
    if (!outStream.write(chunk)) {
      await once(outStream, 'drain');
    }
  };

  for (const part of container.parts) {
    const data = part._compressedData || datReader.data.subarray(part.offset, part.offset + part.compressedSize);
    const header = new Uint8Array(HEADER_SIZE);
    header[0] = part.initialBufferLen;
    header[1] = part.checksum;
    header[2] = (part.unknown1 >> 8) & 0xFF;
    header[3] = part.unknown1 & 0xFF;
    header[4] = (part.decompressedSize >> 8) & 0xFF;
    header[5] = part.decompressedSize & 0xFF;
    header[6] = (part.unknown0 >> 8) & 0xFF;
    header[7] = part.unknown0 & 0xFF;
    const size = data.length + HEADER_SIZE;
    header[8] = (size >> 8) & 0xFF;
    header[9] = size & 0xFF;
    await writeChunk(header);
    await writeChunk(data);
    total += size;
  }

  await new Promise((resolve, reject) => {
    outStream.once('error', reject);
    outStream.end(resolve);
  });
  console.log(`Wrote ${outFile} (${total} bytes)`);
}

await main();
