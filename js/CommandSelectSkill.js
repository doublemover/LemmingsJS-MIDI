import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

class CommandSelectSkill extends Lemmings.BaseLogger {
  constructor(skill = Lemmings.SkillTypes.UNKNOWN, apply = true) {
    super();
    this.skill = skill;
    this.apply = apply;
  }

  execute(game) {
    const gameSkills = game.getGameSkills();
    if (!gameSkills) return false;
    const lemmingManager = game.getLemmingManager?.();
    const changed = gameSkills.setSelectedSkill(this.skill);
    if (this.apply) {
      const lem = lemmingManager?.getSelectedLemming?.();
      if (lem && gameSkills.canReuseSkill(this.skill) &&
          lemmingManager.doLemmingAction?.(lem, this.skill)) {
        gameSkills.reuseSkill(this.skill);
      }
    }
    return changed;
  }

  load(values) {
    this.skill = +(values[0]);
    this.apply = values.length > 1 ? !!(+values[1]) : true;
  }

  save() {
    const out = [+(this.skill)];
    if (!this.apply) out.push(0);
    return out;
  }

  getCommandKey() {
    return 's';
  }
}

Lemmings.CommandSelectSkill = CommandSelectSkill;
export { CommandSelectSkill };
