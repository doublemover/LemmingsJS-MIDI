import { expect } from 'chai';
import { loadProcgenMasks, loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { ProcgenRecipeTerrain } from '../js/app/procgen/ProcgenRecipeTerrain.js';
import { ProcgenLaneWorld } from '../js/app/procgen/ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from '../js/app/procgen/ProcgenLaneRenderer.js';
import { assemblyPlacementReady } from '../js/app/procgen/ProcgenAssemblyPlacement.js';
import { compileAuthoredAssemblies } from '../js/app/procgen/ProcgenAuthoredAssemblies.js';
import { procgenObjectImage } from '../js/app/procgen/ProcgenObjectPresentation.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';

const canvasFixture = () => {
  const context = { globalAlpha: 1, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    clearRect() {}, putImageData() {}, drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  const ownerDocument = { createElement: () => ({ width: 300, height: 150, getContext: () => context }) };
  return { width: 900, height: 288, ownerDocument, getContext: () => context, addEventListener() {}, removeEventListener() {} };
};
const rendererFor = world => new ProcgenLaneRenderer({ canvas: canvasFixture(), world, assets: {}, windowRef: { devicePixelRatio: 1, performance } });

describe('complete supported procgen source assemblies', function() {
  this.timeout(30000);
  let masks;
  before(async () => { masks = await loadProcgenMasks(); });
  it('retains all nine source catalogs while excluding complete entrance and exit groups from generation', async () => {
    let exits = 0, entrances = 0;
    for (const [pack, count] of [['lemmings', 5], ['lemmings_ohNo', 4]]) for (let set = 0; set < count; set++) {
      const terrain = await loadProcgenTerrain(pack, set), source = JSON.stringify(terrain.assemblyCatalog);
      const original = compileAuthoredAssemblies(terrain.assemblyCatalog, terrain.pieces, terrain.objects);
      const excluded = new Set(original.filter(group => group.objects.some(member => member.id === 1 || member.image.trigger_effect_id === Types.EXIT_LEVEL)).map(group => group.entry.id));
      exits += original.filter(group => group.objects.some(member => member.image.trigger_effect_id === Types.EXIT_LEVEL)).length;
      entrances += original.filter(group => group.objects.some(member => member.id === 1)).length;
      expect(terrain.compiledAssemblies.map(group => group.entry.id)).to.deep.equal(original.map(group => group.entry.id));
      expect([...terrain.assemblySources.keys()].every(id => !excluded.has(id))).to.equal(true);
      expect(terrain.eligibleObjectIds.has(1)).to.equal(false);
      expect(terrain.objects.filter(piece => piece.image.trigger_effect_id === Types.EXIT_LEVEL).every(piece => !terrain.eligibleObjectIds.has(piece.id))).to.equal(true);
      for (let chunk = 2; chunk < 34; chunk++) {
        const descriptor = terrain.describe(42, chunk);
        expect(descriptor.objects.every(object => object.piece.id !== 1 && object.piece.image.trigger_effect_id !== Types.EXIT_LEVEL && !excluded.has(object.assembly?.id))).to.equal(true);
        expect(descriptor.placements.every(placement => !excluded.has(placement.assembly?.id))).to.equal(true);
      }
      expect(JSON.stringify(terrain.assemblyCatalog)).to.equal(source);
    }
    expect(exits).to.be.greaterThan(0); expect(entrances).to.be.greaterThan(0);
  });
  it('replays the actual bubble head/body transform together and suppresses standalone components', async () => {
    const terrain = await loadProcgenTerrain('lemmings_ohNo', 3);
    expect([...terrain.associatedObjectIds]).to.deep.equal([8, 10]);
    expect(terrain.assemblyCatalog.objectSha256).to.match(/^[a-f0-9]{64}$/);
    let pair = null, pairs = 0;
    for (let chunk = 2; chunk < 66; chunk++) {
      const descriptor = terrain.describe(42, chunk);
      for (const object of descriptor.objects) if ([8, 10].includes(object.piece.id)) expect(object.assembly).to.exist;
      for (const assembly of descriptor.assemblies) {
        const objects = descriptor.objects.filter(object => object.assembly === assembly), head = objects.find(o => o.piece.id === 8), body = objects.find(o => o.piece.id === 10);
        if (head || body) {
          expect(head).to.exist; expect(body).to.exist; expect(head.x - body.x).to.equal(32); expect(head.y - body.y).to.equal(-20);
          pair ||= { chunk, descriptor, assembly, head, body }; pairs++;
        }
      }
      expect(descriptor.objects.every(object => object.assembly || ['trap', 'hazard', 'liquid'].includes(object.role))).to.equal(true);
      expect(descriptor.placements.every(p => p.assembly || p.canonicalGroup || p.letter)).to.equal(true);
    }
    expect(pairs).to.be.greaterThan(0);
    const { chunk, descriptor, assembly, head } = pair, rendered = terrain.getChunk(42, chunk, true);
    for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
      expect(terrain.solidSample(42, chunk, x, y, descriptor)).to.equal(!!(rendered.solid[(y * 128 + x) >>> 5] & (1 << ((y * 128 + x) & 31))));
      expect(terrain.rasterSample(42, chunk, x, y, descriptor)).to.equal(rendered.pixels[y * 128 + x]);
    }
    for (const contact of [...assembly.contacts, ...assembly.foundationSupports]) expect(terrain.solidSample(42, chunk, contact.x - chunk * 128, contact.y, descriptor)).to.equal(true);
    terrain.supportsFineGrowth = false; // Prepared assembly contacts are isolated from the separately tested job scheduler.
    const world = new ProcgenLaneWorld({ masks, terrain, seed: 42, assists: false }); world.laneSeeds[0] = 42;
    world.generatedThrough[0] = (chunk + 1) * 128;
    expect(assemblyPlacementReady(world, 0, head, descriptor)).to.equal(true);
    const renderer = rendererFor(world); renderer.follow = false; renderer.cameraX = assembly.bounds.x1 - 24; renderer.render();
    const imageIds = () => renderer.objectPlacements.filter(p => [8, 10].some(id => p.image === procgenObjectImage(descriptor.objects.find(o => o.piece.id === id))));
    expect(imageIds()).to.have.length(2);
    const generated = terrain.stats.generated; world.tickIndex += 4; renderer.render(); expect(terrain.stats.generated).to.equal(generated);
    world.generatedThrough[0] = assembly.bounds.x2 - 1; world.frontierRevision++; renderer.render(); expect(imageIds()).to.have.length(0);
    world.generatedThrough[0] = (chunk + 1) * 128; world.frontierRevision++; renderer.render(); expect(imageIds()).to.have.length(2);
    const contact = assembly.contacts[0]; world._setPixel(contact.x, contact.y, 0); renderer.render(); expect(imageIds()).to.have.length(0);
    expect(assemblyPlacementReady(world, 0, head, descriptor)).to.equal(false);
    renderer.dispose(); world.dispose();
  });
  it('mirrors source frames, trigger bounds and the real MapObject together without altering authored art', async () => {
    const terrain = await loadProcgenTerrain('lemmings', 0), piece = terrain.objects.find(p => p.id === 6), source = piece.image;
    const frame = source.frames[0].slice(), originalLeft = source.trigger_left, originalTop = source.trigger_top;
    terrain.objects = [piece]; terrain.compiledAssemblies = [];
    terrain.supportsFineGrowth = false;
    const world = new ProcgenLaneWorld({ masks, terrain, assists: false, seed: 42 });
    let chunk, descriptor, original;
    for (chunk = 2; chunk < 48; chunk++) { descriptor = terrain.describe(world.laneSeeds[0], chunk); original = descriptor.objects[0]; if (original) break; }
    expect(original).to.exist;
    const object = { ...original, flip: true, flipY: true }, oriented = procgenObjectImage(object);
    descriptor.objects[0] = object; world.generatedThrough[0] = (chunk + 1) * 128;
    expect(procgenObjectImage(object)).to.equal(oriented);
    expect(oriented.trigger_left).to.equal(source.width - originalLeft - source.trigger_width);
    expect(oriented.trigger_top).to.equal(source.height - originalTop - source.trigger_height);
    expect(oriented.frames[0][0]).to.equal(frame[frame.length - 1]); expect(oriented.frames[0][frame.length - 1]).to.equal(frame[0]);
    const x = object.x + oriented.trigger_left, y = object.y + oriented.trigger_top;
    expect(world.hazards.trigger(x, y, world.actors[0], world.tickIndex)).to.equal(Types.TRAP);
    const entry = world.hazards.peek(0, chunk, 0);
    expect(entry.owner.animation.objectImg).to.equal(oriented);
    expect(entry.trigger).to.include({ x1: x, y1: y, x2: x + oriented.trigger_width, y2: y + oriented.trigger_height });
    const owned = world.hazards.getFrame(entry, world.tickIndex), index = oriented.frames[0].findIndex(ci => !(ci & 128));
    expect(owned.getMask()[index]).to.equal(1); expect(owned.getBuffer()[index]).to.equal((source.palette.getColor(oriented.frames[0][index]) | 0xff000000) >>> 0);
    const renderer = rendererFor(world); renderer.follow = false; renderer.cameraX = object.x - 24; renderer.render(); expect(renderer.frames.has(owned)).to.equal(true);
    expect(source.frames[0]).to.deep.equal(frame); expect(source.trigger_left).to.equal(originalLeft); expect(source.trigger_top).to.equal(originalTop);
    renderer.dispose(); world.dispose();
  });
  it('quarantines associated terrain from every standalone route/group/ingredient while retaining its source catalogue', async () => {
    const original = await loadProcgenTerrain('lemmings_ohNo', 3), ids = [...new Set(original.routes.flatMap(route => route.placements.map(p => p.id)))];
    const id = ids.find(id => original.routes.some(route => route.placements.every(p => p.id !== id))), catalog = structuredClone(original.assemblyCatalog);
    catalog.associatedTerrainIds = [id];
    const use = catalog.assetUsage.find(use => use.kind === 'terrain' && use.id === id);
    Object.assign(use, { linkedUses: use.sourceUses, intrinsicUses: use.sourceUses, attachmentUseShare: 1, intrinsicUseShare: 1, stableTransforms: 1, associated: true });
    const terrain = new ProcgenRecipeTerrain({ recipe: original.recipe, terrainPieces: original.pieces, objectPieces: original.objects,
      sourceDescriptor: original.sourceDescriptor, assemblyCatalog: catalog });
    expect(terrain.pieces.some(p => p.id === id)).to.equal(true); expect(terrain.ingredients.some(p => p.id === id)).to.equal(false);
    expect(terrain.routes.every(route => route.placements.every(p => p.id !== id))).to.equal(true);
    expect([...terrain.sourceGroups.keys()].every(group => group.placements.every(p => p.id !== id))).to.equal(true);
    for (let chunk = 0; chunk < 64; chunk++) {
      const d = terrain.describe(42, chunk);
      expect(d.placements.every(p => p.assembly || p.piece.id !== id && (!p.canonicalGroup || p.canonicalGroup.placements.every(p => p.id !== id)))).to.equal(true);
      expect(d.objects.every(o => o.assembly || !terrain.associatedObjectIds.has(o.piece.id))).to.equal(true);
    }
  });
});
