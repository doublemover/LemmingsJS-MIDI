import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

class OddTableReader extends Lemmings.BaseLogger {
        constructor(oddfile) {
            super();
            this.levelProperties = [];
            this.read(oddfile);
        }
        /** return the Level for a given levelNumber - LevelNumber is counting all levels from first to last of the game
         *  Odd-Tables are only used for the "Original Lemmings" Game
         */
        getLevelProperties(levelNumber) {
            if ((levelNumber >= this.levelProperties.length) || (levelNumber < 0))
                return null;
            return this.levelProperties[levelNumber];
        }
        /** read the odd fine */
        read(fr) {
            fr.setOffset(0);
            /// count of levels definitions
            let count = Math.trunc(fr.length / 56);
            for (let i = 0; i < count; i++) {
                let prop = new Lemmings.LevelProperties();
                prop.releaseRate = fr.readWord();
                prop.releaseCount = fr.readWord();
                prop.needCount = fr.readWord();
                prop.timeLimit = fr.readWord();
                //- read amount of skills
                prop.skills[Lemmings.SkillTypes.CLIMBER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.FLOATER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BOMBER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BLOCKER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BUILDER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.BASHER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.MINER] = fr.readWord();
                prop.skills[Lemmings.SkillTypes.DIGGER] = fr.readWord();
                prop.levelName = fr.readString(32);
                this.log.debug("Level (" + i + ") Name: " + prop.levelName + " " + prop.needCount + " " + prop.timeLimit);
                this.levelProperties.push(prop);
            }
            this.log.debug("levelProperties: " + this.levelProperties.length);
        }
    }
    Lemmings.OddTableReader = OddTableReader;

export { OddTableReader };
