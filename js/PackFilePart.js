import { Lemmings } from './LemmingsNamespace.js';

/**
 * Compressor implementing the inverse of {@link UnpackFilePart#doUnpacking}.
 *
 * The format is a small LZ style scheme.  Data is written backwards and the
 * {@link BitReader} consumes bits starting at the least significant bit of the
 * final byte.  This packer mirrors that behaviour and attempts to find short
 * backreferences.  The search is intentionally simple – it scans the previous
 * 4KB for the longest possible match.  The compressor is not especially fast or
 * optimal but it produces a valid bitstream.
 *
 * The produced data is compatible with the BitReader/BitWriter based
 * decompressor. Each call to {@link pack} returns an object containing the
 * compressed buffer, checksum and the initial bit count required for
 * BitReader.
 */
class PackFilePart {
  /**
   * Compress the given buffer.
   *
   * The implementation favours clarity over speed.  It performs a naive
   * backwards LZ search using a 4KB window and emits either raw blocks or
   * backreferences mirroring the semantics of {@link UnpackFilePart#doUnpacking}.
   *
   * @param {Uint8Array} buffer Decompressed bytes to encode
   * @returns {{data:Uint8Array, checksum:number, initialBits:number}}
   */
  static pack(buffer) {
    if (!(buffer instanceof Uint8Array)) buffer = new Uint8Array(buffer);

    const WINDOW = 0x1000; // 4096
    const bits = [];
    const rawQueue = [];

    const pushBits = (val, count) => {
      for (let i = 0; i < count; i++) bits.push((val >> i) & 1);
    };

    const flushRaw = () => {
      let idx = 0;
      while (idx < rawQueue.length) {
        const remain = rawQueue.length - idx;
        if (remain <= 8) {
          // 0,0,len-1
          pushBits(0, 1);
          pushBits(0, 1);
          pushBits(remain - 1, 3);
          for (let i = 0; i < remain; i++) pushBits(rawQueue[idx + i], 8);
          idx = rawQueue.length;
        } else {
          const chunk = Math.min(264, remain);
          // 1,11,length-9
          pushBits(1, 1);
          pushBits(3, 2);
          pushBits(chunk - 9, 8);
          for (let i = 0; i < chunk; i++) pushBits(rawQueue[idx + i], 8);
          idx += chunk;
        }
      }
      rawQueue.length = 0;
    };

    const emitRef = (len, offset) => {
      if (len === 2 && offset <= 0x100) {
        pushBits(0, 1);
        pushBits(1, 1);
        pushBits(offset - 1, 8);
        return;
      }
      if (len === 3 && offset <= 0x200) {
        pushBits(1, 1);
        pushBits(0, 2);
        pushBits(offset - 1, 9);
        return;
      }
      if (len === 4 && offset <= 0x400) {
        pushBits(1, 1);
        pushBits(1, 2);
        pushBits(offset - 1, 10);
        return;
      }
      // generic reference
      pushBits(1, 1);
      pushBits(2, 2);
      pushBits(len - 1, 8);
      pushBits(offset - 1, 12);
    };

    const findMatch = (pos) => {
      let bestLen = 0;
      let bestOff = 0;
      const maxOff = Math.min(pos, WINDOW);
      for (let off = 1; off <= maxOff; off++) {
        let l = 0;
        while (
          l < 256 &&
          pos + l < buffer.length &&
          buffer[pos + l] === buffer[pos - off + l]
        ) {
          l++;
        }
        if (l > bestLen) {
          bestLen = l;
          bestOff = off;
          if (bestLen === 256) break;
        }
      }
      return { len: bestLen, off: bestOff };
    };

    let pos = 0;
    while (pos < buffer.length) {
      const { len, off } = findMatch(pos);

      // Determine if encoding the match actually saves space
      let useRef = false;
      let encLen = len;
      if (len >= 5) {
        useRef = true;
        encLen = Math.min(len, 256);
      } else if (len === 4) {
        useRef = off <= 0x400;
      } else if (len === 3) {
        useRef = off <= 0x200;
        if (!useRef && off <= WINDOW) {
          useRef = true;
        }
      } else if (len === 2) {
        useRef = off <= 0x100;
      }

      if (useRef && encLen >= 2) {
        flushRaw();
        emitRef(encLen, off);
        pos += encLen;
      } else {
        rawQueue.push(buffer[pos++]);
        if (rawQueue.length >= 264) flushRaw();
      }
    }

    flushRaw();

    // Convert bits to bytes.  Bits are produced in the order the BitReader
    // will consume them, so each group of 8 bits forms one byte with the first
    // bit as its least significant bit.  The resulting byte array is then
    // reversed.
    const byteGroups = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let b = 0; b < 8 && i + b < bits.length; b++) {
        v |= bits[i + b] << b;
      }
      byteGroups.push(v);
    }
    byteGroups.reverse();
    const data = Uint8Array.from(byteGroups);
    const checksum = data.reduce((a, b) => a ^ b, 0);
    const initialBits = bits.length % 8 === 0 ? 8 : bits.length % 8;

    return { data, checksum, initialBits };
  }
}

Lemmings.PackFilePart = PackFilePart;
export { PackFilePart };
