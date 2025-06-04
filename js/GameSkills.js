import { Lemmings } from './LemmingsNamespace.js';

class GameSkills {
        constructor(level) {
            this.selectedSkill = Lemmings.SkillTypes.CLIMBER;
            this.onCountChanged = new Lemmings.EventHandler();
            this.onSelectionChanged = new Lemmings.EventHandler();
            this.skills = level.skills;
            return this.skills[type];
                this.skills[i] = 99;
                this.selectFirstAvailable();
            }
            return true;
        }
        getSkill(type) {
            if (!Lemmings.SkillTypes[Object.keys(Lemmings.SkillTypes)[type]])
                return 0;
            const val = this.skills[type];
            if (val === Infinity) return 99;
            return val;
        }
        getSelectedSkill() {
            return this.selectedSkill;
        }
        setSelectedSkill(skill) {
            if (this.selectedSkill == skill) {
                return false;
            }
            if (!Lemmings.SkillTypes[Object.keys(Lemmings.SkillTypes)[skill]]) {
                return false;
            }
            this.selectedSkill = skill;
            this.onSelectionChanged.trigger();
            return true;
        }
        /** increase the amount of actions for all skills */
        cheat() {
            this.cheatMode = true;
            for (let i = 0; i < this.skills.length; i++) {
                this.skills[i] = Infinity;
                this.onCountChanged.trigger(i);
            }
        }

        clearSelectedSkill() {
            if (this.selectedSkill !== Lemmings.SkillTypes.UNKNOWN) {
                this.selectedSkill = Lemmings.SkillTypes.UNKNOWN;
                this.onSelectionChanged.trigger();
                return true;
            }
            return false;
        }
    }
    Lemmings.GameSkills = GameSkills;

export { GameSkills };
