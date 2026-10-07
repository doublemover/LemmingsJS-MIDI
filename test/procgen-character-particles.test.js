import { expect } from 'chai';
import fs from 'node:fs';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { CharacterSpriteSet } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
const read = path => fs.readFileSync(path, 'utf8');
const alive = pool => pool.particles.filter(p => p.life);
const state = world => world.actors.map(actor => [actor.x, actor.y, actor.frameIndex, actor.action?.getActionName(), actor.failureReason]);

describe('shared-world character particle integration', function() {
  let masks, terrain, sprites;
  before(async () => {
    [masks, terrain] = await Promise.all([loadProcgenMasks(), loadProcgenTerrain()]);
    const preference = { shape: 'heart', accessory: 'crown', eyewear: 'classic_sunglasses' };
    sprites = new CharacterSpriteSet(new PixelSpriteSkin(JSON.parse(read('assets/hydro/hydro-skin.json'))),
      JSON.parse(read('assets/characters/catalog.json')), read, () => preference);
    await sprites.prepare();
  });

  it('samples real sparse terrain colors and emits only after their removal', function() {
    const world = new ProcgenLaneWorld({ masks, terrain, sprites, assists: false }), pool = world.characterParticles;
    const actor = world.actors[0], y = world.surfaceAt(0, 80) + 3;
    pool.sampleRow(world, 80, y, 9);
    const samples = pool.samples.slice(0, pool.sampleCount).map(sample => ({ ...sample }));
    expect(samples.length).to.be.greaterThan(0);
    pool.emitTerrain(actor, 'bashing'); expect(pool.activeCount).to.equal(0);
    pool.sampleRow(world, 80, y, 9);
    for (const sample of samples) world._setPixel(sample.x, sample.y, 0);
    pool.emitTerrain(actor, 'bashing');
    expect(pool.activeCount).to.be.greaterThan(0);
    expect(alive(pool).every(p => samples.some(sample => sample.color === p.color))).to.equal(true);
    expect(world.groundMask).to.equal(undefined);
    expect(world.groundImage).to.equal(undefined);
    world.dispose();
  });

  it('runs actual bash debris alongside identical physics, destruction and progress', function() {
    const options = { masks, terrain, laneCount: 8, seed: 42 };
    const plain = new ProcgenLaneWorld(options), decorated = new ProcgenLaneWorld({ ...options, sprites });
    let sawDebris = false;
    for (let tick = 0; tick < 1000; tick++) {
      plain.step(); decorated.step();
      if (alive(decorated.characterParticles).some(p => p.kind === 'terrain')) sawDebris = true;
      expect(state(decorated)).to.deep.equal(state(plain));
    }
    expect(sawDebris).to.equal(true);
    expect([...decorated.editChunks]).to.deep.equal([...plain.editChunks]);
    expect(decorated.stats.bashes).to.equal(plain.stats.bashes).and.to.be.greaterThan(0);
    expect(decorated.stats.removedPixels).to.equal(plain.stats.removedPixels);
    expect(plain.characterParticles).to.equal(null);
    plain.dispose(); decorated.dispose();
  });

  it('emits real explosion wearables and debris, advances once per world tick, and clears on restart/disposal', function() {
    const world = new ProcgenLaneWorld({ masks, terrain, sprites, assists: false }), actor = world.actors[0];
    actor.x = 80; actor.y = world.surfaceAt(0, actor.x) + 3; actor.setAction(world.actions[State.EXPLODING]);
    world.step();
    const pool = world.characterParticles, kinds = alive(pool).map(p => p.kind);
    expect(kinds).to.include.members(['body', 'accessory', 'eyewear', 'terrain']);
    expect(pool.frame).to.equal(1);
    world.step(); expect(pool.frame).to.equal(2);
    expect(alive(pool).every(p => p.age === 1)).to.equal(true);
    world._restart([0]); expect(pool.activeCount).to.equal(0);
    pool.emitDeath(actor, 'exploding', sprites); expect(pool.activeCount).to.be.greaterThan(0);
    world.dispose(); expect(pool.activeCount).to.equal(0);
    expect(pool.particles.every(p => p.source === null)).to.equal(true);
  });

  it('emits unsafe-fall wearables once without delaying failure or changing collision results', function() {
    const world = new ProcgenLaneWorld({ masks, terrain, sprites, assists: false }), actor = world.actors[0];
    actor.process = () => State.SPLATTING;
    world.step();
    expect(actor.failureReason).to.equal('unsafe-fall');
    expect(alive(world.characterParticles).filter(p => p.kind === 'eyewear')).to.have.length(1);
    world.step();
    expect(alive(world.characterParticles).filter(p => p.kind === 'eyewear')).to.have.length(1);
    expect(world.stats.failures).to.equal(1);
    world.dispose();
  });
});
