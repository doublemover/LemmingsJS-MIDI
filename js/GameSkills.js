import { Lemmings } from './LemmingsNamespace.js';

class GameSkills {
        constructor(level) {
            this.selectedSkill = Lemmings.SkillTypes.CLIMBER;
            this.onCountChanged = new Lemmings.EventHandler();
            this.onSelectionChanged = new Lemmings.EventHandler();
            this.skills = level.skills;
        }
        /** return true if the skill can be reused / used */
        canReuseSkill(type) {
            return (this.skills[type] > 0);
        }
        reuseSkill(type) {
            if (this.skills[type] <= 0)
                return false;
            this.skills[type]--;
            this.onCountChanged.trigger(type);
            return true;
        }
        getSkill(type) {
            if (!Lemmings.SkillTypes[Object.keys(Lemmings.SkillTypes)[type]])
                return 0;
            return this.skills[type];
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
            for (let i = 0; i < this.skills.length; i++) {
                this.skills[i] = 99;
                this.onCountChanged.trigger(i);
            }
        }
    }
    Lemmings.GameSkills = GameSkills;

export { GameSkills };
