import { expect } from 'chai';
import { CharacterParticles, PARTICLE_LIMITS } from '../js/lemmings/CharacterParticles.js';
import { Frame } from '../js/render/Frame.js';
import { Level } from '../js/level/Level.js';
import { ActionDiggSystem } from '../js/actions/ActionDiggSystem.js';
import { ActionBashSystem } from '../js/actions/ActionBashSystem.js';
import { ActionMineSystem } from '../js/actions/ActionMineSystem.js';
import { ActionExplodingSystem } from '../js/actions/ActionExplodingSystem.js';
import { ActionSplatterSystem } from '../js/actions/ActionSplatterSystem.js';
import { ActionDrowningSystem } from '../js/actions/ActionDrowningSystem.js';
import { ActionFryingSystem } from '../js/actions/ActionFryingSystem.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { makeManager } from './helpers/lemming-manager.js';
import { HistoryStore } from '../js/game/HistoryStore.js';

const rgb = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
const layer = (width, height, x, y, color) => {
  const frame = new Frame(width, height, x, y);
  frame.getBuffer().fill(color); frame.getMask().fill(1);
  return frame;
};
const body = layer(8, 8, -4, -9, rgb(70, 125, 250));
const eyewear = layer(7, 2, -3, -7, rgb(40, 35, 30));
const accessory = layer(8, 3, -4, -12, rgb(240, 125, 80));
const provider = {
  getActorParticleParts() { return { body, eyewear, accessory }; },
  getAnimation() { return { getFrame: () => body }; }
};
const actor = id => new Lemming(30, 30, id);
const live = particles => particles.particles.filter(p => p.life);
const snapshot = particles => live(particles).map(p => ({ ...p, source: p.source ? Array.from(p.source.getBuffer()) : null }));
const terrain = () => {
  const level = new Level(64, 48);
  level.groundImage = new Uint8ClampedArray(64 * 48 * 4);
  level.groundMask.mask.fill(1);
  for (let i = 0; i < 64 * 48; i++) level.groundImage.set([123, 78, 45, 255], i * 4);
  return level;
};
const subMask = { width: 8, height: 8, offsetX: -4, offsetY: -7, at: () => false };
const masks = { GetMask: () => ({ GetMask: () => subMask }) };
const display = () => ({ buffer32: new Uint32Array(100 * 100).fill(0xff000000), imgData: { width: 100, height: 100 }, markDirtyRect() {} });

