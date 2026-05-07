import { BaseLogger } from '../util/LogHandler.js';
import { DrawProperties } from '../render/DrawProperties.js';
import { LevelElement } from './LevelElement.js';
import { LevelProperties } from './LevelProperties.js';
import { Range } from '../util/Range.js';
import { SkillTypes } from '../game/SkillTypes.js';
import {
  DEFAULT_LEVEL_WIDTH,
  DEFAULT_LEVEL_HEIGHT,
  LEVEL_OBJECT_COUNT,
  LEVEL_TERRAIN_COUNT,
  LEVEL_STEEL_COUNT,
  LEVEL_OBJECT_OFFSET,
  LEVEL_TERRAIN_OFFSET,
  LEVEL_STEEL_OFFSET,
  LEVEL_NAME_OFFSET,
  LEVEL_NAME_LENGTH,
  OBJECT_X_OFFSET,
  TERRAIN_X_OFFSET,
  TERRAIN_X_MASK,
  TERRAIN_Y_OFFSET,
  TERRAIN_Y_WRAP,
  TERRAIN_Y_MASK,
  TERRAIN_Y_WRAP_THRESHOLD,
  TERRAIN_ID_MASK,
  TERRAIN_FLAG_SHIFT,
  STEEL_X_OFFSET,
  STEEL_X_OFFSET_LEMEDIT
} from './ClassicLevelConstants.js';

class LevelReader extends BaseLogger {
  /// Load a Level
  constructor(fr) {
    super();
    this.levelWidth = DEFAULT_LEVEL_WIDTH;
    this.levelHeight = DEFAULT_LEVEL_HEIGHT;
    this.levelProperties = new LevelProperties();
    this.screenPositionX = 0;
    /** index of GROUNDxO.DAT file */
    this.graphicSet1 = 0;
    /** index of VGASPECx.DAT */
    this.graphicSet2 = 0;
    this.isSuperLemming = false;
    this.objects = [];
    this.terrains = [];
    this.steel = [];
    this.readLevelInfo(fr);
    this.readLevelObjects(fr);
    this.readLevelTerrain(fr);
    this.readSteelArea(fr);
    this.readLevelName(fr);
    this.log.debug(this);
  }
  /** read general Level information */
  readLevelInfo(fr) {
    fr.setOffset(0);
    this.levelProperties.releaseRate = fr.readWord();
    this.levelProperties.releaseCount = fr.readWord();
    this.levelProperties.needCount = fr.readWord();
    this.levelProperties.timeLimit = fr.readWord();
    //- read amount of skills
    this.levelProperties.skills.fill(0);
    this.levelProperties.skills[SkillTypes.CLIMBER] = fr.readWord();
    this.levelProperties.skills[SkillTypes.FLOATER] = fr.readWord();
    this.levelProperties.skills[SkillTypes.BOMBER] = fr.readWord();
    this.levelProperties.skills[SkillTypes.BLOCKER] = fr.readWord();
    this.levelProperties.skills[SkillTypes.BUILDER] = fr.readWord();
    this.levelProperties.skills[SkillTypes.BASHER] = fr.readWord();
    this.levelProperties.skills[SkillTypes.MINER] = fr.readWord();
    this.levelProperties.skills[SkillTypes.DIGGER] = fr.readWord();
    this.screenPositionX = fr.readWord();
    this.graphicSet1 = fr.readWord();
    this.graphicSet2 = fr.readWord();
    this.isSuperLemming = (fr.readWord() != 0);
  }
  /** read the level objects */
  readLevelObjects(fr) {
    /// reset array
    this.objects = [];
    fr.setOffset(LEVEL_OBJECT_OFFSET);
    for (let i = 0; i < LEVEL_OBJECT_COUNT; i++) {
      const newOb = new LevelElement();
      const rawX = fr.readWord();
      const rawY = fr.readWord();
      const rawId = fr.readWord();
      const flags = fr.readWord();
      if (rawX === 0 && rawY === 0 && rawId === 0 && flags === 0)
        continue;
      newOb.x = rawX - OBJECT_X_OFFSET;
      newOb.y = rawY;
      newOb.id = rawId;
      const isUpsideDown = ((flags & 0x0080) > 0);
      const noOverwrite = ((flags & 0x8000) > 0);
      const onlyOverwrite = ((flags & 0x4000) > 0);
      newOb.drawProperties = new DrawProperties(isUpsideDown, noOverwrite, onlyOverwrite, false);
      this.objects.push(newOb);
    }
  }
  readLevelTerrain(fr) {
    /// reset array
    this.terrains = [];
    fr.setOffset(LEVEL_TERRAIN_OFFSET);
    for (let i = 0; i < LEVEL_TERRAIN_COUNT; i++) {
      const newOb = new LevelElement();
      const v = fr.readInt(4);
      if (v == -1)
        continue;
      newOb.x = ((v >> 16) & TERRAIN_X_MASK) - TERRAIN_X_OFFSET;
      const y = ((v >> 7) & TERRAIN_Y_MASK);
      newOb.y = y - ((y > TERRAIN_Y_WRAP_THRESHOLD) ? (TERRAIN_Y_OFFSET + TERRAIN_Y_WRAP) : TERRAIN_Y_OFFSET);
      newOb.id = (v & TERRAIN_ID_MASK);
      const flags = ((v >> TERRAIN_FLAG_SHIFT) & 0x000F);
      const isUpsideDown = ((flags & 2) > 0);
      const noOverwrite = ((flags & 4) > 0);
      const isErase = ((flags & 1) > 0);
      newOb.drawProperties = new DrawProperties(isUpsideDown, noOverwrite, false, isErase);
      this.terrains.push(newOb);
    }
  }

  /** read Level Steel areas */
  readSteelArea(fr, isLemEdit = false) {
    const X_OFFSET = isLemEdit ? STEEL_X_OFFSET_LEMEDIT : STEEL_X_OFFSET;   // originals use −16, LemEdit uses −12
    /// reset array
    this.steel = [];
    fr.setOffset(LEVEL_STEEL_OFFSET);
    for (let i = 0; i < LEVEL_STEEL_COUNT; i++) {
      const low = fr.readByte();
      const high = fr.readByte();
      const size = fr.readByte();
      const flag = fr.readByte();
      const pos = (high << 8) | low;

      if (pos === 0 && size === 0) break; // end-of-list marker

      // 9-bit X in 8-px steps, origin - X_OFFSET
      const x = ((pos & 0x00FF) << 3) - X_OFFSET;
      // 7-bit Y in 8-px steps, origin 0
      let y = (((pos >> 9) & 0x7F) << 3);
      // idk if this is needed
      y = y % 256;
      // each nibble is “blocks − 1”, one block = 4 px
      const width = (((size >> 4) & 0x0F) + 1) * 4; 
      const height = ((size & 0x0F) + 1) * 4;

      const newRange = new Range();
      newRange.x = x;
      newRange.y = y;
      newRange.width = width;
      newRange.height = height;

      this.steel.push(newRange);
    }
  }
  /** read general Level information */
  readLevelName(fr) {
    /// at the end of the 
    this.levelProperties.levelName = fr.readString(LEVEL_NAME_LENGTH, LEVEL_NAME_OFFSET);
    this.log.debug('Level Name: ' + this.levelProperties.levelName);
  }
}

export { LevelReader };
