import { Lemmings } from './LemmingsNamespace.js';

class GroundReader {
        /** groundFile: GROUNDxO.DAT
         *  vgaTerrar: Part of VGAGx.DAT for the terrar-images
         *  vgaObject: Part of VGAGx.DAT with the object-images
         */
        constructor(groundFile, vgaTerrar, vgaObject) {
            this.imgObjects = new Array(16);
            this.imgTerrar = new Array(64);
            /** the color palette stored in this file */
            this.groundPalette = new Lemmings.ColorPalette();
            this.colorPalette = new Lemmings.ColorPalette();
            this.log = new Lemmings.LogHandler("GroundReader");
            if (groundFile.length != 1056) {
                this.log.log("groundFile " + groundFile.filename + " has wrong size: " + groundFile.length);
                return;
            }
            let BYTE_SIZE_OF_OBJECTS = 28 * 16;
            let BYTE_SIZE_OF_TERRAIN = 64 * 8;
            this.readPalettes(groundFile, BYTE_SIZE_OF_OBJECTS + BYTE_SIZE_OF_TERRAIN);
            this.readObjectImages(groundFile, 0, this.colorPalette);
            this.readTerrainImages(groundFile, BYTE_SIZE_OF_OBJECTS, this.groundPalette);
            this.readImages(this.imgObjects, vgaObject, 4);
            this.readImages(this.imgTerrar, vgaTerrar, 3);
        }
        /** return the images (meta + data) used for the Background */
        getTerraImages() {
            return this.imgTerrar;
        }
        /** return the images (meta + data) used for the map objects*/
        getObjectImages() {
            return this.imgObjects;
        }
        /** loads all images of imgList from the VGAGx file */
        readImages(imgList, vga, bitPerPixel) {
            imgList.map((img) => {
                img.frames = [];
                let filePos = img.imageLoc;
                for (let f = 0; f < img.frameCount; f++) {
                    var bitImage = new Lemmings.PaletteImage(img.width, img.height);
                    //// read image
                    bitImage.processImage(vga, bitPerPixel, filePos);
                    bitImage.processTransparentData(vga, filePos + img.maskLoc);
                    img.frames.push(bitImage.getImageBuffer());
                    /// move to the next frame data
                    filePos += img.frameDataSize;
                }
            });
        }
        /** loads the properties for object-images from the groundFile  */
        readObjectImages(frO, offset, colorPalett) {
            /// offset to the objects
            frO.setOffset(offset);
            for (let i = 0; i < 16; i++) {
                let img = new Lemmings.ObjectImageInfo();
                let flags = frO.readWordBE();
                img.animationLoop = ((flags & 1) == 0);
                img.firstFrameIndex = frO.readByte();
                img.frameCount = frO.readByte();
                img.width = frO.readByte();
                img.height = frO.readByte();
                img.frameDataSize = frO.readWordBE();
                img.maskLoc = frO.readWordBE();
                img.unknown1 = frO.readWordBE();
                img.unknown2 = frO.readWordBE();
                img.trigger_left = frO.readWordBE() * 4;
                img.trigger_top = frO.readWordBE() * 4 - 4;
                img.trigger_width = frO.readByte() * 4;
                img.trigger_height = frO.readByte() * 4;
                img.trigger_effect_id = frO.readByte();
                img.imageLoc = frO.readWordBE();
                img.preview_image_index = frO.readWordBE();
                img.unknown = frO.readWordBE();
                img.trap_sound_effect_id = frO.readByte();
                img.palette = colorPalett;
                if (frO.eof()) {
                    this.log.log("readObjectImages() : unexpected end of file: " + frO.filename);
                    return;
                }
                //- add Object
                this.imgObjects[i] = img;
            }
        }
        /** loads the properties for terrain-images  */
        readTerrainImages(frO, offset, colorPalette) {
            frO.setOffset(offset);
            for (let i = 0; i < 64; i++) {
                let img = new Lemmings.TerrainImageInfo();
                img.width = frO.readByte();
                img.height = frO.readByte();
                img.imageLoc = frO.readWordBE();
                /// use the delta offset to be compatible with the 'ObjectImageInfo.maskLoc'
                img.maskLoc = frO.readWordBE() - img.imageLoc;
                img.vgaLoc = frO.readWordBE();
                img.palette = colorPalette;
                img.frameCount = 1;
                if (frO.eof()) {
                    this.log.log("readTerrainImages() : unexpected end of file! " + frO.filename);
                    return;
                }
                //- add Object
                this.imgTerrar[i] = img;
            }
        }
        /** loads the palettes  */
        readPalettes(frO, offset) {
            /// jump over the EGA palettes
            frO.setOffset(offset + 3 * 8);
            /// read the VGA palette index 8..15
            for (let i = 0; i < 8; i++) {
                let r = frO.readByte() << 2;
                let g = frO.readByte() << 2;
                let b = frO.readByte() << 2;
                this.groundPalette.setColorRGB(i, r, g, b);
            }
            /// read the VGA palette index 0..7
            for (var i = 0; i < 8; i++) {
                let r = frO.readByte() << 2;
                let g = frO.readByte() << 2;
                let b = frO.readByte() << 2;
                this.colorPalette.setColorRGB(i, r, g, b);
            }
            /// read the VGA palette index 8..15 for preview
            for (let i = 8; i < 16; i++) {
                let r = frO.readByte() << 2;
                let g = frO.readByte() << 2;
                let b = frO.readByte() << 2;
                this.colorPalette.setColorRGB(i, r, g, b);
            }
        }
    }
    Lemmings.GroundReader = GroundReader;

export { GroundReader };
