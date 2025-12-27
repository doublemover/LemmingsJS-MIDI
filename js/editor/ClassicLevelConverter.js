import { EditorLevel } from './EditorLevel.js';
import { getDefaultStyle, getStyleByGroundSet } from './StyleRegistry.js';
import { createSteelEntry } from './EditorEntryFactory.js';
import { SkillTypes } from '../game/SkillTypes.js';
import { DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT } from '../level/ClassicLevelConstants.js';
const DEFAULT_SKILL_NAMES = [
  { name: 'CLIMBER', id: SkillTypes.CLIMBER },
  { name: 'FLOATER', id: SkillTypes.FLOATER },
  { name: 'BOMBER', id: SkillTypes.BOMBER },
  { name: 'BLOCKER', id: SkillTypes.BLOCKER },
  { name: 'BUILDER', id: SkillTypes.BUILDER },
  { name: 'BASHER', id: SkillTypes.BASHER },
  { name: 'MINER', id: SkillTypes.MINER },
  { name: 'DIGGER', id: SkillTypes.DIGGER }
];

const coerceNumber = (value, fallback = 0) => {
  return Number.isFinite(value) ? value : fallback;
};

const resolveStyleName = (levelReader, styleName) => {
  if (styleName) return styleName;
  const groundSet = levelReader?.graphicSet1;
  const style = getStyleByGroundSet(groundSet);
  if (style?.name) return style.name;
  return getDefaultStyle()?.name || 'dirt';
};

const applyDrawProperties = (drawProperties, props) => {
  if (!drawProperties) return;
  if (drawProperties.isUpsideDown) props.FLIP_VERTICAL = true;
  if (drawProperties.noOverwrite) props.NO_OVERWRITE = true;
  if (drawProperties.isErase) props.ERASE = true;
};

const createEntry = (props) => {
  return { props, order: Object.keys(props), unknownLines: [] };
};

const buildTerrainEntries = (terrains, styleName) => {
  if (!Array.isArray(terrains)) return [];
  return terrains.map(entry => {
    const props = {
      STYLE: styleName,
      PIECE: coerceNumber(entry?.id, 0),
      X: coerceNumber(entry?.x, 0),
      Y: coerceNumber(entry?.y, 0)
    };
    applyDrawProperties(entry?.drawProperties, props);
    return createEntry(props);
  });
};

const buildGadgetEntries = (objects, styleName) => {
  if (!Array.isArray(objects)) return [];
  return objects.map(entry => {
    const props = {
      STYLE: styleName,
      PIECE: coerceNumber(entry?.id, 0),
      X: coerceNumber(entry?.x, 0),
      Y: coerceNumber(entry?.y, 0)
    };
    applyDrawProperties(entry?.drawProperties, props);
    return createEntry(props);
  });
};

const buildSteelEntries = (steelAreas) => {
  if (!Array.isArray(steelAreas)) return [];
  return steelAreas.map(area => createSteelEntry({
    x: coerceNumber(area?.x, 0),
    y: coerceNumber(area?.y, 0),
    width: coerceNumber(area?.width, 0),
    height: coerceNumber(area?.height, 0)
  }));
};

const resolveTimeLimit = (levelProperties) => {
  const timeLimit = levelProperties?.timeLimit;
  if (Number.isFinite(timeLimit) && timeLimit > 0) return timeLimit;
  return 'INFINITE';
};

const createEditorLevelFromClassic = (levelReader, options = {}) => {
  if (!levelReader) return null;
  const level = new EditorLevel();
  const styleName = resolveStyleName(levelReader, options.styleName);
  const levelProps = levelReader.levelProperties || {};

  level.setHeader('TITLE', levelProps.levelName || 'Untitled');
  level.setHeader('STYLE', styleName);
  level.setHeader('LEMMINGS', coerceNumber(levelProps.releaseCount, 0));
  level.setHeader('SAVE_REQUIREMENT', coerceNumber(levelProps.needCount, 0));
  level.setHeader('TIME_LIMIT', resolveTimeLimit(levelProps));
  level.setHeader('MAX_SPAWN_INTERVAL', coerceNumber(levelProps.releaseRate, 0));
  level.setHeader('WIDTH', coerceNumber(levelReader.levelWidth, DEFAULT_LEVEL_WIDTH));
  level.setHeader('HEIGHT', coerceNumber(levelReader.levelHeight, DEFAULT_LEVEL_HEIGHT));
  level.setHeader('START_X', coerceNumber(levelReader.screenPositionX, 0));
  level.setHeader('START_Y', 0);

  const skills = Array.isArray(levelProps.skills) ? levelProps.skills : [];
  for (const skill of DEFAULT_SKILL_NAMES) {
    const count = coerceNumber(skills[skill.id], 0);
    level.setSkill(skill.name, count);
  }

  level.terrains = buildTerrainEntries(levelReader.terrains, styleName);
  level.gadgets = buildGadgetEntries(levelReader.objects, styleName);
  level.steel = buildSteelEntries(levelReader.steel);

  return level;
};

export { createEditorLevelFromClassic };
