import { Lemmings } from './LemmingsNamespace.js';

class BitWriter {
        constructor(bitReader, outLength) {
            this.log = new Lemmings.LogHandler("BitWriter");
            this.outData = new Uint8Array(outLength);
            this.outPos = outLength;
            this.bitReader = bitReader;
        }
        /** copy length bytes from the reader */
        copyRawData(length) {
            if (this.outPos - length < 0) {
                this.log.log("copyRawData: out of out buffer");
                length = this.outPos;
                return;
            }
            for (; length > 0; length--) {
                this.outPos--;
                this.outData[this.outPos] = this.bitReader.read(8);
            }
        }
        /** Copy length bits from the write cache */
        copyReferencedData(length, offsetBitCount) {
            /// read offset to current write pointer to read from
            var offset = this.bitReader.read(offsetBitCount) + 1;
            /// is offset in range?
            if (this.outPos + offset > this.outData.length) {
                this.log.log("copyReferencedData: offset out of range");
                offset = 0;
                return;
            }
            /// is length in range
            if (this.outPos - length < 0) {
                this.log.log("copyReferencedData: out of out buffer");
                length = this.outPos;
                return;
            }
            for (; length > 0; length--) {
                this.outPos--;
                this.outData[this.outPos] = this.outData[this.outPos + offset];
            }
        }
        /** return a  BinaryReader with the data written to this BitWriter class */
        getFileReader(filename) {
            return new Lemmings.BinaryReader(this.outData, null, null, filename);
        }
        eof() {
            return this.outPos <= 0;
        }
    }
    Lemmings.BitWriter = BitWriter;

export { BitWriter };
