import { EventHandler } from '../util/EventHandler.js';
import { SkillTypes } from './SkillTypes.js';

const MIN_SKILL_TYPE = SkillTypes.UNKNOWN;
const MAX_SKILL_TYPE = SkillTypes.DIGGER;

const isValidSkillType = (type) => (
  Number.isInteger(type) && type >= MIN_SKILL_TYPE && type <= MAX_SKILL_TYPE
);

class GameSkills {
  constructor(level) {
    this.selectedSkill = SkillTypes.CLIMBER;
    this.onCountChanged = new EventHandler();
    this.onSelectionChanged = new EventHandler();
    this.skills = level.skills;
    this.cheatMode = false;
    // automatically select a valid skill when a level loads
    this.selectFirstAvailable();
  }

  selectFirstAvailable() {
    for (let i = SkillTypes.CLIMBER; i <= SkillTypes.DIGGER; i++) {
      if (this.skills[i] > 0) {
        this.selectedSkill = i;
        break;
      }
    }
  }
  /** return true if the skill can be reused / used */
  canReuseSkill(type) {
    if (this.cheatMode) return true;
    return (this.skills[type] > 0);
  }
  reuseSkill(type) {
    if (this.cheatMode) return true;
    if (this.skills[type] <= 0)
      return false;
    this.skills[type]--;
    this.onCountChanged.trigger(type);
    if (this.skills[type] <= 0 && this.selectedSkill === type) {
      this.selectFirstAvailable();
    }
    return true;
  }
  getSkill(type) {
    if (!isValidSkillType(type))
      return 0;
    const val = this.skills[type];
    if (val === Infinity) return 99;
    return val;
  }
  getSelectedSkill() {
    return this.selectedSkill;
  }
  setSelectedSkill(skill) {
    if (this.selectedSkill === skill) {
      return false;
    }
    if (!isValidSkillType(skill)) {
      return false;
    }
    this.selectedSkill = skill;
    this.onSelectionChanged.trigger();
    return true;
  }
  /** increase the amount of actions for all skills */
  cheat() {
    this.cheatMode = true;
    for (let i = 0; i < this.skills.length; i++) {
      this.skills[i] = Infinity;
      this.onCountChanged.trigger(i);
    }
  }

  clearSelectedSkill() {
    if (this.selectedSkill !== SkillTypes.UNKNOWN) {
      this.selectedSkill = SkillTypes.UNKNOWN;
      this.onSelectionChanged.trigger();
      return true;
    }
    return false;
  }
}
export { GameSkills };
