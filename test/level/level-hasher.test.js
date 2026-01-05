import { expect } from 'chai';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BinaryReader } from '../../js/data/BinaryReader.js';
import { FileContainer } from '../../js/data/FileContainer.js';
import { LevelHasher, buildLevelCode } from '../../js/level/LevelHasher.js';

const toHex = (bytes) => Array.from(bytes)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);
const CONSONANTS = new Set([
  'B', 'C', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M',
  'N', 'P', 'Q', 'R', 'S', 'T', 'V', 'W', 'X', 'Y', 'Z'
]);

describe('LevelHasher', function() {
  it('matches Node crypto MD5 output', function() {
    const data = new Uint8Array(256);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    const expected = createHash('md5').update(data).digest('hex');
    const actual = toHex(LevelHasher.longHash(data));
    expect(actual).to.equal(expected);
  });

  it('builds the short hash by XORing MD5 halves', function() {
    const data = new Uint8Array(128);
    data.fill(0x5a);
    const md5 = LevelHasher.longHash(data);
    const shortBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      shortBytes[i] = md5[i] ^ md5[i + 8];
    }
    let expected = 0n;
    for (let i = 7; i >= 0; i--) {
      expected = (expected << 8n) | BigInt(shortBytes[i]);
    }
    expect(LevelHasher.shortHash(data)).to.equal(expected);
  });

  it('accepts BinaryReader input', function() {
    const data = new Uint8Array([9, 8, 7, 6, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]);
    const reader = new BinaryReader(data, 4, 8);
    const slice = data.subarray(4, 12);
    expect(toHex(LevelHasher.longHash(reader))).to.equal(toHex(LevelHasher.longHash(slice)));
  });

  it('accepts arrays, buffers, and empty inputs', function() {
    const data = new Uint8Array([1, 2, 3, 4]);
    const hashArray = LevelHasher.longHash([1, 2, 3, 4]);
    const hashBuffer = LevelHasher.longHash(data.buffer);
    const hashEmpty = LevelHasher.longHash(null);
    expect(hashArray).to.have.lengthOf(16);
    expect(hashBuffer).to.have.lengthOf(16);
    expect(hashEmpty).to.have.lengthOf(16);

    const wrapper = { data: data, hiddenOffset: 1 };
    const hashWrapper = LevelHasher.longHash(wrapper);
    expect(hashWrapper).to.have.lengthOf(16);
  });

  it('handles numeric inputs and bigint codes', function() {
    const hash = LevelHasher.longHash(4);
    expect(hash).to.have.lengthOf(16);
    const code = buildLevelCode(123456n);
    expect(code).to.have.lengthOf(10);
    const zeroCode = buildLevelCode(null);
    expect(zeroCode).to.have.lengthOf(10);
  });

  it('returns alternating consonant/vowel codes', function() {
    const data = new Uint8Array([9, 8, 7, 6, 5, 4]);
    const code = LevelHasher.getLevelCode(data);
    expect(code).to.have.lengthOf(10);
    for (let i = 0; i < code.length; i++) {
      const char = code[i];
      if (i % 2 === 0) {
        expect(CONSONANTS.has(char)).to.equal(true);
      } else {
        expect(VOWELS.has(char)).to.equal(true);
      }
    }
  });

  it('builds level codes from numeric values', function() {
    const code = buildLevelCode(123456);
    expect(code).to.have.lengthOf(10);
  });

  it('matches the known level code for LEVEL000.DAT part 0', function() {
    const filePath = path.resolve(process.cwd(), 'lemmings', 'LEVEL000.DAT');
    const buffer = fs.readFileSync(filePath);
    const reader = new BinaryReader(new Uint8Array(buffer), 0, undefined, 'LEVEL000.DAT');
    const container = new FileContainer(reader);
    const part = container.getPart(0);
    expect(part.length).to.equal(2048);
    const code = LevelHasher.getLevelCode(part);
    expect(code).to.equal('QUQOFIKOQO');
  });
});
