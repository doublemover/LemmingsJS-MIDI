import { expect } from 'chai';
import fs from 'node:fs';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { MapObject } from '../js/level/MapObject.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';
import { Level } from '../js/level/Level.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { CharacterSpriteSet } from '../js/lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';

const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 900, height: 288, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};
const rendererFor = world => new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const trapWalker = (world, actor, object) => {
  Object.assign(actor, { x: object.x + object.piece.image.trigger_left - 1, y: object.supportY, lookRight: true });
  actor.setAction(world.actions[State.WALKING]);
};

describe('generated source hazard physics owners', function() {
  this.timeout(30000);
  let masks, sprites;
  before(async () => {
    masks = await loadProcgenMasks();
    const preference = { shape: 'circle', accessory: 'crown', eyewear: 'classic_sunglasses' };
    sprites = new CharacterSpriteSet(new PixelSpriteSkin(read('assets/hydro/hydro-skin.json')), read('assets/characters/catalog.json'),
      file => fs.readFileSync(file, 'utf8'), () => preference);
    await sprites.prepare();
  });
  const fixture = async (ground, id, options = {}) => {
    const terrain = await loadProcgenTerrain('lemmings', ground);
    terrain.objects = [terrain.objects.find(piece => piece.id === id)]; terrain.compiledAssemblies = []; terrain.compiledAssemblies = [];
    // This fixture isolates a fully prepared source hazard from growth scheduling.
    terrain.supportsFineGrowth = false;
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42, assists: false, ...options }), events = [];
    world.soundEvents.onEvent.on(event => events.push(event));
    let object, chunk;
    for (let candidate = 2; candidate < 48 && !object; candidate++) {
      world.generatedThrough[0] = (candidate + 1) * 128;
      const descriptor = terrain.describe(world.laneSeeds[0], candidate), placed = descriptor.objects[0];
      if (placed && world.hazards.placementReady(0, candidate, placed, descriptor)) { object = placed; chunk = candidate; }
    }
    expect(object).to.exist;
    return { world, terrain, object, chunk, actor: world.actors[0], events };
  };

  it('reuses actual source bounds, trap sound, MapObject and frame-count cooldown for two walkers', async () => {
    const { world, object, chunk, actor, events } = await fixture(0, 6);
    const follower = world._spawn(0); trapWalker(world, actor, object); trapWalker(world, follower, object);
    actor.setCountDown({ process: () => State.NO_STATE_TYPE });
    world.step();
    const entry = world.hazards.peek(0, chunk, 0), image = object.piece.image;
    expect(entry.owner).to.be.instanceOf(MapObject); expect(entry.trigger).to.be.instanceOf(Trigger);
    const level = new Level(128, 96), images = []; images[object.piece.id] = image;
    level.setMapObjects([{ id: object.piece.id, x: object.x, y: object.y, drawProperties: 0 }], images);
    for (const field of ['type', 'x1', 'x2', 'y1', 'y2', 'disableTicksCount', 'soundIndex']) expect(entry.trigger[field], field).to.equal(level.triggers[0][field]);
    expect(entry.trigger.disabledUntilTick).to.equal(1 + image.frameCount);
    expect(entry.owner.runtime).to.equal(world.runtime); expect(entry.trigger.runtime).to.equal(world.runtime);
    expect(actor.action).to.equal(world.actions[State.SPLATTING]); expect(actor.frameIndex).to.equal(0);
    expect(actor.countdown).to.equal(0); expect(actor.countdownAction).to.equal(null);
    expect(actor.lastTriggerType).to.equal(Types.TRAP); expect(follower.action).to.equal(world.actions[State.WALKING]);
    expect(entry.activated).to.equal(true); expect(world.hazards.getFrame(entry, 1)).to.equal(entry.owner.animation.frames[0]);
    world.step(); expect(actor.disabled).to.equal(true); expect(actor.frameIndex).to.equal(1);
    expect(world.hazards.getFrame(entry, 2)).to.equal(entry.owner.animation.frames[1]);
    while (world.tickIndex < image.frameCount) world.step();
    const replacement = world._spawn(0); trapWalker(world, replacement, object); world.step();
    expect(world.hazards.peek(0, chunk, 0).owner).to.equal(entry.owner);
    expect(replacement.action).to.equal(world.actions[State.SPLATTING]);
    expect(entry.trigger.disabledUntilTick).to.equal(world.tickIndex + image.frameCount);
    const contacts = events.filter(event => event.type === 'trap-trigger');
    expect(contacts).to.have.length(2); expect(contacts.map(event => event.lemmingId)).to.deep.equal([actor.id, replacement.id]);
    expect(contacts.every(event => event.sfxId === image.trap_sound_effect_id && event.objectId === object.piece.id && event.laneIndex === 0 && event.laneCount === 1)).to.equal(true);
    while (world.tickIndex < 17) world.step();
    expect(actor.failureReason).to.equal('trapped'); expect(actor.frameIndex).to.equal(16);
    expect(world.stats.failures).to.equal(1); expect(events.some(event => event.type === 'lemming-splat')).to.equal(false);
    world.dispose();
  });

  it('enters source water naturally, anchors the custom body to its real surface, and finishes one 16-tick death', async () => {
    const { world, object, chunk, actor, events } = await fixture(3, 5, { sprites, laneCount: 2 });
    Object.assign(actor, { x: object.x - 1, y: object.y, lookRight: true }); actor.setAction(world.actions[State.WALKING]);
    while (actor.action !== world.actions[State.DROWNING] && world.tickIndex < 40) world.step();
    expect(actor.action).to.equal(world.actions[State.DROWNING]);
    const entry = world.hazards.peek(0, chunk, 0), contactTick = world.tickIndex, x = actor.x;
    expect(entry.owner.triggerType).to.equal(Types.DROWN); expect(entry.trigger.disableTicksCount).to.equal(0);
    expect(sprites.getActorHazardKind(actor)).to.equal('water');
    const origin = sprites.getActorDrawPosition(actor);
    expect(origin.x).to.equal(x); expect(origin.y).to.equal(entry.owner.liquidSurface(x, contactTick + 1) + 1);
    for (let step = 1; step <= 16; step++) {
      world.step(); expect(actor.frameIndex).to.equal(step);
      if (step < 16) expect(actor.failureReason).to.equal(null);
    }
    expect(actor.failureReason).to.equal('drowned'); expect(actor.disabled).to.equal(true);
    const deaths = events.filter(event => event.type === 'lemming-drown' && event.lemmingId === actor.id);
    expect(deaths).to.have.length(1); expect(deaths[0]).to.include({ laneIndex: 0, laneCount: 2, triggerType: Types.DROWN, tick: contactTick + 1 });
    expect(events.some(event => event.type === 'lemming-fell-off' && event.lemmingId === actor.id)).to.equal(false);
    world.dispose();
  });

  it('preserves authored fire remapping and the actual 14-tick frying action without duplicate splat audio', async () => {
    const { world, object, chunk, actor, events } = await fixture(1, 7, { sprites });
    Object.assign(actor, { x: object.x + object.piece.image.trigger_left, y: object.y + object.piece.image.trigger_top }); actor.setAction(world.actions[State.FALLING]);
    while (actor.action !== world.actions[State.FRYING] && world.tickIndex < 40) world.step();
    const entry = world.hazards.peek(0, chunk, 0);
    expect(actor.action).to.equal(world.actions[State.FRYING]); expect(entry.trigger.type).to.equal(Types.FRYING);
    expect(entry.owner.animation.loop).to.equal(true); expect(sprites.getActorHazardKind(actor)).to.equal('fire');
    for (let step = 0; step < 14; step++) world.step();
    expect(actor.frameIndex).to.equal(14); expect(actor.failureReason).to.equal('fried');
    expect(events.filter(event => event.type === 'lemming-fire')).to.have.length(1);
    expect(events.some(event => event.type === 'lemming-splat')).to.equal(false);
    world.dispose();
  });

  it('retains non-fire KILL identity and shared terminal contact presentation', async () => {
    const { world, actor, object, chunk, events } = await fixture(2, 9, { sprites });
    Object.assign(actor, { x: object.x + object.piece.image.trigger_left, y: object.y + object.piece.image.trigger_top });
    actor.setAction(world.actions[State.FALLING]); world.step();
    expect(world.hazards.peek(0, chunk, 0).trigger.type).to.equal(Types.KILL);
    expect(actor.action).to.equal(world.actions[State.SPLATTING]); expect(sprites.getActorHazardKind(actor)).to.equal('slice');
    for (let step = 0; step < 16; step++) world.step();
    expect(actor.failureReason).to.equal('killed'); expect(events.filter(event => event.type === 'lemming-fire')).to.have.length(1);
    expect(events.some(event => event.type === 'lemming-splat')).to.equal(false); world.dispose();
  });

  it('gates complete image/trigger/basin footprints and invalidates owners when a floor or side is removed', async () => {
    const { world, terrain, object, chunk, actor } = await fixture(3, 5);
    const descriptor = terrain.describe(world.laneSeeds[0], chunk), end = object.x + object.piece.image.width + 1;
    world.generatedThrough[0] = end - 1;
    expect(world.hazards.placementReady(0, chunk, object, descriptor)).to.equal(false);
    expect(world.hazards.trigger(object.x + 4, object.y + 5, actor)).to.equal(Types.NO_TRIGGER);
    expect(world.hazards.peek(0, chunk, 0)).to.equal(null); expect(world.hazards.stats.created).to.equal(0);
    world.generatedThrough[0] = end;
    world.hazards.trigger(object.x + 4, object.y + 5, actor);
    const owner = world.hazards.peek(0, chunk, 0).owner;
    world._setPixel(object.x, object.supportY, 0);
    expect(world.hazards.peek(0, chunk, 0)).to.equal(null);
    expect(world.hazards.trigger(object.x + 4, object.y + 5, actor)).to.equal(Types.NO_TRIGGER);
    world._setPixel(object.x, object.supportY, 3);
    expect(world.hazards.peek(0, chunk, 0).owner).to.equal(owner);
    world._setPixel(object.x - 1, object.y + 2, 0);
    expect(world.hazards.peek(0, chunk, 0)).to.equal(null);
    const renderer = rendererFor(world); renderer.follow = false; renderer.render();
    expect(renderer.objectPlacements.some(placement => placement.image === object.piece.image)).to.equal(false);
    renderer.dispose(); world.dispose();
  });

  it('uses actual owner frames in the renderer while camera pans and paused draws cannot create owners or advance traps', async () => {
    const { world, object, chunk, actor, terrain } = await fixture(0, 6, { laneCount: 64 }), renderer = rendererFor(world);
    renderer.follow = false; renderer.cameraX = object.x - 24; renderer.render(); expect(world.hazards.chunks.size).to.equal(0);
    trapWalker(world, actor, object); world.step(); renderer.render();
    const entry = world.hazards.peek(0, chunk, 0), first = world.hazards.getFrame(entry, world.tickIndex);
    expect(renderer.frames.has(first)).to.equal(true);
    world.step(); renderer.render();
    const second = world.hazards.getFrame(entry, world.tickIndex), disabledUntil = entry.trigger.disabledUntilTick;
    expect(second).not.to.equal(first); expect(renderer.frames.has(second)).to.equal(true);
    const owners = world.hazards.stats.created, generated = terrain.stats.generated;
    renderer.render(false); const hits = renderer.frameCacheHits; renderer.render(false);
    expect(renderer.frameCacheHits).to.equal(hits + 1); expect(entry.trigger.disabledUntilTick).to.equal(disabledUntil);
    expect(world.hazards.getFrame(entry, world.tickIndex)).to.equal(second);
    world.generatedThrough[0] = 4096; renderer.cameraX = 2048; renderer.scale = 0.01; renderer.render();
    expect(world.hazards.stats.created).to.equal(owners); expect(terrain.stats.generated).to.equal(generated);
    renderer.dispose(); expect(renderer.objectPlacements).to.have.length(0); world.dispose();
  });

  it('bounds actor-query chunk records, preserves active trap cooldown across pruning, and clears on reset/dispose', async () => {
    const { world, object, chunk, actor } = await fixture(0, 6);
    world.hazards.maxChunks = 2; world.generatedThrough[0] = 8192;
    trapWalker(world, actor, object); world.step(); const entry = world.hazards.peek(0, chunk, 0);
    world.hazards.prune(2, true); expect(world.hazards.peek(0, chunk, 0)).to.equal(entry);
    for (let chunk = 1; chunk < 40; chunk++) {
      world.hazards.trigger(chunk * 128 + 2, 20, actor, chunk + 40);
      expect(world.hazards.chunks.size).to.be.at.most(2);
    }
    expect(world.hazards.stats.evicted).to.be.greaterThan(0);
    world._restart([]); expect(world.hazards.chunks.size).to.equal(0); expect(world.hazards.stats.contacts).to.equal(0);
    expect(world.generatedThrough[0]).to.equal(world.terrainGrowth ? 104 : 128); expect(world.accessTasks[0]).to.equal(null);
    world._spawn(0); world.hazards.trigger(36, 42, world.actors[0]); expect(world.hazards.chunks.size).to.equal(1);
    world.dispose(); expect(world.hazards.chunks.size).to.equal(0); expect(world.hazards.world).to.equal(null);
  });

  it('leaves exits, entrances, arrows, and unrelated generated scenery without physics owners', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 3);
    terrain.objects = terrain.objects.filter(piece => ![Types.TRAP, Types.DROWN, Types.KILL, Types.FRYING].includes(piece.image.trigger_effect_id));
    const world = new ProcgenLaneWorld({ masks, terrain, assists: false, seed: 42 });
    for (let tick = 0; tick < 150; tick++) world.step();
    expect(world.hazards.stats.contacts).to.equal(0); expect(world.hazards.stats.created).to.equal(0);
    expect(Object.values(world.actions).some(action => action.actionName === 'exiting')).to.equal(false); world.dispose();
  });
});
