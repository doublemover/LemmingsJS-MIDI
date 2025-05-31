import { Lemmings } from './LemmingsNamespace.js';

class CommandManager {
    static gameTimer = null;
    static log = null;
    static game = null;
    static setManagers() {
        const lemmingManager = CommandManager.game.getLemmingManager();
        const victoryCondition = CommandManager.game.getVictoryCondition();
        const gameSkills = CommandManager.game.getGameSkills();
        Lemmings.CommandLemmingsAction.setManagers(lemmingManager, gameSkills);
        Lemmings.CommandSelectSkill.setManagers(gameSkills);
        Lemmings.CommandNuke.setManagers(lemmingManager, victoryCondition);
        Lemmings.CommandReleaseRateIncrease.setManagers(victoryCondition);
        Lemmings.CommandReleaseRateDecrease.setManagers(victoryCondition);
    }
    constructor(game, gameTimer) {
        if (!CommandManager.log) {
            CommandManager.log = new Lemmings.LogHandler("CommandManager");
        }
        if (game == null || gameTimer == null) {
            CommandManager.log.log("error! game/timer is null");
            return;
        }
        if (!CommandManager.gameTimer) {
            CommandManager.gameTimer = gameTimer;
        }
        if (!CommandManager.game) {
            this.setGame(game);
        }
        
        this.runCommands = {};
        this.loggedCommads = {};

        this.once = true;
        CommandManager.gameTimer.onBeforeGameTick.on((tick) => {
            if (this.once) {
                CommandManager.setManagers();
                this.once = false;
            }
            const command = this.runCommands[tick];
            if (!command)
                return;
            this.queueCommand(command);
        });
    }

    setGame(game) {
        if (game == null) {
            return;
        }
        CommandManager.game = game;
        CommandManager.setManagers()
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
        const newCommand = this.commandFactory(valuesStr.substr(0, 1));
        const values = valuesStr.substr(1).split(":");
        newCommand.load(values.map(Number));
        return newCommand;
    }
    /** add a command to execute queue */
    queueCommand(newCommand) {
        const currentTick = CommandManager.gameTimer?.getGameTicks();
        // Execute without passing game, use statics
        if (currentTick && newCommand.execute()) {
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
    dispose() {
        if (CommandManager.gameTimer.onBeforeGameTick && CommandManager.gameTimer.onBeforeGameTick.dispose)
          CommandManager.gameTimer.onBeforeGameTick.dispose();
        CommandManager.gameTimer = null;
        CommandManager.game = null;
        CommandManager.log = null;
    }
}
Lemmings.CommandManager = CommandManager;

export { CommandManager };
