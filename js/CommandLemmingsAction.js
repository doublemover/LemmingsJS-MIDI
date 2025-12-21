import { SoundEventTypes, SoundEffectIds, getSoundBus } from './SoundEvents.js';

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
    const ok = gameSkills.reuseSkill(selectedSkill);
    if (ok) {
      const soundBus = getSoundBus();
      soundBus?.emitSfx?.(
        SoundEventTypes.SKILL_ASSIGN,
        SoundEffectIds.SKILL_ASSIGN,
        {
          skillType: selectedSkill,
          lemmingId: lem.id,
          x: lem.x,
          y: lem.y
        }
      );
    }
    return ok;
  }

  load(values) {
    this.lemmingId = values[0];
  }

  save() {
    return [this.lemmingId, this.skillType];
  }

  getCommandKey() {
    return 'l';
  }
}
export { CommandLemmingsAction };
