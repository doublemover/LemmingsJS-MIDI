#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { PackFilePart } from '../js/data/PackFilePart.js';

const USAGE = `Usage:
  node tools/packPipeline.js unpack <input.dat> <outDir>
  node tools/packPipeline.js pack <meta.json> <output.dat>
  node tools/packPipeline.js patch <input.dat> <output.dat> --part <index> --offset <offset> --file <patch.bin>
`;

const parseInt10 = (value, fallback = null) => {
  const num = Number.parseInt(String(value), 10);
  return Number.isFinite(num) ? num : fallback;
};

const writeWord = (buffer, offset, value) => {
  buffer[offset] = (value >> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
};

const getInputReader = (inputPath) => {
  const bytes = fs.readFileSync(inputPath);
  const fileName = path.basename(inputPath);
  const folderName = path.basename(path.dirname(inputPath));
  return new BinaryReader(new Uint8Array(bytes), 0, bytes.length, fileName, folderName);
};

const getRawPartBytes = (part) => {
  const unpacked = part.unpack();
  const start = unpacked.hiddenOffset;
  const end = start + unpacked.length;
  return new Uint8Array(unpacked.data.slice(start, end));
};

const resolveMetadataPartPath = (baseDir, fileName) => {
  if (typeof fileName !== 'string' || !fileName.trim()) {
    throw new Error('invalid metadata part path');
  }
  if (fileName.includes('\0') || path.isAbsolute(fileName)) {
    throw new Error(`metadata part path escapes base directory: ${fileName}`);
  }
  const rawPath = path.resolve(baseDir, fileName);
  const relative = path.relative(baseDir, rawPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`metadata part path escapes base directory: ${fileName}`);
  }
  return rawPath;
};

const collectParts = (container) => {
  const parts = container.parts;
  const out = new Array(parts.length);
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    out[i] = {
      index: i,
      unknown1: Number.isFinite(part.unknown1) ? part.unknown1 : 0,
      unknown0: Number.isFinite(part.unknown0) ? part.unknown0 : 0,
      raw: getRawPartBytes(part)
    };
  }
  return out;
};

const buildDatBuffer = (parts) => {
  const chunks = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const packed = PackFilePart.pack(part.raw);
    const size = packed.byteArray.length + 10;
    const header = new Uint8Array(10);
    header[0] = packed.initialBits & 0xff;
    header[1] = packed.checksum & 0xff;
    writeWord(header, 2, part.unknown1 | 0);
    writeWord(header, 4, part.raw.length);
    writeWord(header, 6, part.unknown0 | 0);
    writeWord(header, 8, size);
    chunks.push(Buffer.from(header));
    chunks.push(Buffer.from(packed.byteArray));
  }
  return Buffer.concat(chunks);
};

const unpackCommand = (inputPath, outDir) => {
  const reader = getInputReader(inputPath);
  const container = new FileContainer(reader);
  const parts = collectParts(container);

  fs.mkdirSync(outDir, { recursive: true });
  const metadata = {
    format: 'lemmings-dat-pipeline-v1',
    source: path.basename(inputPath),
    partCount: parts.length,
    parts: []
  };

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const file = `part-${String(i).padStart(3, '0')}.bin`;
    fs.writeFileSync(path.join(outDir, file), Buffer.from(part.raw));
    metadata.parts.push({
      index: part.index,
      file,
      decompressedSize: part.raw.length,
      unknown1: part.unknown1,
      unknown0: part.unknown0
    });
  }
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(metadata, null, 2));
};

const packCommand = (metaPath, outputPath) => {
  const rawMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const baseDir = path.resolve(path.dirname(metaPath));
  const entries = Array.isArray(rawMeta.parts) ? rawMeta.parts.slice() : [];
  entries.sort((a, b) => (a.index | 0) - (b.index | 0));
  const parts = new Array(entries.length);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const rawPath = resolveMetadataPartPath(baseDir, entry.file);
    const raw = new Uint8Array(fs.readFileSync(rawPath));
    parts[i] = {
      index: entry.index | 0,
      unknown1: Number.isFinite(entry.unknown1) ? entry.unknown1 : 0,
      unknown0: Number.isFinite(entry.unknown0) ? entry.unknown0 : 0,
      raw
    };
  }
  const dat = buildDatBuffer(parts);
  fs.writeFileSync(outputPath, dat);
};

const patchCommand = (inputPath, outputPath, args) => {
  const partFlag = args.indexOf('--part');
  const offsetFlag = args.indexOf('--offset');
  const fileFlag = args.indexOf('--file');
  if (partFlag < 0 || offsetFlag < 0 || fileFlag < 0) {
    throw new Error('patch requires --part, --offset, and --file');
  }
  const partIndex = parseInt10(args[partFlag + 1], -1);
  const patchOffset = parseInt10(args[offsetFlag + 1], -1);
  const patchPath = args[fileFlag + 1];
  if (partIndex < 0 || patchOffset < 0 || !patchPath) {
    throw new Error('invalid patch arguments');
  }

  const reader = getInputReader(inputPath);
  const container = new FileContainer(reader);
  const parts = collectParts(container);
  if (partIndex >= parts.length) {
    throw new Error(`part index out of range: ${partIndex}`);
  }
  const patchBytes = new Uint8Array(fs.readFileSync(patchPath));
  const target = parts[partIndex].raw;
  if ((patchOffset + patchBytes.length) > target.length) {
    throw new Error('patch exceeds decompressed part size');
  }
  target.set(patchBytes, patchOffset);

  const dat = buildDatBuffer(parts);
  fs.writeFileSync(outputPath, dat);
};

const main = () => {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    if (command === 'unpack') {
      const [inputPath, outDir] = args;
      if (!inputPath || !outDir) {
        process.stdout.write(USAGE);
        return;
      }
      unpackCommand(inputPath, outDir);
      return;
    }
    if (command === 'pack') {
      const [metaPath, outputPath] = args;
      if (!metaPath || !outputPath) {
        process.stdout.write(USAGE);
        return;
      }
      packCommand(metaPath, outputPath);
      return;
    }
    if (command === 'patch') {
      const [inputPath, outputPath, ...rest] = args;
      if (!inputPath || !outputPath) {
        process.stdout.write(USAGE);
        return;
      }
      patchCommand(inputPath, outputPath, rest);
      return;
    }
    process.stdout.write(USAGE);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
};

main();
