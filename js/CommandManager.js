import { Lemmings } from './LemmingsNamespace.js';

class CommandManager {
    constructor(game, gameTimer) {
        this.game = game;
        this.gameTimer = gameTimer;
        this.log = new Lemmings.LogHandler("CommandManager");
        this.runCommands = {};
        this.loggedCommads = {};
        this.gameTimer.onBeforeGameTick.on((tick) => {
            // Set static managers for all command classes before executing commands
            const lemmingManager = this.game.getLemmingManager();
            const victoryCondition = this.game.getVictoryCondition();
            const gameSkills = this.game.getGameSkills();
            
            // if (Lemmings.CommandLemmingsAction.lemmingManager !== lemmingManager || Lemmings.CommandLemmingsAction.gameSkills !== gameSkills) {
            Lemmings.CommandLemmingsAction.setManagers(lemmingManager, gameSkills);
            Lemmings.CommandSelectSkill.setManagers(gameSkills);
            // }
            if (Lemmings.CommandNuke.lemmingManager !== lemmingManager || Lemmings.CommandNuke.victoryCondition !== victoryCondition) {
                Lemmings.CommandNuke.setManagers(lemmingManager, victoryCondition);
            }
            if (Lemmings.CommandReleaseRateIncrease.victoryCondition !== victoryCondition) {
                Lemmings.CommandReleaseRateIncrease.setManagers(victoryCondition);
            }
            if (Lemmings.CommandReleaseRateDecrease.victoryCondition !== victoryCondition) {
                Lemmings.CommandReleaseRateDecrease.setManagers(victoryCondition);
            }
            

            const command = this.runCommands[tick];
            if (!command)
                return;
            this.queueCommand(command);
        });
    }
    /** load parameters for this command from serializer */
    loadReplay(replayString) {
        let parts = replayString.split("&");
        for (let i = 0; i < parts.length; i++) {
            let commandStr = parts[i].split("=", 2);
            if (commandStr.length != 2)
                continue;
            let tick = (+commandStr[0]) | 0;
            this.runCommands[tick] = this.parseCommand(commandStr[1]);
        }
    }
    commandFactory(type) {
        switch (type.toLowerCase()) {
        case "l":
            return new Lemmings.CommandLemmingsAction();
        case "n":
            return new Lemmings.CommandNuke();
        case "s":
            return new Lemmings.CommandSelectSkill();
        case "i":
            return new Lemmings.CommandReleaseRateIncrease();
        case "d":
            return new Lemmings.CommandReleaseRateDecrease();
        default:
            return null;
        }
    }
    parseCommand(valuesStr) {
        if (valuesStr.length < 1)
            return;
        let newCommand = this.commandFactory(valuesStr.substr(0, 1));
        let values = valuesStr.substr(1).split(":");
        newCommand.load(values.map(Number));
        return newCommand;
    }
    /** add a command to execute queue */
    queueCommand(newCommand) {
        let currentTick = this.gameTimer.getGameTicks();
        // Execute without passing game, use statics
        if (newCommand.execute()) {
            // only log commands that are executable
            this.loggedCommads[currentTick] = newCommand;
        }
    }
    serialize() {
        this._clearCommandCaches();
        let result = [];
        Object.keys(this.loggedCommads).forEach((key) => {
            let command = this.loggedCommads[+key];
            result.push(key + "=" + command.getCommandKey() + command.save().join(":"));
        });
        return result.join("&");
    }
    _clearCommandCaches() {
        Lemmings.CommandLemmingsAction.lemmingManager = null;
        Lemmings.CommandLemmingsAction.gameSkills = null;
        Lemmings.CommandLemmingsAction._lemmingCache = new Map();
        Lemmings.CommandSelectSkill.gameSkills = null;
        Lemmings.CommandNuke.lemmingManager = null;
        Lemmings.CommandNuke.victoryCondition = null;
        Lemmings.CommandReleaseRateIncrease.victoryCondition = null;
        Lemmings.CommandReleaseRateDecrease.victoryCondition = null;
    }
}
Lemmings.CommandManager = CommandManager;

export { CommandManager };
