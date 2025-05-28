import { Lemmings } from './LemmingsNamespace.js';

class CommandLemmingsAction {
    static lemmingManager = null;
    static gameSkills = null;
    static _lemmingCache = new Map();

    static setManagers(lemmingManager, gameSkills) {
        CommandLemmingsAction.lemmingManager = lemmingManager;
        CommandLemmingsAction.gameSkills = gameSkills;

        const lemmings = CommandLemmingsAction.lemmingManager.getLemmings();
        const cacheSize = CommandLemmingsAction._lemmingCache.size;

        // new level, clear the cache
        if (lemmings?.length == 1 && lemmings[0].action?.getActionName() == "falling") {
            CommandLemmingsAction._lemmingCache = new Map();
        }

        if (lemmings?.length != cacheSize) {
            for (const lem of lemmings) {
                if (!CommandLemmingsAction._lemmingCache.has(lem.id)) {
                    CommandLemmingsAction._lemmingCache.set(lem.id, lem);
                }
            }
        }
    }

    constructor(lemmingId) {
        this.log = new Lemmings.LogHandler("CommandLemmingsAction");
        if (lemmingId != null)
            this.lemmingId = lemmingId;
    }
    getCommandKey() {
        return "l";
    }
    load(values) {
        if (values.length < 1) {
            this.log.log("Unable to process load");
            return;
        }
        this.lemmingId = values[0];
    }
    save() {
        return [this.lemmingId];
    }
    #getLemming(lemmingID){
        const cachedLem = CommandLemmingsAction._lemmingCache.get(this.lemmingId);
        if (!cachedLem) {
            const lem = CommandLemmingsAction.lemmingManager.getLemming(this.lemmingId);
            if (!lem) {
                this.log.log("Lemming not found! " + this.lemmingId);
                return false;
            }
            CommandLemmingsAction._lemmingCache.set(this.lemmingId, lem)
            return lem;
        } else {
            return cachedLem;
        }
        console.log("error in getlemming")
    }
    execute() {
        const cachedLem = CommandLemmingsAction._lemmingCache.get(this.lemmingId);
        const selectedSkill = CommandLemmingsAction.gameSkills.getSelectedSkill();
        if (!CommandLemmingsAction.gameSkills.canReuseSkill(selectedSkill)) {
            this.log.log("Not enough skills!");
            return false;
        }
        if (!CommandLemmingsAction.lemmingManager.doLemmingAction(cachedLem, selectedSkill)) {
            this.log.log("unable to execute action on lemming!");
            return false;
        }
        return CommandLemmingsAction.gameSkills.reuseSkill(selectedSkill);
    }
}
Lemmings.CommandLemmingsAction = CommandLemmingsAction;
export { CommandLemmingsAction };
