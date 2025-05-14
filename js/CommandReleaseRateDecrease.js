import { Lemmings } from './LemmingsNamespace.js';

class CommandReleaseRateDecrease {
        constructor(number) {
            this.log = new Lemmings.LogHandler("CommandReleaseRateDecrease");
            if (number != null)
                this.number = number;
        }
        getCommandKey() {
            return "d";
        }
        /** load parameters for this command from serializer */
        load(values) {
            if (values.length < 1) {
                this.log.log("Unable to process load");
                return;
            }
            this.number = values[0];
        }
        /** save parameters of this command to serializer */
        save() {
            return [this.number];
        }
        /** execute this command */
        execute(game) {
            let victoryConditions = game.getVictoryCondition();
            return victoryConditions.changeReleaseRate(-this.number);
        }
    }
    Lemmings.CommandReleaseRateDecrease = CommandReleaseRateDecrease;

export { CommandReleaseRateDecrease };
