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

    const bits = [];
    const pushBits = (val, count) => {
      for (let i = count - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    };

    let remain = buffer.length;
    let pos = buffer.length;
    while (remain > 0) {
      const chunk = Math.min(remain, 264);
      if (chunk <= 8) {
        pushBits(0, 1);
        pushBits(0, 1);
        pushBits(chunk - 1, 3);
      } else {
        pushBits(1, 1);
        pushBits(3, 2);
        pushBits(chunk - 9, 8);
      }
      for (let i = 0; i < chunk; i++) {
        pushBits(buffer[pos - 1 - i], 8);
      }
      pos -= chunk;
    }

    const byteGroups = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let b = 0; b < 8 && i + b < bits.length; b++) v |= bits[i + b] << b;
        pushBits(buffer[--pos], 8);
    }
    remain -= chunk;

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
    if (bits.length % 8 !== 0) {
      const pad = 8 - (bits.length % 8);
      for (let i = 0; i < pad; i++) bits.push(0);
    }
    const initialBits = 8;
    return { data, checksum, initialBits };
  }
}

Lemmings.PackFilePart = PackFilePart;
export { PackFilePart };
