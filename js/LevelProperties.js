import { Lemmings } from './LemmingsNamespace.js';

class LevelProperties {
    constructor() {
        this.levelName = "";
        this.releaseRate = 0;
        this.releaseCount = 0;
        this.needCount = 0;
        this.timeLimit = 0;
        this.skills = new Array(Object.keys(Lemmings.SkillTypes).length);
    }
}
Lemmings.LevelProperties = LevelProperties;

export { LevelProperties };
