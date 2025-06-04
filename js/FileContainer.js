import { Lemmings } from './LemmingsNamespace.js';

class FileContainer {
        /** read the content of the container  */
        constructor(content) {
            this.log = new Lemmings.LogHandler("FileContainer");
            this.read(content);
        }
        /** Unpack a part (chunks / segments) of the file and return it */
        getPart(index) {
            if ((index < 0) || (index >= this.parts.length)) {
                this.log.log("getPart(" + index + ") Out of index!");
                return new Lemmings.BinaryReader();
            }
            return this.parts[index].unpack();
        }
        /** return the number of parts in this file */
        count() {
            return this.parts.length;
        }
        /** do the read job and find all parts in this container */
        read(fileReader) {
            /// reset parts
            this.parts = new Array();
            /// we start at the end of the file
            var pos = 0;
            /// the size of the header
            const HEADER_SIZE = 10;
            while (pos + HEADER_SIZE < fileReader.length) {
                fileReader.setOffset(pos);
                let part = new Lemmings.UnpackFilePart(fileReader);
                /// start of the chunk
                part.offset = pos + HEADER_SIZE;
                /// Read Header of each Part
                part.initialBufferLen = fileReader.readByte();
                part.checksum = fileReader.readByte();
                part.unknown1 = fileReader.readWord();
                part.decompressedSize = fileReader.readWord();
                part.unknown0 = fileReader.readWord();
                var size = fileReader.readWord();
                part.compressedSize = size - HEADER_SIZE;
                /// position of this part in the container
                part.index = this.parts.length;
                /// check if the data are valid
                if ((part.offset < 0) || (size > 0xFFFFFF) || (size < 10)) {
                    this.log.log("out of sync " + fileReader.filename);
                    break;
                }
                //- add part
                this.parts.push(part);
                //this.error.debug(part);
                /// jump to next part
                pos += size;
            }
            this.log.debug(fileReader.filename + " has " + this.parts.length + " file-parts.");
        }
    }
    Lemmings.FileContainer = FileContainer;

export { FileContainer };
