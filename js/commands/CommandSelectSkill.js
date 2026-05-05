import { BaseLogger } from '../util/LogHandler.js';
import { SoundEventTypes, SoundEffectIds } from '../game/SoundEvents.js';
import { SkillTypes } from '../game/SkillTypes.js';

class CommandSelectSkill extends BaseLogger {
  constructor(skill = SkillTypes.UNKNOWN, apply = true) {
    super();
    this.skill = skill;
    this.apply = apply;
  }

  execute(game) {
    const gameSkills = game.getGameSkills();
    if (!gameSkills) return false;
    const lemmingManager = game.getLemmingManager?.();
    const changed = gameSkills.setSelectedSkill(this.skill);
    if (changed) {
      const soundBus = game.soundEvents ?? game.runtime?.soundEvents ?? null;
      soundBus?.emitSfx?.(
        SoundEventTypes.SKILL_SELECT,
        SoundEffectIds.SKILL_SELECT,
        { skillType: this.skill }
      );
    }
    if (this.apply) {
      const lem = lemmingManager?.getSelectedLemming?.();
      if (lem && gameSkills.canReuseSkill(this.skill) &&
          lemmingManager.doLemmingAction?.(lem, this.skill)) {
        if (gameSkills.reuseSkill(this.skill)) {
          const soundBus = game.soundEvents ?? game.runtime?.soundEvents ?? null;
          soundBus?.emitSfx?.(
            SoundEventTypes.SKILL_ASSIGN,
            SoundEffectIds.SKILL_ASSIGN,
            {
              skillType: this.skill,
              lemmingId: lem.id,
              x: lem.x,
              y: lem.y
            }
          );
        }
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
export { CommandSelectSkill };
