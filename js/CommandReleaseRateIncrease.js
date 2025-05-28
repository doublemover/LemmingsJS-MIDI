import { Lemmings } from './LemmingsNamespace.js';

class CommandReleaseRateIncrease {
    static victoryCondition = null;

    static setManagers(victoryCondition) {
        CommandReleaseRateIncrease.victoryCondition = victoryCondition;
    }

    constructor(number) {
        this.log = new Lemmings.LogHandler("CommandReleaseRateIncrease");
        if (number != null)
            this.number = number;
    }
    getCommandKey() {
        return "i";
    }
    load(values) {
        if (values.length < 1) {
            this.log.log("Unable to process load");
            return;
        }
        this.number = values[0];
    }
    save() {
        return [this.number];
    }
    execute() {
        return CommandReleaseRateIncrease.victoryCondition?.changeReleaseRate(this.number);
    }
}
Lemmings.CommandReleaseRateIncrease = CommandReleaseRateIncrease;
export { CommandReleaseRateIncrease };
