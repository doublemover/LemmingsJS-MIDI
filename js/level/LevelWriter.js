import { BaseLogger } from '../util/LogHandler.js';
import { SkillTypes } from '../game/SkillTypes.js';
import {
  LEVEL_FILE_SIZE,
  LEVEL_OBJECT_COUNT,
  LEVEL_TERRAIN_COUNT,
  LEVEL_STEEL_COUNT,
  LEVEL_NAME_LENGTH,
  LEVEL_OBJECT_OFFSET,
  LEVEL_TERRAIN_OFFSET,
  LEVEL_STEEL_OFFSET,
  LEVEL_NAME_OFFSET,
  OBJECT_X_OFFSET,
  TERRAIN_X_OFFSET,
  TERRAIN_X_MASK,
  TERRAIN_Y_OFFSET,
  TERRAIN_Y_WRAP,
  TERRAIN_Y_MASK,
  TERRAIN_ID_MASK,
  TERRAIN_FLAG_SHIFT,
  STEEL_X_OFFSET
} from './ClassicLevelConstants.js';

class LevelWriter extends BaseLogger {
  /**
     * Serialize a level in the same format that LevelReader expects.
     * @param {Object} level Object containing properties like LevelReader
     * @returns {Uint8Array}
     */
  write(level) {
    const out = new Uint8Array(LEVEL_FILE_SIZE);
    const dv = new DataView(out.buffer);

    const props = level.levelProperties || {};
    const skills = props.skills || [];
    let pos = 0;
    dv.setUint16(pos, props.releaseRate || 0); pos += 2;
    dv.setUint16(pos, props.releaseCount || 0); pos += 2;
    dv.setUint16(pos, props.needCount || 0); pos += 2;
    dv.setUint16(pos, props.timeLimit || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.CLIMBER] || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.FLOATER] || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.BOMBER] || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.BLOCKER] || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.BUILDER] || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.BASHER] || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.MINER] || 0); pos += 2;
    dv.setUint16(pos, skills[SkillTypes.DIGGER] || 0); pos += 2;
    dv.setUint16(pos, level.screenPositionX || 0); pos += 2;
    dv.setUint16(pos, level.graphicSet1 || 0); pos += 2;
    dv.setUint16(pos, level.graphicSet2 || 0); pos += 2;
    dv.setUint16(pos, level.isSuperLemming ? 1 : 0); pos += 2;

    // Objects
    pos = LEVEL_OBJECT_OFFSET;
    const objects = level.objects || [];
    for (let i = 0; i < LEVEL_OBJECT_COUNT; i++) {
      const ob = objects[i];
      if (ob) {
        dv.setUint16(pos, (ob.x + OBJECT_X_OFFSET) & 0xFFFF); pos += 2;
        dv.setUint16(pos, ob.y & 0xFFFF); pos += 2;
        dv.setUint16(pos, ob.id & 0xFFFF); pos += 2;
        let flags = 0;
        if (ob.drawProperties) {
          if (ob.drawProperties.noOverwrite) flags |= 0x8000;
          if (ob.drawProperties.onlyOverwrite) flags |= 0x4000;
          if (ob.drawProperties.isUpsideDown) flags |= 0x0080;
        }
        dv.setUint16(pos, flags); pos += 2;
      } else {
        dv.setUint16(pos, 0); pos += 2;
        dv.setUint16(pos, 0); pos += 2;
        dv.setUint16(pos, 0); pos += 2;
        dv.setUint16(pos, 0); pos += 2;
      }
    }

    // Terrain
    pos = LEVEL_TERRAIN_OFFSET;
    const terrain = level.terrains || [];
    for (let i = 0; i < LEVEL_TERRAIN_COUNT; i++) {
      const t = terrain[i];
      if (t) {
        let flags = 0;
        if (t.drawProperties) {
          if (t.drawProperties.isErase) flags |= 1;
          if (t.drawProperties.isUpsideDown) flags |= 2;
          if (t.drawProperties.noOverwrite) flags |= 4;
        }
        const x = (t.x + TERRAIN_X_OFFSET) & TERRAIN_X_MASK;
        const y = (t.y + TERRAIN_Y_OFFSET + TERRAIN_Y_WRAP) & TERRAIN_Y_MASK;
        const v = (flags << TERRAIN_FLAG_SHIFT) | (x << 16) | (y << 7) | (t.id & TERRAIN_ID_MASK);
        dv.setUint32(pos, v); pos += 4;
      } else {
        dv.setInt32(pos, -1); pos += 4;
      }
    }

    // Steel
    pos = LEVEL_STEEL_OFFSET;
    const steels = level.steel || [];
    for (let i = 0; i < LEVEL_STEEL_COUNT; i++) {
      const r = steels[i];
      if (r) {
        const xStep = ((r.x + STEEL_X_OFFSET) >> 3) & 0x1FF;
        const yStep = (r.y >> 3) & 0x7F;
        const posVal = (yStep << 9) | xStep;
        const size = (((r.width / 4) - 1) << 4) | ((r.height / 4) - 1);
        out[pos] = posVal & 0xFF; // low
        out[pos+1] = (posVal >> 8) & 0xFF; // high
        out[pos+2] = size & 0xFF;
        out[pos+3] = 0;
        pos += 4;
      } else {
        out[pos++] = 0;
        out[pos++] = 0;
        out[pos++] = 0;
        out[pos++] = 0;
      }
    }

    // Level name
    pos = LEVEL_NAME_OFFSET;
    const name = props.levelName || '';
    for (let i = 0; i < LEVEL_NAME_LENGTH; i++) {
      out[pos + i] = i < name.length ? name.charCodeAt(i) & 0xFF : 0;
    }

    return out;
  }
}

export { LevelWriter };
