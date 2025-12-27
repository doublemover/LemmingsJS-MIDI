import { EditorLevel } from './EditorLevel.js';
import { NxlvParser } from './NxlvParser.js';
import { NxlvWriter } from './NxlvWriter.js';
import { getDefaultStyle } from './StyleRegistry.js';
import { DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
const DEFAULT_SKILLS = [
  'CLIMBER',
  'FLOATER',
  'BOMBER',
  'BLOCKER',
  'BUILDER',
  'BASHER',
  'MINER',
  'DIGGER'
];

class EditorSession {
  constructor(options = {}) {
    this.parser = options.parser || new NxlvParser();
    this.writer = options.writer || new NxlvWriter();
    this.level = options.level || null;
  }

  ensureLevel() {
    if (!this.level) {
      this.level = new EditorLevel();
    }
    return this.level;
  }

  createBlank(options = {}) {
    const level = new EditorLevel();
    const styleName = options.styleName
      || getDefaultStyle()?.name
      || 'dirt';
    const width = Number.isFinite(options.width) ? options.width : DEFAULT_LEVEL_WIDTH;
    const height = Number.isFinite(options.height) ? options.height : DEFAULT_LEVEL_HEIGHT;

    level.setHeader('TITLE', options.title || 'Untitled');
    level.setHeader('STYLE', styleName);
    level.setHeader('LEMMINGS', Number.isFinite(options.lemmings) ? options.lemmings : 10);
    level.setHeader('SAVE_REQUIREMENT', Number.isFinite(options.saveRequirement) ? options.saveRequirement : 10);
    level.setHeader('TIME_LIMIT', options.timeLimit ?? 'INFINITE');
    level.setHeader('MAX_SPAWN_INTERVAL', Number.isFinite(options.maxSpawnInterval) ? options.maxSpawnInterval : 50);
    level.setHeader('SPAWN_INTERVAL_LOCKED', !!options.spawnIntervalLocked);
    level.setHeader('WIDTH', width);
    level.setHeader('HEIGHT', height);
    level.setHeader('START_X', Number.isFinite(options.startX) ? options.startX : 0);
    level.setHeader('START_Y', Number.isFinite(options.startY) ? options.startY : 0);

    for (const skill of DEFAULT_SKILLS) {
      level.setSkill(skill, 0);
    }

    this.level = level;
    return level;
  }

  loadFromText(text) {
    this.level = this.parser.parse(text);
    return this.level;
  }

  toText() {
    return this.writer.write(this.level || new EditorLevel());
  }

  getTitle() {
    if (!this.level) return 'Untitled';
    return this.level.getHeader('TITLE', 'Untitled');
  }

  setTitle(title) {
    const level = this.ensureLevel();
    level.setHeader('TITLE', title || 'Untitled');
    return level;
  }
}

export { EditorSession };
