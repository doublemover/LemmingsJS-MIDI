import { Lemmings } from './LemmingsNamespace.js';

class BitReader {
        constructor(fileReader, offset, length, initBufferLength) {
            this.pos = 0;
            //- create a copy of the reader
            this.binReader = new Lemmings.BinaryReader(fileReader, offset, length, fileReader.filename);
            this.pos = length;
            this.pos--;
            this.buffer = this.binReader.readByte(this.pos);
            this.bufferLen = initBufferLength;
            this.checksum = this.buffer;
        }
        getCurrentChecksum() {
            return this.checksum;
        }
        /** read and return [bitCount] bits from the stream */
        read(bitCount) {
            let result = 0;
            for (var i = bitCount; i > 0; i--) {
                if (this.bufferLen <= 0) {
                    this.pos--;
                    var b = this.binReader.readByte(this.pos);
                    this.buffer = b;
                    this.checksum ^= b;
                    this.bufferLen = 8;
                }
                this.bufferLen--;
                result = (result << 1) | (this.buffer & 1);
                this.buffer >>= 1;
            }
            return result;
        }
        eof() {
            return ((this.bufferLen <= 0) && (this.pos < 0));
        }
    }
    Lemmings.BitReader = BitReader;

export { BitReader };
