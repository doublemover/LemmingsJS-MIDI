import { BinaryReader } from '../../data/BinaryReader.js';
import { FileContainer } from '../../data/FileContainer.js';
import { GroundReader } from '../../level/GroundReader.js';
import { ColorPalette } from '../../render/ColorPalette.js';
import { TerrainImageInfo } from '../../render/TerrainImageInfo.js';
import { ObjectImageInfo } from '../../level/ObjectImageInfo.js';
import { fingerprintTerrainImages } from '../procgen/ProcgenTerrainDescriptors.js';
import { fingerprintObjectImages } from '../procgen/ProcgenAuthoredAssemblies.js';

export const GROUND_DECODE_VERSION = 'classic-ground-v1';
const failure = (code, message) => Object.assign(new Error(message), { name: 'BackgroundJobError', code });
const hash = async (bytes, crypto) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const isBytes = value => value instanceof Uint8Array && !(typeof globalThis.SharedArrayBuffer === 'function' && value.buffer instanceof globalThis.SharedArrayBuffer);
const assertMetadata = input => {
  if (!input || input.version !== GROUND_DECODE_VERSION || !isBytes(input.ground?.bytes) || input.ground.bytes.byteLength !== 1056 || !isBytes(input.vgagr?.bytes) ||
      input.vgagr.bytes.byteLength > 16 * 1048576 || !/^[a-f0-9]{64}$/.test(input.ground.sha256 || '') || !/^[a-f0-9]{64}$/.test(input.vgagr.sha256 || '') ||
      typeof input.ground.root !== 'string' || input.ground.root.length > 256 || !/^GROUND\d{1,2}O\.DAT$/.test(input.ground.filename || '') ||
      !Array.isArray(input.steelIds) || input.steelIds.length > 64 || input.steelIds.some(id => !Number.isInteger(id) || id < 0 || id >= 64) ||
      new Set(input.steelIds).size !== input.steelIds.length) throw failure('invalid-data', 'Unsupported ground decode snapshot.');
};
const inspectImages = (ground, terrainLength, objectLength, limit) => {
  const bytes = ground.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let total = 0;
  for (let kind = 0; kind < 2; kind++) for (let index = 0; index < (kind ? 64 : 16); index++) {
    const offset = kind ? 448 + index * 8 : index * 28, width = bytes[offset + (kind ? 0 : 4)], height = bytes[offset + (kind ? 1 : 5)],
      count = kind ? 1 : bytes[offset + 3], pixels = width * height, start = view.getUint16(offset + (kind ? 2 : 21), true),
      mask = view.getUint16(offset + (kind ? 4 : 8), true), stride = kind ? 0 : view.getUint16(offset + 6, true), available = kind ? terrainLength : objectLength;
    total += pixels * count;
    if (!kind && count > 64) throw failure('decode-capacity', 'Ground object animation exceeds its frame bound.');
    if (total > limit) throw failure('decode-capacity', 'Ground images exceed the admitted decoded byte bound.');
    if (!pixels || !count) continue;
    const last = start + (count - 1) * stride, maskStart = kind ? mask : last + mask;
    if (last + Math.ceil(pixels * (kind ? 3 : 4) / 8) > available || maskStart < 0 || maskStart + Math.ceil(pixels / 8) > available)
      throw failure('invalid-data', 'Ground image planes extend beyond their source part.');
  }
  return total;
};