describe('bounded deterministic character particles', function() {
  it('samples actual terrain colors before removal and never emits protected or untouched pixels', function() {
    const pool = new CharacterParticles(), level = terrain(), lem = actor(7);
    level.steelMask.mask[30 * 64 + 27] = 1;
    pool.sampleRow(level, 26, 30, 9);
    expect(pool.sampleCount).to.equal(8);
    pool.emitTerrain(lem, 'digging');
    expect(pool.activeCount).to.equal(0);
    pool.sampleRow(level, 26, 30, 9);
    level.clearGroundRow(26, 30, 9);
    pool.emitTerrain(lem, 'digging');
    expect(pool.activeCount).to.equal(4);
    expect(live(pool).every(p => p.color === rgb(123, 78, 45))).to.equal(true);
    expect(live(pool).some(p => p.x === 27)).to.equal(false);
    expect(level.groundMask.mask[30 * 64 + 27]).to.equal(1);
    expect(live(pool).some(p => p.vx > 0)).to.equal(true);
    expect(live(pool).some(p => p.vx < 0)).to.equal(true);
  });

  it('keeps dig bursts sparse, evenly samples the cut and throws outside the central body', function() {
    const pool = new CharacterParticles(), level = terrain(), lem = actor(7);
    for (let x = 26; x <= 34; x++) level.groundImage[(30 * 64 + x) * 4] = x;
    pool.sampleRow(level, 26, 30, 9); level.clearGroundRow(26, 30, 9); pool.emitTerrain(lem, 'digging');
    const chips = live(pool);
    expect(chips).to.have.length(4);
    expect(chips.map(p => p.color & 255).sort((a, b) => a - b)).to.deep.equal([26, 29, 31, 34]);
    expect(chips.filter(p => p.vx < 0)).to.have.length(2);
    expect(chips.filter(p => p.vx > 0)).to.have.length(2);
    expect(chips.every(p => Math.abs(p.x - lem.x) >= 4 && Math.abs(p.vx) >= 1.65 && p.height === 1)).to.equal(true);
    for (let i = 0; i < 14; i++) pool.tick();
    expect(pool.activeCount).to.equal(0);
  });

  it('caps tunnel bursts at six chips while keeping explosions rich', function() {
    for (const [kind, expected] of [['bashing', 6], ['mining', 6], ['exploding', 10]]) {
      const pool = new CharacterParticles(), level = terrain(), lem = actor(7);
      pool.sampleMask(level, subMask, lem.x, lem.y, lem);
      level.clearGroundWithMask(subMask, lem.x, lem.y); pool.emitTerrain(lem, kind);
      expect(pool.activeCount, kind).to.equal(expected);
    }
  });

  it('respects mask holes and skips protected terrain in explosion sampling', function() {
    const pool = new CharacterParticles(), level = terrain(), lem = actor(3);
    const mask = { width: 4, height: 2, offsetX: 0, offsetY: 0, at: x => x < 2 };
    level.steelMask.mask[30 * 64 + 33] = 1;
    pool.sampleMask(level, mask, 30, 30, lem);
    level.clearGroundWithMask(mask, 30, 30, { revealSteel: true });
    pool.emitTerrain(lem, 'exploding');
    expect(pool.activeCount).to.equal(3);
    expect(live(pool).every(p => p.x >= 32)).to.equal(true);
    expect(live(pool).some(p => p.x === 33 && p.y === 30)).to.equal(false);
  });

  it('does not touch simulation RNG and reproduces actor/frame seeded effects', function() {
    const a = new CharacterParticles(), b = new CharacterParticles(), c = new CharacterParticles();
    const oldRandom = Math.random;
    Math.random = () => { throw new Error('Simulation RNG must not be used'); };
    try {
      a.emitDeath(actor(20), 'exploding', provider);
      b.emitDeath(actor(20), 'exploding', provider);
      c.emitDeath(actor(21), 'exploding', provider);
      for (let i = 0; i < 5; i++) { a.tick(); b.tick(); c.tick(); }
      expect(snapshot(a)).to.deep.equal(snapshot(b));
      expect(snapshot(a)).not.to.deep.equal(snapshot(c));
    } finally { Math.random = oldRandom; }
  });

  it('ejects intact eyewear and headwear before splitting each into three fading fragments', function() {
    const pool = new CharacterParticles();
    pool.emitDeath(actor(4), 'splatter', provider);
    let glasses = live(pool).find(p => p.kind === 'eyewear');
    expect(glasses.source).to.equal(eyewear);
    expect(glasses.width).to.equal(eyewear.width);
    expect(glasses.height).to.equal(eyewear.height);
    const initialY = glasses.y;
    pool.tick(); pool.tick();
    glasses = live(pool).find(p => p.kind === 'eyewear');
    expect(glasses.y).to.be.below(initialY);
    expect(live(pool).filter(p => p.kind.endsWith('-fragment'))).to.have.length(0);
    pool.tick();
    expect(live(pool).some(p => p.kind === 'eyewear' || p.kind === 'accessory')).to.equal(false);
    expect(live(pool).filter(p => p.kind === 'eyewear-fragment')).to.have.length(3);
    expect(live(pool).filter(p => p.kind === 'accessory-fragment')).to.have.length(3);
    for (let i = 0; i < 30; i++) pool.tick();
    expect(pool.activeCount).to.equal(0);
    expect(pool.particles.every(p => p.source === null)).to.equal(true);
  });

  it('keeps particle, sample, spawn and render work bounded under sustained crowd deaths', function() {
    const pool = new CharacterParticles(), references = [...pool.particles];
    for (let tick = 0; tick < 70; tick++) {
      pool.tick();
      for (let id = 0; id < 200; id++) pool.emitDeath(actor(id), 'exploding', provider);
      expect(pool.activeCount).to.be.at.most(PARTICLE_LIMITS.capacity);
      expect(pool.spawnBudget).to.be.at.least(0);
      expect(pool.sampleBudget).to.be.at.least(0);
      let calls = 0;
      pool.render({ drawFrame() { calls++; } });
      expect(calls).to.be.at.most(PARTICLE_LIMITS.pixelsPerRender);
    }
    expect(pool.particles.every((p, i) => p === references[i])).to.equal(true);
    for (let i = 0; i < 40; i++) pool.tick();
    expect(pool.freeCount).to.equal(PARTICLE_LIMITS.capacity);
  });

  it('fades by blending with world pixels and rendering never advances effects', function() {
    const pool = new CharacterParticles(), level = terrain(), lem = actor(1);
    pool.sampleRow(level, 30, 30, 1); level.clearGroundRow(30, 30, 1); pool.emitTerrain(lem, 'digging');
    const p = live(pool)[0];
    p.x = p.y = 30; p.width = p.height = 1; p.age = p.life - 1;
    const before = snapshot(pool), target = display();
    pool.render(target); pool.render(display());
    expect(snapshot(pool)).to.deep.equal(before);
    const color = target.buffer32[30 * 100 + 30];
    expect(color & 255).to.be.above(0).and.below(123);
    expect((color >>> 8) & 255).to.be.above(0).and.below(78);
  });

  it('uses independent world positions and survives actor removal or pooling', function() {
    const pool = new CharacterParticles(), lem = actor(1);
    pool.emitDeath(lem, 'frying', provider);
    const before = snapshot(pool);
    lem.remove(); lem.reset(400, 250, 2);
    expect(snapshot(pool)).to.deep.equal(before);
    pool.tick();
    expect(live(pool).every(p => p.x < 50)).to.equal(true);
    const target = display(); pool.render(target);
    expect(target.buffer32.some(color => color !== 0xff000000)).to.equal(true);
  });

  it('culls offscreen particles without consuming the visible render budget', function() {
    const pool = new CharacterParticles(), lem = actor(1);
    pool.emitDeath(lem, 'exploding', provider);
    let calls = 0;
    pool.render({ stage: { getGameViewRect: () => ({ x: 200, y: 200, w: 100, h: 100 }) }, drawFrame() { calls++; } });
    expect(calls).to.equal(0);
  });

  it('advances only with manager ticks and renders debris after the last actor is gone', function() {
    const { manager, level } = makeManager();
    level.isSuperLemming = true;
    manager.particles.emitDeath(actor(2), 'exploding', provider);
    const before = snapshot(manager.particles);
    manager.render(display());
    expect(snapshot(manager.particles)).to.deep.equal(before);
    manager.tick();
    expect(manager.particles.frame).to.equal(1);
    expect(live(manager.particles).every(p => p.age === 1)).to.equal(true);
    expect(manager.activeLemmings).to.have.length(0);
    const target = display(); manager.render(target);
    expect(target.buffer32.some(color => color !== 0xff000000)).to.equal(true);
  });

  it('clears all held frames on replay and disposal', function() {
    const { manager } = makeManager();
    manager.particles.emitDeath(actor(2), 'exploding', provider);
    HistoryStore.prototype._rebuildActiveLemmings.call({}, manager);
    expect(manager.particles.activeCount).to.equal(0);
    manager.particles.emitDeath(actor(2), 'exploding', provider);
    const pool = manager.particles;
    manager.dispose();
    expect(pool.activeCount).to.equal(0);
    expect(manager.actions.filter(Boolean).every(action => action.characterParticles === null)).to.equal(true);
  });
});

