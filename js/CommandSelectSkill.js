import { Lemmings } from './LemmingsNamespace.js';

class CommandSelectSkill {
        constructor(skill) {
            this.log = new Lemmings.LogHandler("CommandSelectSkill");
            if (skill)
                this.skill = skill;
        }
        getCommandKey() {
            return "s";
        }
        /** load parameters for this command from serializer */
        load(values) {
            if (values.length < 0) {
                this.log.log("Unable to process load");
                return;
            }
            this.skill = values[0];
        }
        /** save parameters of this command to serializer */
        save() {
            return [+(this.skill)];
        }
        /** execute this command */
        execute(game) {
            let gameSkill = game.getGameSkills();
            return gameSkill.setSelectedSkill(this.skill);
        }
    }
    Lemmings.CommandSelectSkill = CommandSelectSkill;

export { CommandSelectSkill };
