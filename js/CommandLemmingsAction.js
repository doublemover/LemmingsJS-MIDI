import { Lemmings } from './LemmingsNamespace.js';

class CommandLemmingsAction {
    constructor(lemmingId) {
        this.lemmingId = lemmingId;
    }

    execute(game) {
        const lemmingManager = game.getLemmingManager();
        const gameSkills = game.getGameSkills();
        if (!lemmingManager || !gameSkills) return false;

        const lem = lemmingManager.getLemming(this.lemmingId);
        if (!lem) return false;

        const selectedSkill = gameSkills.getSelectedSkill();
        if (!gameSkills.canReuseSkill(selectedSkill)) {
            return false;
        }
        if (!lemmingManager.doLemmingAction(lem, selectedSkill)) {
            return false;
        }
        return gameSkills.reuseSkill(selectedSkill);
    }

    load(values) {
        this.lemmingId = values[0];
    }

    save() {
        return [this.lemmingId, this.skillType];
    }

    getCommandKey() {
        return "l";
    }
}

Lemmings.CommandLemmingsAction = CommandLemmingsAction;
export { CommandLemmingsAction };
