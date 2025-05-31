import { Lemmings } from './LemmingsNamespace.js';

class CommandLemmingsAction {
    static lemmingManager = null;
    static gameSkills = null;
    static _lemmingCache = new Set();
    static log = null
    static setManagers(lemmingManager, gameSkills) {
        CommandLemmingsAction.lemmingManager = lemmingManager;
        CommandLemmingsAction.gameSkills = gameSkills;

        const lemmings = CommandLemmingsAction.lemmingManager?.getLemmings();
        const cacheSize = CommandLemmingsAction._lemmingCache.size;

        if (lemmings == null) {
            return;
        }

        // new level, clear the cache
        if (lemmings?.id === 0 &&  [...lemmings][0].action?.getActionName() == "falling") {
            CommandLemmingsAction._lemmingCache = new Set();
        }

        for (const lem of lemmings) {
                if (!CommandLemmingsAction._lemmingCache.has(lem) && lem.action != null) {
                    CommandLemmingsAction._lemmingCache.add(lem);
                }
            }
    }

    constructor(lemmingId) {
        if (!CommandLemmingsAction.log) {
            CommandLemmingsAction.log = new Lemmings.LogHandler("CommandLemmingsAction");
        }
        if (lemmingId != null) {
            this.lemmingId = lemmingId;
        }
    }
    getCommandKey() {
        return "l";
    }
    load(values) {
        if (values.length < 1) {
            CommandLemmingsAction.log.log("Unable to process load");
            return;
        }
        this.lemmingId = values[0];
    }
    save() {
        return [this.lemmingId];
    }
    #getLemming(lemmingID){
        const cachedLem = [...CommandLemmingsAction._lemmingCache][this.lemmingId];
        if (!cachedLem) {
            const lem = CommandLemmingsAction.lemmingManager.getLemming(this.lemmingId);
            if (!lem) {
                CommandLemmingsAction.log.log("Lemming not found! " + this.lemmingId);
                return false;
            }
            CommandLemmingsAction._lemmingCache.add(lem)
            return lem;
        } else {
            return cachedLem;
        }
        console.log("error in getlemming")
    }
    execute() {
        const cachedLem = this.#getLemming(this.lemmingId);
        const selectedSkill = CommandLemmingsAction.gameSkills.getSelectedSkill();
        if (!CommandLemmingsAction.gameSkills.canReuseSkill(selectedSkill)) {
            CommandLemmingsAction.log.log("Not enough skills!");
            return false;
        }
        if (!CommandLemmingsAction.lemmingManager.doLemmingAction(cachedLem, selectedSkill)) {
            CommandLemmingsAction.log.log("unable to execute action on lemming!");
            return false;
        }
        return CommandLemmingsAction.gameSkills.reuseSkill(selectedSkill);
    }

    dispose() {
        CommandLemmingsAction.lemmingManager = null;
        CommandLemmingsAction.gameSkills = null;
        CommandLemmingsAction._lemmingCache = null;
    }
}
Lemmings.CommandLemmingsAction = CommandLemmingsAction;
export { CommandLemmingsAction };
