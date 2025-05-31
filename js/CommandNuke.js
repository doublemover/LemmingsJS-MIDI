import { Lemmings } from './LemmingsNamespace.js';

class CommandNuke {
    static lemmingManager = null;
    static victoryCondition = null;
    static log = null;
    static setManagers(lemmingManager, victoryCondition) {
        CommandNuke.lemmingManager = lemmingManager;
        CommandNuke.victoryCondition = victoryCondition;
    }

    constructor() {
        if (!CommandNuke.log) {
            CommandNuke.log = new Lemmings.LogHandler("CommandNuke");
        }
    }
    getCommandKey() {
        return "n";
    }
    load(values) {}
    save() {
        return [];
    }
    execute() {
        const lemManager = CommandNuke.lemmingManager;
        if (lemManager?.isNuking())
            return false;
        lemManager?.doNukeAllLemmings();
        CommandNuke.victoryCondition?.doNuke();
        return true;
    }
    dispose() {
        CommandNuke.lemmingManager = null;
        CommandNuke.victoryCondition = null;
    }
}
Lemmings.CommandNuke = CommandNuke;
export { CommandNuke };
