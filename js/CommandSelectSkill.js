import { Lemmings } from './LemmingsNamespace.js';

class CommandSelectSkill {
    static gameSkills = null;

    static setManagers(gameSkills) {
        CommandSelectSkill.gameSkills = gameSkills;
    }

    constructor(skill) {
        this.log = new Lemmings.LogHandler("CommandSelectSkill");
        if (skill)
            this.skill = skill;
    }
    getCommandKey() {
        return "s";
    }
    load(values) {
        if (values.length < 1) {
            this.log.log("Unable to process load");
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
}
Lemmings.CommandSelectSkill = CommandSelectSkill;
export { CommandSelectSkill };
