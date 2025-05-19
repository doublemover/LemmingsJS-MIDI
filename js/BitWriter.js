class BitWriter {
  /**
   * @param {BitReader} bitReader
   * @param {number} outLength
   */
  constructor(bitReader, outLength) {
    this.log = new Lemmings.LogHandler('BitWriter');
    this.outData = new Uint8Array(outLength);
    this.outPos = outLength; // write head walks *backwards*
    this.bitReader = bitReader;
  }

  /** Copy `length` *bytes* directly from reader into output buffer.  */
  copyRawData(length) {
    let outPos = this.outPos;
    const outData = this.outData;
    const reader = this.bitReader;

    if (outPos - length < 0) {
      this.log.log('copyRawData: out of out buffer');
      length = outPos;
    }

    while (length-- > 0) {
      outData[--outPos] = reader.read(8);
    }
    this.outPos = outPos;
  }

  /**
   * Copy `length` *bytes* from data already written (`offsetBitCount` bits
   * encode the backwards offset). Mirrors LZ77 style copy.
   */
  copyReferencedData(length, offsetBitCount) {
    const outData = this.outData;
    let outPos = this.outPos;

    const offset = this.bitReader.read(offsetBitCount) + 1;

    if (outPos + offset > outData.length) {
      this.log.log('copyReferencedData: offset out of range');
      return;
    }
    if (outPos - length < 0) {
      this.log.log('copyReferencedData: out of out buffer');
      length = outPos;
    }

    // Tight backwards copy – avoids inner‑loop bounds checking.
    while (length-- > 0) {
      outData[--outPos] = outData[outPos + offset];
    }

    this.outPos = outPos;
  }

  /** @return {Lemmings.BinaryReader} frozen view of decompressed data */
  getFileReader(filename) {
    return new Lemmings.BinaryReader(this.outData, null, null, filename);
  }

  eof() {
    return this.outPos <= 0;
  }
}

Lemmings.BitWriter = BitWriter;

export { BitWriter };