describe('character particle action integration', function() {
  for (const [name, Action, kind, frame] of [
    ['dig', ActionDiggSystem, 'digging', 0], ['bash', ActionBashSystem, 'bashing', 1], ['mine', ActionMineSystem, 'mining', 0]
  ]) {
    it(`${name} creates real debris without changing terrain or action results`, function() {
      const plainLevel = terrain(), decoratedLevel = terrain(), plainLem = actor(1), decoratedLem = actor(1);
      const plain = new Action(provider, masks), decorated = new Action(provider, masks);
      const pool = decorated.characterParticles = new CharacterParticles();
      plainLem.frameIndex = decoratedLem.frameIndex = frame;
      const before = Array.from(decoratedLevel.groundImage);
      expect(decorated.process(decoratedLevel, decoratedLem)).to.equal(plain.process(plainLevel, plainLem));
      expect(Array.from(decoratedLevel.groundImage)).to.deep.equal(Array.from(plainLevel.groundImage));
      expect(Array.from(decoratedLevel.groundMask.mask)).to.deep.equal(Array.from(plainLevel.groundMask.mask));
      expect(Array.from(decoratedLevel.groundImage)).not.to.deep.equal(before);
      expect([decoratedLem.x, decoratedLem.y, decoratedLem.frameIndex, decoratedLem.state]).to.deep.equal([plainLem.x, plainLem.y, plainLem.frameIndex, plainLem.state]);
      expect(pool.activeCount, kind).to.be.above(0);
      expect(live(pool).every(p => p.color === rgb(123, 78, 45))).to.equal(true);
    });
  }

  for (const [kind, Action] of [['splatter', ActionSplatterSystem], ['drowning', ActionDrowningSystem], ['frying', ActionFryingSystem]]) {
    it(`${kind} emits once and retains the same simulation behavior`, function() {
      const plain = new Action(provider), decorated = new Action(provider);
      const pool = decorated.characterParticles = new CharacterParticles();
      const plainLem = actor(1), decoratedLem = actor(1), level = terrain();
      for (let frame = 0; frame < 16; frame++) {
        expect(decorated.process(level, decoratedLem)).to.equal(plain.process(level, plainLem));
        expect([decoratedLem.x, decoratedLem.y, decoratedLem.frameIndex, decoratedLem.disabled]).to.deep.equal([plainLem.x, plainLem.y, plainLem.frameIndex, plainLem.disabled]);
      }
      expect(live(pool).filter(p => p.kind === 'eyewear')).to.have.length(1);
    });
  }

  it('explosion retains classic timing and destruction while replacing custom legacy particles', function() {
    const trigger = { removeByOwner() {} }, calls = [];
    const plain = new ActionExplodingSystem(provider, masks, trigger, { draw: () => calls.push('legacy') });
    const decorated = new ActionExplodingSystem(provider, masks, trigger, { draw: () => calls.push('legacy') });
    decorated.characterParticles = new CharacterParticles();
    const plainLem = actor(1), decoratedLem = actor(1), plainLevel = terrain(), decoratedLevel = terrain();
    for (let frame = 0; frame < 52; frame++) {
      expect(decorated.process(decoratedLevel, decoratedLem)).to.equal(plain.process(plainLevel, plainLem));
    }
    expect(Array.from(decoratedLevel.groundMask.mask)).to.deep.equal(Array.from(plainLevel.groundMask.mask));
    expect(Array.from(decoratedLevel.groundImage)).to.deep.equal(Array.from(plainLevel.groundImage));
    decorated.draw({ drawFrame() {} }, decoratedLem);
    expect(calls).to.have.length(0);
    plain.draw({ drawFrame() {} }, plainLem);
    expect(calls).to.have.length(1);
    decoratedLem.frameIndex = 0;
    decorated.draw({ drawFrame(_frame, x, y) { expect([x, y]).to.deep.equal([20, 22]); } }, decoratedLem);
  });
});
