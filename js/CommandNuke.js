import { Lemmings } from './LemmingsNamespace.js';

class CommandNuke {
        constructor() {
            this.log = new Lemmings.LogHandler("CommandNuke");
        }
        getCommandKey() {
            return "n";
        }
        load(values) {}
        save() {
            return [];
        }
        /** execute this command */
        execute(game) {
            let lemManager = game.getLemmingManager();
            if (lemManager.isNuking())
                return false;
            lemManager.doNukeAllLemmings();
            game.getVictoryCondition().doNuke();
            return true;
        }
    }
    Lemmings.CommandNuke = CommandNuke;

export { CommandNuke };
