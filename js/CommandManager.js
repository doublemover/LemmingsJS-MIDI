import { Lemmings } from './LemmingsNamespace.js';

class CommandManager {
        constructor(game, gameTimer) {
            this.game = game;
            this.gameTimer = gameTimer;
            this.log = new Lemmings.LogHandler("CommandManager");
            this.runCommands = {};
            this.loggedCommads = {};
            this.gameTimer.onBeforeGameTick.on((tick) => {
                let command = this.runCommands[tick];
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
            if (newCommand.execute(this.game)) {
                // only log commands that are executable
                this.loggedCommads[currentTick] = newCommand;
            }
        }
        serialize() {
            let result = [];
            Object.keys(this.loggedCommads).forEach((key) => {
                let command = this.loggedCommads[+key];
                result.push(key + "=" + command.getCommandKey() + command.save().join(":"));
            });
            return result.join("&");
        }
    }
    Lemmings.CommandManager = CommandManager;

export { CommandManager };
