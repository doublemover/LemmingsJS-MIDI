import { Frame } from '../render/Frame.js';
import { SpriteTypes } from './SpriteTypes.js';
import { deathBody, deathFrame } from './CharacterPresentation.js';
import { CHARACTER_HAZARD_KINDS } from './CharacterHazardTypes.js';

const DEATH_STATES = new Set([SpriteTypes.DROWNING, SpriteTypes.FRYING, SpriteTypes.SPLATTING]);
const DEATH_ACTIONS = new Set(['drowning', 'frying', 'splatter']);
const EFFECT_COLORS = Object.freeze({
  fire: { 1: 0xff292127, 9: 0xff2864ff, A: 0xffa8e8ff },
  lava: { 1: 0xff292127, 9: 0xff2864ff, A: 0xffa8e8ff },
  acid: { 9: 0xff38ca98, A: 0xff91ffe4 },
  electric: { 9: 0xffffecae, A: 0xffffffff },
  ice: { 9: 0xffeed581, A: 0xfffffcea }
});

class CharacterHazardPresentation {
  constructor() {
    this.pending = new WeakMap();
    this.actors = new WeakMap();
    this.geometry = new WeakMap();
    this.animations = new WeakMap();
  }

  record(lem, kind) {
    if (!lem || !CHARACTER_HAZARD_KINDS.includes(kind)) return;
    const pool = lem.action?.characterParticles;
    this.pending.set(lem, { kind, id: lem.id, index: lem.appearanceIndex, previous: lem.action,
      pool, epoch: pool?.epoch });
  }

  reset(lem, clearPending = false) {
    this.actors.delete(lem);
    if (clearPending) this.pending.delete(lem);
  }

  change(lem, previous) {
    const contact = this.pending.get(lem);
    this.pending.delete(lem);
    this.actors.delete(lem);
    if (!contact || contact.previous !== previous || contact.id !== lem.id || contact.index !== lem.appearanceIndex ||
        !DEATH_ACTIONS.has(lem.action?.getActionName?.()) || contact.epoch !== contact.pool?.epoch) return;
    this.actors.set(lem, { ...contact, action: lem.action, lastFrame: 0 });
  }

  kind(lem) {
    const cause = this.actors.get(lem);
    if (!cause) return null;
    if (cause.action !== lem.action || cause.id !== lem.id || cause.index !== lem.appearanceIndex ||
        cause.epoch !== cause.pool?.epoch || lem.frameIndex < cause.lastFrame || lem.removed) {
      this.actors.delete(lem);
      return null;
    }
    cause.lastFrame = lem.frameIndex;
    return cause.kind;
  }

  animation(skin, template, source, manifest, state, right, kind) {
    if (!DEATH_STATES.has(state) || !source || !manifest) return skin.getAnimation(state, right);
    const geometryKey = `${state}:${kind}`, key = `${geometryKey}:${right ? 1 : -1}`;
    let appearances = this.animations.get(skin);
    if (!appearances) { appearances = new Map(); this.animations.set(skin, appearances); }
    if (appearances.has(key)) return appearances.get(key);
    let geometries = this.geometry.get(template);
    if (!geometries) { geometries = new Map(); this.geometry.set(template, geometries); }
    let geometry = geometries.get(geometryKey);
    if (!geometry) {
      const record = manifest.animations.find(entry => SpriteTypes[entry.state] === state);
      const neutral = source.animations.find(entry => entry.state === 'WALKING' && entry.direction === 1);
      const body = deathBody(neutral, record, manifest.presentation.scale, manifest.shapeId);
      geometry = { record, body, rows: new Array(record.frameCount) };
      geometries.set(geometryKey, geometry);
    }
    const { record, body, rows } = geometry, frames = new Array(record.frameCount);
    const original = skin.getAnimation(state, right);
    const animation = {
      frameCount: record.frameCount,
      getFrame(tick) {
        const index = ((tick % record.frameCount) + record.frameCount) % record.frameCount;
        if (!index) return original.getFrame(0);
        if (frames[index]) return frames[index];
        const pixels = rows[index] ||= deathFrame(body, record, index, kind);
        const frame = new Frame(record.width, record.height, record.offsetX, record.offsetY);
        const palette = skin.colorPalette.data, effects = EFFECT_COLORS[kind] || {};
        pixels.forEach((row, y) => [...row].forEach((symbol, x) => {
          if (symbol === '0') return;
          const offset = y * record.width + x;
          frame.mask[offset] = 1;
          frame.data[offset] = effects[symbol] ?? palette[parseInt(symbol, 16)];
        }));
        frame.enableSpanCache();
        return frames[index] = frame;
      },
      get frames() { return Array.from({ length: record.frameCount }, (_, index) => this.getFrame(index)); }
    };
    appearances.set(key, animation);
    return animation;
  }
}

export { CharacterHazardPresentation };
