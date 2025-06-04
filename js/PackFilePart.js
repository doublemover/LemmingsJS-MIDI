import { Lemmings } from './LemmingsNamespace.js';

/**
 * Minimal compressor producing a bitstream compatible with
 * {@link UnpackFilePart#doUnpacking}.
 *
 * Only raw-copy tokens are emitted. Bytes are encoded from the end of
 * the input towards the start so that the backwards-writing
 * decompressor can recreate the original data without additional
 * shuffling.
 */
class PackFilePart {
  /**
   * Compress the given buffer.
   * @param {Uint8Array} buffer Input data
   * @returns {{data:Uint8Array, checksum:number, initialBits:number}}
   */
  static pack(buffer) {
    if (!(buffer instanceof Uint8Array)) buffer = new Uint8Array(buffer);

    const bits = [];
    const pushBits = (val, count) => {
      for (let i = count - 1; i >= 0; i--) bits.push((val >> i) & 1);
    };

    let pos = buffer.length;
    while (pos > 0) {
      const chunk = Math.min(264, pos);
      if (chunk <= 8) {
        // token: 0,0,(len-1)
        pushBits(0, 1);
        pushBits(0, 1);
        pushBits(chunk - 1, 3);
      } else {
        // token: 1,11,(len-9)
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
      byteGroups.push(v);
    }
    byteGroups.reverse();
    const data = Uint8Array.from(byteGroups);
    const checksum = data.reduce((a, b) => a ^ b, 0);
    const initialBits = bits.length <= 8 ? bits.length : 8;
    return { data, checksum, initialBits };
  }
}

Lemmings.PackFilePart = PackFilePart;
export { PackFilePart };
