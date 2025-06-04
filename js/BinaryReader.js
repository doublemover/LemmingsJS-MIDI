import { Lemmings } from './LemmingsNamespace.js';

class BinaryReader {
        constructor(dataArray, offset = 0, length, filename = "[unknown]") {
            this.log = new Lemmings.LogHandler("BinaryReader");
            this.filename = filename;
            if (offset == null)
                offset = 0;
            let dataLength = 0;
            if (dataArray == null) {
                this.data = new Uint8Array(0);
                dataLength = 0;
                this.log.log("BinaryReader from NULL; size:" + 0);
            } else if (dataArray instanceof BinaryReader) {
                //- if dataArray is BinaryReader use there data
                this.data = dataArray.data;
                dataLength = dataArray.length;
                this.log.log("BinaryReader from BinaryReader; size:" + dataLength);
            } else if (dataArray instanceof Uint8Array) {
                this.data = dataArray;
                dataLength = dataArray.byteLength;
                this.log.log("BinaryReader from Uint8Array; size:" + dataLength);
            } else if (dataArray instanceof ArrayBuffer) {
                this.data = new Uint8Array(dataArray);
                dataLength = dataArray.byteLength;
                this.log.log("BinaryReader from ArrayBuffer; size:" + dataLength);
            } else if (dataArray instanceof Blob) {
                this.data = new Uint8Array(dataArray);
                dataLength = this.data.byteLength;
                this.log.log("BinaryReader from Blob; size:" + dataLength);
            } else {
                this.data = dataArray;
                dataLength = this.data.length;
                this.log.log("BinaryReader from unknown: " + dataArray + "; size:" + dataLength);
            }
            if (length == null)
                length = dataLength - offset;
            this.hiddenOffset = offset;
            this.length = length;
            this.pos = this.hiddenOffset;
        }
        /** Read one Byte from stream */
        readByte(offset) {
            if (offset != null)
                this.pos = (offset + this.hiddenOffset);
            if ((this.pos < 0) || (this.pos > this.data.length)) {
                this.log.log("read out of data: " + this.filename + " - size: " + this.data.length + " @ " + this.pos);
                return 0;
            }
            let v = this.data[this.pos];
            this.pos++;
            return v;
        }
        /** Read one DWord (4 Byte) from stream (little ending) */
        readInt(length = 4, offset) {
            if (offset == null)
                offset = this.pos;
            if (length == 4) {
                let v = (this.data[offset] << 24) | (this.data[offset + 1] << 16) | (this.data[offset + 2] << 8) | (this.data[offset + 3]);
                this.pos = offset + 4;
                return v;
            }
            let v = 0;
            for (let i = length; i > 0; i--) {
                v = (v << 8) | this.data[offset];
                offset++;
            }
            this.pos = offset;
            return v;
        }
        /** Read one DWord (4 Byte) from stream (big ending) */
        readIntBE(offset) {
            if (offset == null)
                offset = this.pos;
            let v = (this.data[offset]) | (this.data[offset + 1] << 8) | (this.data[offset + 2] << 16) | (this.data[offset + 3] << 24);
            this.pos = offset + 4;
            return v;
        }
        /** Read one Word (2 Byte) from stream (big ending) */
        readWord(offset) {
            if (offset == null)
                offset = this.pos;
            let v = (this.data[offset] << 8) | (this.data[offset + 1]);
            this.pos = offset + 2;
            return v;
        }
        /** Read one Word (2 Byte) from stream (big ending) */
        readWordBE(offset) {
            if (offset == null)
                offset = this.pos;
            let v = (this.data[offset]) | (this.data[offset + 1] << 8);
            this.pos = offset + 2;
            return v;
        }
        /** Read a String */
        readString(length, offset) {
            if (offset === null)
                this.pos = offset + this.hiddenOffset;
            let result = "";
            for (let i = 0; i < length; i++) {
                let v = this.data[this.pos];
                this.pos++;
                result += String.fromCharCode(v);
            }
            return result;
        }
        /** return the current cursor position */
        getOffset() {
            return this.pos - this.hiddenOffset;
        }
        /** set the current cursor position */
        setOffset(newPos) {
            this.pos = newPos + this.hiddenOffset;
        }
        /** return true if the cursor position is out of data */
        eof() {
            let pos = this.pos - this.hiddenOffset;
            return ((pos >= this.length) || (pos < 0));
        }
        /** return a String of the data */
        readAll() {
            return this.readString(this.length, 0);
        }
    }
    Lemmings.BinaryReader = BinaryReader;

export { BinaryReader };
