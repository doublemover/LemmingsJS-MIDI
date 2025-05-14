import { Lemmings } from './LemmingsNamespace.js';

class SkillPanelSprites {
        constructor(fr2, fr6, colorPalette) {
            this.letterSprite = {};
            this.numberSpriteLeft = [];
            this.numberSpriteRight = [];
            /// read skill panel
            let paletteImg = new Lemmings.PaletteImage(320, 40);
            paletteImg.processImage(fr6, 4);
            this.panelSprite = paletteImg.createFrame(colorPalette);
            /// read green panel letters
            let letters = ["%", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"];
            for (let l = 0; l < letters.length; l++) {
                let paletteImg = new Lemmings.PaletteImage(8, 16);
                paletteImg.processImage(fr6, 3);
                this.letterSprite[letters[l]] = paletteImg.createFrame(colorPalette);
            }
            /// add space
            let emptyFrame = new Lemmings.Frame(8, 16);
            emptyFrame.fill(0, 0, 0);
            this.letterSprite[" "] = emptyFrame;
            let blackAndWithPalette = new Lemmings.ColorPalette();
            blackAndWithPalette.setColorRGB(1, 255, 255, 255);
            /// read panel skill-count number letters
            fr2.setOffset(0x1900);
            for (let i = 0; i < 10; i++) {
                let paletteImgRight = new Lemmings.PaletteImage(8, 8);
                paletteImgRight.processImage(fr2, 1);
                paletteImgRight.processTransparentByColorIndex(0);
                this.numberSpriteRight.push(paletteImgRight.createFrame(blackAndWithPalette));
                let paletteImgLeft = new Lemmings.PaletteImage(8, 8);
                paletteImgLeft.processImage(fr2, 1);
                paletteImgLeft.processTransparentByColorIndex(0);
                this.numberSpriteLeft.push(paletteImgLeft.createFrame(blackAndWithPalette));
            }
            /// add space
            this.emptyNumberSprite = new Lemmings.Frame(9, 8);
            this.emptyNumberSprite.fill(255, 255, 255);
        }
        /** return the sprite for the skill panel */
        getPanelSprite() {
            return this.panelSprite;
        }
        /** return a green letter */
        getLetterSprite(letter) {
            return this.letterSprite[letter.toUpperCase()];
        }
        /** return a number letter */
        getNumberSpriteLeft(number) {
            return this.numberSpriteLeft[number];
        }
        /** return a number letter */
        getNumberSpriteRight(number) {
            return this.numberSpriteRight[number];
        }
        getNumberSpriteEmpty() {
            return this.emptyNumberSprite;
        }
    }
    Lemmings.SkillPanelSprites = SkillPanelSprites;

export { SkillPanelSprites };
