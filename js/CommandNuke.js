import { Lemmings } from './LemmingsNamespace.js';

class CommandNuke {
    constructor() {}

    execute(game) {
        const lemmingManager = game.getLemmingManager();
        const gameVictoryCondition = game.getVictoryCondition();
        if (!lemmingManager || !gameVictoryCondition) return false;
        if (lemmingManager.isNuking()) return false;
        lemmingManager.doNukeAllLemmings();
        gameVictoryCondition.doNuke();
        return true;
    }

    load() {}
    save() { return []; }
    getCommandKey() { return "n"; }
}

Lemmings.CommandNuke = CommandNuke;
export { CommandNuke };
