import { Lemmings } from './LemmingsNamespace.js';

class LevelReader {
        /// Load a Level
        constructor(fr) {
            this.levelWidth = 1600;
            this.levelHeight = 160;
            this.levelProperties = new Lemmings.LevelProperties();
            this.screenPositionX = 0;
            /** index of GROUNDxO.DAT file */
            this.graphicSet1 = 0;
            /** index of VGASPECx.DAT */
            this.graphicSet2 = 0;
            this.isSuperLemming = false;
            this.objects = [];
            this.terrains = [];
            this.steel = [];
            this.log = new Lemmings.LogHandler("LevelReader");
            this.readLevelInfo(fr);
            this.readLevelObjects(fr);
            this.readLevelTerrain(fr);
            this.readSteelArea(fr);
            this.readLevelName(fr);
            this.log.debug(this);
        }
        /** read general Level information */
        readLevelInfo(fr) {
            fr.setOffset(0);
            this.levelProperties.releaseRate = fr.readWord();
            this.levelProperties.releaseCount = fr.readWord();
            this.levelProperties.needCount = fr.readWord();
            this.levelProperties.timeLimit = fr.readWord();
            //- read amount of skills
            this.levelProperties.skills.fill(0);
            this.levelProperties.skills[Lemmings.SkillTypes.CLIMBER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.FLOATER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BOMBER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BLOCKER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BUILDER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.BASHER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.MINER] = fr.readWord();
            this.levelProperties.skills[Lemmings.SkillTypes.DIGGER] = fr.readWord();
            this.screenPositionX = fr.readWord();
            this.graphicSet1 = fr.readWord();
            this.graphicSet2 = fr.readWord();
            this.isSuperLemming = (fr.readWord() != 0);
        }
        /** read the level objects */
        readLevelObjects(fr) {
            /// reset array
            this.objects = [];
            fr.setOffset(0x0020);
            for (var i = 0; i < 32; i++) {
                var newOb = new Lemmings.LevelElement();
                newOb.x = fr.readWord() - 16;
                newOb.y = fr.readWord();
                newOb.id = fr.readWord();
                var flags = fr.readWord();
                let isUpsideDown = ((flags & 0x0080) > 0);
                let noOverwrite = ((flags & 0x8000) > 0);
                let onlyOverwrite = ((flags & 0x4000) > 0);
                newOb.drawProperties = new Lemmings.DrawProperties(isUpsideDown, noOverwrite, onlyOverwrite, false);
                /// ignore empty items/objects
                if (flags == 0)
                    continue;
                this.objects.push(newOb);
            }
        }
        /** read the Level Objects */
        readLevelTerrain(fr) {
            /// reset array
            this.terrains = [];
            fr.setOffset(0x0120);
            for (var i = 0; i < 400; i++) {
                var newOb = new Lemmings.LevelElement();
                var v = fr.readInt(4);
                if (v == -1)
                    continue;
                newOb.x = ((v >> 16) & 0x0FFF) - 16;
                var y = ((v >> 7) & 0x01FF);
                newOb.y = y - ((y > 256) ? 516 : 4);
                newOb.id = (v & 0x003F);
                var flags = ((v >> 29) & 0x000F);
                let isUpsideDown = ((flags & 2) > 0);
                let noOverwrite = ((flags & 4) > 0);
                let isErase = ((flags & 1) > 0);
                newOb.drawProperties = new Lemmings.DrawProperties(isUpsideDown, noOverwrite, false, isErase);
                this.terrains.push(newOb);
            }
        }
        /** read Level Steel areas (Lemming can't pass) */
        readSteelArea(fr, isLemEdit = false) {
            const X_OFFSET = isLemEdit ? 12 : 16;   // originals use −16, LemEdit uses −12
            /// reset array
            this.steel = [];
            fr.setOffset(0x0760);
            for (var i = 0; i < 32; i++) {
                const low = fr.readByte();
                const high = fr.readByte();
                const size = fr.readByte();
                const flag = fr.readByte();
                const pos = (high << 8) | low;
                if (pos === 0 && size === 0) continue; // end-of-list marker
                // 9-bit X in 8-px steps, origin −X_OFFSET
                const x = ((pos & 0x00FF) << 3) - X_OFFSET;
                // 7-bit Y in 8-px steps, origin 0
                let y = (((pos >> 9) & 0x7F) << 3);
                // idk if this is needed
                y = y % 256;
                // each nibble is “blocks − 1”, one block = 4 px
                const width = (((size >> 4) & 0x0F) + 1) * 4; 
                const height = ((size & 0x0F) + 1) * 4;

                var newRange = new Lemmings.Range();
                newRange.x = x;
                newRange.y = y;
                newRange.width = width;
                newRange.height = height;

                if (flag === 0) {
                    this.steel.push(newRange);
                }
            }
        }
        /** read general Level information */
        readLevelName(fr) {
            /// at the end of the 
            this.levelProperties.levelName = fr.readString(32, 0x07E0);
            this.log.debug("Level Name: " + this.levelProperties.levelName);
        }
    }
    Lemmings.LevelReader = LevelReader;

export { LevelReader };