export async function decodeGroundAssetSnapshot(input, { estimatedPeakBytes, maxBytes, maxDecodedBytes = 16 * 1048576,
  signal, current, crypto = globalThis.crypto, yieldControl = async () => {}, onProgress = () => {} } = {}) {
  const check = () => { signal?.throwIfAborted(); if (current && !current()) throw failure('stale-owner', 'Ground decode owner changed.'); };
  check(); assertMetadata(input);
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 0 || maxDecodedBytes > 16 * 1048576) throw failure('invalid-contract', 'Invalid decoded ground byte bound.');
  const inputBytes = input.ground.bytes.byteLength + input.vgagr.bytes.byteLength;
  if (inputBytes > maxBytes || inputBytes * 4 + 262144 > estimatedPeakBytes) throw failure('memory-capacity', 'Ground source exceeds its admitted memory estimate.');
  if (!crypto?.subtle) throw failure('crypto-unavailable', 'Verified terrain decoding requires SHA-256.');
  for (const source of [input.ground, input.vgagr]) {
    if (await hash(source.bytes, crypto) !== source.sha256) throw failure('content-mismatch', 'Ground decode source differs from its content identity.');
    check(); await yieldControl();
  }
  const compressed = input.vgagr.bytes; let position = 0, parts = 0;
  while (position + 10 < compressed.length) {
    const size = compressed[position + 8] * 256 + compressed[position + 9];
    if (++parts > 16 || size < 10 || position + size > compressed.length) throw failure('invalid-data', 'Ground graphics container exceeds its part bounds.');
    position += size;
  }
  let container, terrain, objects, ground, vga;
  try {
    ground = new BinaryReader(input.ground.bytes, 0, undefined, input.ground.filename, input.ground.root);
    vga = new BinaryReader(input.vgagr.bytes); container = new FileContainer(vga);
    if (container.count() < 2) throw failure('invalid-data', 'Ground graphics container is missing required parts.');
    terrain = container.getPart(0); objects = container.getPart(1);
    const decodedBytes = inspectImages(input.ground, terrain.length, objects.length, maxDecodedBytes);
    if (inputBytes * 4 + decodedBytes * 3 + 262144 > estimatedPeakBytes) throw failure('memory-capacity', 'Decoded ground images exceed their admitted memory estimate.');
    check(); onProgress({ phase: 'decoding-ground', completedUnits: 0, totalUnits: 80 }); await yieldControl(); check();
    const reader = new GroundReader(ground, terrain, objects, { steelSprites: { [input.ground.root]: { [input.ground.filename]: input.steelIds } } });
    if (!reader.valid) throw failure('invalid-data', 'Ground source could not be decoded.');
    const terrainImages = reader.getTerrainImages(), gadgetImages = reader.getObjectImages();
    check(); await yieldControl();
    const assetSha256 = await fingerprintTerrainImages(terrainImages); check(); await yieldControl();
    const objectSha256 = await fingerprintObjectImages(gadgetImages); check();
    const serialize = image => ({ ...image, palette: { data: image.palette.data } });
    return { value: { version: GROUND_DECODE_VERSION, terrainImages: terrainImages.map(serialize), gadgetImages: gadgetImages.map(serialize),
      assetSha256, objectSha256, decodedBytes }, inputBytes, nodes: 512, retainedBytes: decodedBytes + 65536 };
  } finally { terrain?.release(); objects?.release(); container?.dispose(); ground?.release(); vga?.release(); }
}

const hydrated = new WeakMap();
export function hydrateGroundAssets(snapshot) {
  if (hydrated.has(snapshot)) return hydrated.get(snapshot);
  if (snapshot?.version !== GROUND_DECODE_VERSION || snapshot.terrainImages?.length !== 64 || snapshot.gadgetImages?.length !== 16 ||
      !/^[a-f0-9]{64}$/.test(snapshot.assetSha256 || '') || !/^[a-f0-9]{64}$/.test(snapshot.objectSha256 || '')) throw failure('invalid-result', 'Invalid decoded ground result.');
  let decodedBytes = 0;
  const revive = (images, Type) => Object.freeze(images.map(source => {
    if (!source || !Number.isInteger(source.width) || source.width < 0 || source.width > 255 || !Number.isInteger(source.height) || source.height < 0 || source.height > 255 ||
        !Array.isArray(source.frames) || source.frames.length > 255 || !(source.palette?.data instanceof Uint32Array) || source.palette.data.length !== 16 ||
        source.frames.some(frame => !isBytes(frame) || frame.length !== source.width * source.height)) throw failure('invalid-result', 'Invalid decoded image representation.');
    for (const frame of source.frames) decodedBytes += frame.byteLength;
    if (decodedBytes > 16 * 1048576) throw failure('invalid-result', 'Decoded image result exceeds its byte bound.');
    const palette = new ColorPalette(); palette.data = source.palette.data; Object.freeze(palette);
    return Object.freeze(Object.assign(new Type(), source, { palette, frames: Object.freeze(source.frames) }));
  }));
  const result = Object.freeze({ terrainImages: revive(snapshot.terrainImages, TerrainImageInfo), gadgetImages: revive(snapshot.gadgetImages, ObjectImageInfo),
    assetSha256: snapshot.assetSha256, objectSha256: snapshot.objectSha256, decodedBytes: snapshot.decodedBytes });
  if (decodedBytes !== snapshot.decodedBytes) throw failure('invalid-result', 'Decoded ground byte accounting differs from its result.');
  hydrated.set(snapshot, result); return result;
}
