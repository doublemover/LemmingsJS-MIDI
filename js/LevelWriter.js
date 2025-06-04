import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

class LevelWriter extends Lemmings.BaseLogger {
    /**
     * Serialize a level in the same format that LevelReader expects.
     * @param {Object} level Object containing properties like LevelReader
     * @returns {Uint8Array}
     */
    write(level) {
        const out = new Uint8Array(2048);
        const dv = new DataView(out.buffer);

        const props = level.levelProperties || {};
        const skills = props.skills || [];
        let pos = 0;
        dv.setUint16(pos, props.releaseRate || 0); pos += 2;
        dv.setUint16(pos, props.releaseCount || 0); pos += 2;
        dv.setUint16(pos, props.needCount || 0); pos += 2;
        dv.setUint16(pos, props.timeLimit || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.CLIMBER] || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.FLOATER] || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.BOMBER] || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.BLOCKER] || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.BUILDER] || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.BASHER] || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.MINER] || 0); pos += 2;
        dv.setUint16(pos, skills[Lemmings.SkillTypes.DIGGER] || 0); pos += 2;
        dv.setUint16(pos, level.screenPositionX || 0); pos += 2;
        dv.setUint16(pos, level.graphicSet1 || 0); pos += 2;
        dv.setUint16(pos, level.graphicSet2 || 0); pos += 2;
        dv.setUint16(pos, level.isSuperLemming ? 1 : 0); pos += 2;

        // Objects
        pos = 0x0020;
        const objects = level.objects || [];
        for (let i = 0; i < 32; i++) {
            const ob = objects[i];
            if (ob) {
                dv.setUint16(pos, (ob.x + 16) & 0xFFFF); pos += 2;
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
                dv.setUint32(pos, 0); pos += 4;
            }
        }

        // Terrain
        pos = 0x0120;
        const terrain = level.terrains || [];
        for (let i = 0; i < 400; i++) {
            const t = terrain[i];
            if (t) {
                let flags = 0;
                if (t.drawProperties) {
                    if (t.drawProperties.isErase) flags |= 1;
                    if (t.drawProperties.isUpsideDown) flags |= 2;
                    if (t.drawProperties.noOverwrite) flags |= 4;
                }
                const x = (t.x + 16) & 0x0FFF;
                const y = (t.y + 4 + 512) & 0x1FF;
                const v = (flags << 29) | (x << 16) | (y << 7) | (t.id & 0x3F);
                dv.setUint32(pos, v); pos += 4;
            } else {
                dv.setInt32(pos, -1); pos += 4;
            }
        }

        // Steel
        pos = 0x0760;
        const steels = level.steel || [];
        const X_OFFSET = 16;
        for (let i = 0; i < 32; i++) {
            const r = steels[i];
            if (r) {
                const xStep = ((r.x + X_OFFSET) >> 3) & 0x1FF;
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
        pos = 0x07E0;
        const name = props.levelName || '';
        for (let i = 0; i < 32; i++) {
            out[pos + i] = i < name.length ? name.charCodeAt(i) & 0xFF : 0;
        }

        return out;
    }
}

Lemmings.LevelWriter = LevelWriter;
export { LevelWriter };
