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
    return gameSkills.setSelectedSkill(this.skill);
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
