import { Lemmings } from './LemmingsNamespace.js';

class CommandReleaseRateDecrease {
    static victoryCondition = null;
    static log = null;
    static setManagers(victoryCondition) {
        CommandReleaseRateDecrease.victoryCondition = victoryCondition;
    }

    constructor(number) {
        if (!CommandReleaseRateDecrease.log) {
            CommandReleaseRateDecrease.log = new Lemmings.LogHandler("CommandReleaseRateDecrease");
        }
        if (number != null)
            this.number = number;
    }
    getCommandKey() {
        return "d";
    }
    load(values) {
        if (values.length < 1) {
            CommandReleaseRateDecrease.log.log("Unable to process load");
            return;
        }
        this.number = values[0];
    }
    save() {
        return [this.number];
    }
    execute() {
        return CommandReleaseRateDecrease.victoryCondition?.changeReleaseRate(-this.number);
    }
    dispose() {
        CommandReleaseRateDecrease.victoryCondition = null;
    }
}
Lemmings.CommandReleaseRateDecrease = CommandReleaseRateDecrease;
export { CommandReleaseRateDecrease };
