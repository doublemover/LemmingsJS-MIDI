import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

class CommandSelectSkill extends Lemmings.BaseLogger {
  constructor(skill) {
    super();
    if (!skill) {
      this.log.log('error, skill is null');
      return;
    }
    this.skill = skill;
  }

  execute(game) {
    const gameSkills = game.getGameSkills();
    if (!gameSkills) return false;
    const lemmingManager = game.getLemmingManager?.();
    const changed = gameSkills.setSelectedSkill(this.skill);
    const lem = lemmingManager?.getSelectedLemming?.();
    if (lem && gameSkills.canReuseSkill(this.skill) &&
        lemmingManager.doLemmingAction?.(lem, this.skill)) {
      gameSkills.reuseSkill(this.skill);
    }
    return changed;
  }

  load(values) {
    this.skillType = values[0];
  }

  save() {
    return [+(this.skill)];
  }

  getCommandKey() {
    return 's';
  }
}

Lemmings.CommandSelectSkill = CommandSelectSkill;
export { CommandSelectSkill };
