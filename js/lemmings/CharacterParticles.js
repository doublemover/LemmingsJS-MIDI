import { Frame } from '../render/Frame.js';

const PARTICLE_LIMITS = Object.freeze({ capacity: 384, spawnsPerTick: 72, samplesPerTick: 2048, pixelsPerRender: 8192, terrainPerEvent: 10, digPerEvent: 4, tunnelPerEvent: 6, fractureAge: 3 });
const hash = value => {
  let seed = 2166136261;
  for (const ch of String(value)) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  return (seed ^ (seed >>> 16)) >>> 0;
};
const noise = (seed, n) => {
  let value = Math.imul(seed ^ Math.imul(n + 1, 0x9e3779b9), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};
const color32 = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const occupied = (frame, index) => !!frame?.getMask?.()[index] && !!(frame.getBuffer()[index] >>> 24);

class CharacterParticles {
  constructor() {
    this.particles = Array.from({ length: PARTICLE_LIMITS.capacity }, (_, index) => ({
      index, life: 0, age: 0, source: null, x: 0, y: 0, vx: 0, vy: 0, gravity: 0,
      angle: 0, spin: 0, sx: 0, sy: 0, width: 1, height: 1, color: 0, kind: '', fracture: false,
      seed: 0, born: 0
    }));
    this.free = new Uint16Array(PARTICLE_LIMITS.capacity);
    this.samples = Array.from({ length: PARTICLE_LIMITS.terrainPerEvent }, () => ({ x: 0, y: 0, color: 0 }));
    this.sampleIndices = new Uint8Array(PARTICLE_LIMITS.terrainPerEvent);
    this.pixel = new Frame(1, 1);
    this.pixel.getMask()[0] = 1;
    this.clear();
  }

  clear() {
    for (let i = 0; i < this.particles.length; i++) {
      this.particles[i].life = 0;
      this.particles[i].source = null;
      this.free[i] = i;
    }
    this.freeCount = this.free.length;
    this.activeCount = 0;
    this.frame = 0;
    this.spawnBudget = PARTICLE_LIMITS.spawnsPerTick;
    this.sampleBudget = PARTICLE_LIMITS.samplesPerTick;
    this.sampleCount = 0;
    this.sampleLevel = null;
  }

  _spawn(seed, kind) {
    if (!this.freeCount || !this.spawnBudget) return null;
    this.spawnBudget--;
    const p = this.particles[this.free[--this.freeCount]];
    p.life = 18; p.age = 0; p.source = null; p.fracture = false;
    p.x = p.y = p.vx = p.vy = p.sx = p.sy = p.angle = 0;
    p.width = p.height = 1; p.gravity = 0.16; p.color = 0xffffffff;
    p.spin = (noise(seed, 1) - 0.5) * 0.42;
    p.seed = seed; p.kind = kind; p.born = this.frame;
    this.activeCount++;
    return p;
  }

  _release(p) {
    p.life = 0;
    p.source = null;
    this.free[this.freeCount++] = p.index;
    this.activeCount--;
  }

  tick() {
    this.frame++;
    this.spawnBudget = PARTICLE_LIMITS.spawnsPerTick;
    this.sampleBudget = PARTICLE_LIMITS.samplesPerTick;
    for (const p of this.particles) {
      if (!p.life || p.born === this.frame) continue;
      p.age++;
      p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.985; p.angle += p.spin;
      if (p.fracture && p.age === PARTICLE_LIMITS.fractureAge) {
        this._fracture(p);
        this._release(p);
      } else if (p.age >= p.life) this._release(p);
    }
  }

  _sample(level, x, y) {
    if (x < 0 || y < 0 || x >= level.width || y >= level.height || this.sampleCount >= this.samples.length) return;
    const index = y * level.width + x;
    const ground = level.groundMask?.mask;
    const rgba = level.groundImage;
    if (level.isSteelAt?.(x, y)) return;
    let color;
    if (ground && rgba) {
      if (!ground[index]) return;
      const offset = index * 4;
      color = color32(rgba[offset], rgba[offset + 1], rgba[offset + 2]);
    } else {
      color = level.groundPixelAt?.(x, y) >>> 0;
      if (!(color >>> 24)) return;
    }
    const sample = this.samples[this.sampleCount++];
    sample.x = x; sample.y = y; sample.color = color;
  }

  sampleRow(level, x, y, width) {
    this.sampleCount = 0; this.sampleLevel = level;
    if (!this.spawnBudget || !this.freeCount) return;
    for (let dx = 0; dx < width && this.sampleBudget > 0; dx++) {
      this.sampleBudget--;
      this._sample(level, x + dx, y);
    }
  }

  sampleMask(level, mask, x, y, lem) {
    this.sampleCount = 0; this.sampleLevel = level;
    if (!mask || !this.spawnBudget || !this.freeCount || !this.sampleBudget) return;
    const area = mask.width * mask.height;
    const count = Math.min(area, 128, this.sampleBudget);
    if (!count) return;
    const seed = hash(`${lem?.id}:${lem?.frameIndex}:terrain`);
    // A bounded sweep spreads samples across the entire removal mask, including large explosions.
    for (let i = 0; i < count && this.sampleCount < this.samples.length; i++) {
      this.sampleBudget--;
      const index = Math.min(area - 1, Math.floor((i + noise(seed, i)) * area / count));
      const dx = index % mask.width, dy = Math.floor(index / mask.width);
      if (!mask.at?.(dx, dy)) this._sample(level, x + mask.offsetX + dx, y + mask.offsetY + dy);
    }
  }

  emitTerrain(lem, kind) {
    const level = this.sampleLevel;
    const seed = hash(`${lem.id}:${lem.frameIndex}:${kind}:${lem.x}:${lem.y}`);
    const direction = lem.lookRight ? 1 : -1;
    const digging = kind === 'digging', exploding = kind === 'exploding';
    let removed = 0;
    for (let i = 0; i < this.sampleCount; i++) {
      const sample = this.samples[i];
      // Confirm this exact sampled pixel was removed; protected terrain never produces debris.
      const remains = level?.groundMask?.mask ? level.groundMask.mask[sample.y * level.width + sample.x]
        : level?.hasGroundAt?.(sample.x, sample.y);
      if (remains === false || remains === 0) this.sampleIndices[removed++] = i;
    }
    const count = Math.min(removed, digging ? PARTICLE_LIMITS.digPerEvent : exploding ? PARTICLE_LIMITS.terrainPerEvent : PARTICLE_LIMITS.tunnelPerEvent);
    for (let i = 0; i < count; i++) {
      const index = count === 1 ? 0 : Math.round(i * (removed - 1) / (count - 1));
      const sample = this.samples[this.sampleIndices[index]];
      const p = this._spawn(hash(`${seed}:${i}`), 'terrain');
      if (!p) break;
      p.x = sample.x; p.y = sample.y; p.color = sample.color;
      p.width = exploding ? (noise(seed, i + 10) > 0.45 ? 2 : 1) : (i % 3 === 0 ? 2 : 1);
      p.height = exploding && noise(seed, i + 20) > 0.7 ? 2 : 1;
      p.life = exploding ? 13 + Math.floor(noise(seed, i + 30) * 9) : 9 + Math.floor(noise(seed, i + 30) * 5);
      if (digging) {
        const side = i < count / 2 ? -1 : 1;
        p.x = lem.x + side * Math.max(4, Math.abs(sample.x - lem.x));
        p.vx = side * (1.65 + noise(seed, i) * 1.25);
      } else p.vx = exploding ? (sample.x - lem.x) * 0.2 + (noise(seed, i) - 0.5) * 2
        : direction * (1.1 + noise(seed, i) * 1.5);
      p.vy = -1.2 - noise(seed, i + 40) * (exploding ? 2.6 : 1.1);
    }
    this.sampleCount = 0; this.sampleLevel = null;
  }

  _bounds(frame) {
    if (!frame?.getBuffer || !frame.getMask || this.sampleBudget < frame.width * frame.height) return null;
    let minX = frame.width, minY = frame.height, maxX = -1, maxY = -1;
    for (let i = 0; i < frame.width * frame.height && this.sampleBudget > 0; i++) {
      this.sampleBudget--;
      if (!occupied(frame, i)) continue;
      const x = i % frame.width, y = Math.floor(i / frame.width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  _eject(frame, lem, seed, kind) {
    const bounds = this._bounds(frame);
    if (!bounds) return;
    const p = this._spawn(seed, kind);
    if (!p) return;
    p.source = frame; p.sx = bounds.x; p.sy = bounds.y; p.width = bounds.width; p.height = bounds.height;
    p.x = lem.x + frame.offsetX + bounds.x + (bounds.width - 1) / 2;
    p.y = lem.y + frame.offsetY + bounds.y + (bounds.height - 1) / 2;
    p.vx = (lem.lookRight ? 1 : -1) * (kind === 'eyewear' ? 1.25 : -0.8);
    p.vy = kind === 'eyewear' ? -2.8 : -3.4;
    p.fracture = true; p.life = PARTICLE_LIMITS.fractureAge + 1;
  }

  _fracture(parent) {
    const horizontal = parent.width >= parent.height;
    const extent = horizontal ? parent.width : parent.height;
    const count = Math.min(3, extent);
    const cos = Math.cos(parent.angle), sin = Math.sin(parent.angle);
    for (let i = 0; i < count; i++) {
      const start = Math.floor(i * extent / count), end = Math.floor((i + 1) * extent / count);
      const p = this._spawn(hash(`${parent.seed}:fracture:${i}`), `${parent.kind}-fragment`);
      if (!p) return;
      p.source = parent.source;
      p.sx = parent.sx + (horizontal ? start : 0); p.sy = parent.sy + (horizontal ? 0 : start);
      p.width = horizontal ? end - start : parent.width; p.height = horizontal ? parent.height : end - start;
      const offset = (start + end - extent) / 2;
      p.x = parent.x + (horizontal ? cos : -sin) * offset;
      p.y = parent.y + (horizontal ? sin : cos) * offset;
      p.vx = parent.vx + (i - (count - 1) / 2) * 0.65;
      p.vy = parent.vy - noise(parent.seed, i) * 0.8;
      p.angle = parent.angle; p.life = 12 + i * 2;
    }
  }

  emitDeath(lem, kind, provider) {
    if (!this.spawnBudget || !this.freeCount) return false;
    const parts = provider?.getActorParticleParts?.(lem);
    if (!parts) return false;
    const seed = hash(`${lem.id}:${lem.frameIndex}:${kind}`);
    this._eject(parts.eyewear, lem, hash(`${seed}:eyewear`), 'eyewear');
    this._eject(parts.accessory, lem, hash(`${seed}:accessory`), 'accessory');
    const body = parts.body;
    const count = kind === 'exploding' ? 12 : kind === 'splatter' ? 8 : 5;
    if (body?.getBuffer && body.getMask) {
      const area = body.width * body.height;
      for (let i = 0; i < count && this.sampleBudget > 0; i++) {
        let index = Math.floor(noise(seed, i + 60) * area), found = false;
        for (let j = 0; j < Math.min(area, 32) && this.sampleBudget > 0; j++) {
          this.sampleBudget--;
          if (occupied(body, index)) { found = true; break; }
          index = (index + 1) % area;
        }
        if (!found) continue;
        const p = this._spawn(hash(`${seed}:body:${i}`), 'body');
        if (!p) break;
        p.source = body; p.sx = index % body.width; p.sy = Math.floor(index / body.width);
        p.width = Math.min(2 + (i % 2), body.width - p.sx); p.height = Math.min(2, body.height - p.sy);
        p.x = lem.x + body.offsetX + p.sx + (p.width - 1) / 2;
        p.y = lem.y + body.offsetY + p.sy + (p.height - 1) / 2;
        p.vx = (noise(seed, i) - 0.5) * (kind === 'exploding' ? 7 : 4);
        p.vy = -0.7 - noise(seed, i + 20) * (kind === 'splatter' ? 2 : 4);
        p.life = 16 + Math.floor(noise(seed, i + 40) * 8);
      }
    }
    const burstCount = kind === 'exploding' ? 12 : 6;
    for (let i = 0; i < burstCount; i++) {
      const p = this._spawn(hash(`${seed}:burst:${i}`), kind === 'drowning' ? 'splash' : 'spark');
      if (!p) break;
      const angle = i / burstCount * Math.PI * 2;
      p.x = lem.x; p.y = lem.y - 5;
      p.vx = Math.cos(angle) * (1.3 + noise(seed, i) * 2);
      p.vy = Math.sin(angle) * 1.8 - 1.5;
      p.color = kind === 'drowning' ? (i % 2 ? 0xffffd788 : 0xfffff4cf)
        : kind === 'splatter' ? 0xffffecd5 : (i % 2 ? 0xff65bfff : 0xffc7eeff);
      p.life = kind === 'exploding' ? 10 + i % 5 : 12 + i;
      p.gravity = kind === 'frying' ? -0.035 : 0.12;
      p.width = p.height = i % 3 ? 1 : 2;
    }
    return true;
  }

  render(display) {
    if (!this.activeCount || !display) return;
    const dest = display.buffer32, width = display.imgData?.width, height = display.imgData?.height;
    const view = display.stage?.getGameViewRect?.() || display.getGameViewRect?.();
    let budget = PARTICLE_LIMITS.pixelsPerRender;
    for (const p of this.particles) {
      if (!p.life) continue;
      if (view && (p.x + p.width < view.x || p.y + p.height < view.y || p.x - p.width >= view.x + view.w || p.y - p.height >= view.y + view.h)) continue;
      const alpha = Math.min(1, (p.life - p.age) / Math.max(1, p.life * 0.55));
      const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
      const source = p.source?.getBuffer(), mask = p.source?.getMask();
      const halfW = (p.width - 1) / 2, halfH = (p.height - 1) / 2;
      for (let sy = 0; sy < p.height && budget > 0; sy++) for (let sx = 0; sx < p.width && budget > 0; sx++) {
        budget--;
        const index = source ? (p.sy + sy) * p.source.width + p.sx + sx : 0;
        if (mask && !mask[index]) continue;
        const color = source ? source[index] : p.color;
        const opacity = (color >>> 24) / 255 * alpha;
        if (!opacity) continue;
        const x = Math.round(p.x + (sx - halfW) * cos - (sy - halfH) * sin);
        const y = Math.round(p.y + (sx - halfW) * sin + (sy - halfH) * cos);
        if (dest && width && height) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const target = y * width + x, old = dest[target], inverse = 1 - opacity;
          dest[target] = color32(Math.round((color & 255) * opacity + (old & 255) * inverse),
            Math.round(((color >>> 8) & 255) * opacity + ((old >>> 8) & 255) * inverse),
            Math.round(((color >>> 16) & 255) * opacity + ((old >>> 16) & 255) * inverse));
        } else if (display.drawParticlePixel) {
          display.drawParticlePixel(x, y, color, opacity);
        } else if (display.drawFrame) {
          this.pixel.getBuffer()[0] = ((Math.round(opacity * 255) << 24) | (color & 0xffffff)) >>> 0;
          display.drawFrame(this.pixel, x, y);
        }
      }
      const radius = Math.ceil(Math.hypot(p.width, p.height) / 2) + 1;
      display.markDirtyRect?.(Math.floor(p.x) - radius, Math.floor(p.y) - radius, radius * 2 + 1, radius * 2 + 1);
      if (!budget) return;
    }
  }
}

export { CharacterParticles, PARTICLE_LIMITS };
