import { Lemmings } from './LemmingsNamespace.js';

class CommandLemmingsAction {
        constructor(lemmingId) {
            this.log = new Lemmings.LogHandler("CommandLemmingsAction");
            if (lemmingId != null)
                this.lemmingId = lemmingId;
        }
        getCommandKey() {
            return "l";
        }
        /** load parameters for this command from serializer */
        load(values) {
            if (values.length < 1) {
                this.log.log("Unable to process load");
                return;
            }
            this.lemmingId = values[0];
        }
        /** save parameters of this command to serializer */
        save() {
            return [this.lemmingId];
        }
        /** execute this command */
        execute(game) {
            let lemManager = game.getLemmingManager();
            let lem = lemManager.getLemming(this.lemmingId);
            if (!lem) {
                this.log.log("Lemming not found! " + this.lemmingId);
                return false;
            }
            let skills = game.getGameSkills();
            let selectedSkill = skills.getSelectedSkill();
            if (!skills.canReuseSkill(selectedSkill)) {
                this.log.log("Not enough skills!");
                return false;
            }
            /// set the skill
            if (!lemManager.doLemmingAction(lem, selectedSkill)) {
                this.log.log("unable to execute action on lemming!");
                return false;
            }
            /// reduce the available skill count
            return skills.reuseSkill(selectedSkill);
        }
    }
    Lemmings.CommandLemmingsAction = CommandLemmingsAction;

export { CommandLemmingsAction };
