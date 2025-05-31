import { Lemmings } from './LemmingsNamespace.js';

class CommandReleaseRateIncrease {
    constructor(number) {
        this.number = number;
    }

    execute(game) {
        const gameVictoryCondition = game.getVictoryCondition();
        if (!gameVictoryCondition) return false;
        return gameVictoryCondition.changeReleaseRate(this.number);
    }

    load() {}
    save() { return []; }
    getCommandKey() { return "i"; }
}

Lemmings.CommandReleaseRateIncrease = CommandReleaseRateIncrease;
export { CommandReleaseRateIncrease };
