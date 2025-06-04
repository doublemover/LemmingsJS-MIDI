import { Lemmings } from './LemmingsNamespace.js';

class UnpackFilePart {
        constructor(fileReader) {
            /** file offset in the container */
            this.offset = 0;
            /** flag for uncompressing */
            this.initialBufferLen = 0;
            /** checksum this file need to have */
            this.checksum = 0;
            /** size the uncompressed chunk should have */
            this.decompressedSize = 0;
            /** the size the compressed chunk had */
            this.compressedSize = 0;
            this.unknown0 = 0;
            this.unknown1 = 0;
            /** position of this part/chunk in the container */
            this.index = 0;
            this.log = new Lemmings.LogHandler("UnpackFilePart");
            this.fileReader = fileReader;
            this.unpackingDone = false;
        }
        /** unpack this content and return a BinaryReader */
        unpack() {
            /// if the unpacking is not yet done, do it...
            if (!this.unpackingDone) {
                this.fileReader = this.doUnpacking(this.fileReader);
                this.unpackingDone = true;
                return this.fileReader;
            }
            /// use the cached file buffer but with a new file pointer
            return new Lemmings.BinaryReader(this.fileReader);
        }
        /// unpack the fileReader
        doUnpacking(fileReader) {
            var bitReader = new Lemmings.BitReader(fileReader, this.offset, this.compressedSize, this.initialBufferLen);
            var outBuffer = new Lemmings.BitWriter(bitReader, this.decompressedSize);
            while ((!outBuffer.eof()) && (!bitReader.eof())) {
                if (bitReader.read(1) == 0) {
                    switch (bitReader.read(1)) {
                    case 0:
                        outBuffer.copyRawData(bitReader.read(3) + 1);
                        break;
                    case 1:
                        outBuffer.copyReferencedData(2, 8);
                        break;
                    }
                } else {
                    switch (bitReader.read(2)) {
                    case 0:
                        outBuffer.copyReferencedData(3, 9);
                        break;
                    case 1:
                        outBuffer.copyReferencedData(4, 10);
                        break;
                    case 2:
                        outBuffer.copyReferencedData(bitReader.read(8) + 1, 12);
                        break;
                    case 3:
                        outBuffer.copyRawData(bitReader.read(8) + 9);
                        break;
                    }
                }
            }
            if (this.checksum == bitReader.getCurrentChecksum()) {
                this.log.debug("doUnpacking(" + fileReader.filename + ") done! ");
            } else {
                this.log.log("doUnpacking(" + fileReader.filename + ") : Checksum mismatch! ");
            }
            /// create FileReader from buffer
            var outReader = outBuffer.getFileReader(fileReader.filename + "[" + this.index + "]");
            return outReader;
        }
    }
    Lemmings.UnpackFilePart = UnpackFilePart;

export { UnpackFilePart };
