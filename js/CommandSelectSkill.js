import { Lemmings } from './LemmingsNamespace.js';

class CommandSelectSkill {
    static gameSkills = null;
    static log = null;

    static setManagers(gameSkills) {
        CommandSelectSkill.gameSkills = gameSkills;
    }

    constructor(skill) {
        if (!CommandSelectSkill.log) {
            CommandSelectSkill.log = new Lemmings.LogHandler("CommandSelectSkill");
        }
        
        if (skill)
            this.skill = skill;
    }
    getCommandKey() {
        return "s";
    }
    load(values) {
        if (values.length < 1) {
            CommandSelectSkill.log.log("Unable to process load");
            return;
        }
        this.skill = values[0];
    }
    save() {
        return [+(this.skill)];
    }
    execute() {
        return CommandSelectSkill.gameSkills.setSelectedSkill(this.skill);
    }
    dispose() {
        CommandSelectSkill.gameSkills = null;
    }
}
Lemmings.CommandSelectSkill = CommandSelectSkill;
export { CommandSelectSkill };
