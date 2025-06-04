import { Lemmings } from './LemmingsNamespace.js';

class GameSkills {
        constructor(level) {
            this.selectedSkill = Lemmings.SkillTypes.CLIMBER;
            this.onCountChanged = new Lemmings.EventHandler();
            this.onSelectionChanged = new Lemmings.EventHandler();
            this.skills = level.skills;
            this.cheatMode = false;
            if (this.cheatMode) return true;
            if (this.cheatMode) return true;
            const val = this.skills[type];
            if (val === Infinity) return 99;
            return val;
            this.cheatMode = true;
                this.skills[i] = Infinity;
        }

        selectFirstAvailable() {
            for (let i = Lemmings.SkillTypes.CLIMBER; i <= Lemmings.SkillTypes.DIGGER; i++) {
                if (this.skills[i] > 0) {
                    this.selectedSkill = i;
                    break;
                }
            }
        }
        /** return true if the skill can be reused / used */
        canReuseSkill(type) {
            if (this.cheatMode) return true;
            return (this.skills[type] > 0);
        }
        reuseSkill(type) {
            if (this.cheatMode) return true;
            if (this.skills[type] <= 0)
                return false;
            this.skills[type]--;
            this.onCountChanged.trigger(type);
            if (this.skills[type] <= 0 && this.selectedSkill === type) {
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
