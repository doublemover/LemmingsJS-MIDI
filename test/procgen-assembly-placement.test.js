import { expect } from 'chai';
import { placeAuthoredAssemblies, assemblyPlacementReady } from '../js/app/procgen/ProcgenAssemblyPlacement.js';
import { TriggerTypes as Types } from '../js/level/TriggerTypes.js';
const piece = (id, width, height, object = false) => { const frame = new Uint8Array(width * height); return { id, width, height, frame,
  image: { width, height, frames: [frame], trigger_effect_id: Types.NO_TRIGGER, animationLoop: !object } }; };
const member = (p, kind, x, y) => ({ id: p.id, piece: p, image: p.image, pixels: p.frame, kind, x, y, orientation: { flipX: false, flipY: false } });
const fixture = () => {
  const pole = piece(1, 2, 12), floor = piece(2, 10, 4), flag = piece(10, 6, 6, true);
  const members = [member(pole, 'terrain', 3, 4), member(flag, 'object', 4, 0)];
  const anchor = { confidence: 0.9, anchorX: 4, anchorY: 16, anchor: member(floor, 'terrain', 0, 16) };
  const group = { entry: { id: 'sourced-flag-pole', placements: members, relations: [{ a: 0, b: 1, x: 4, y: 4, anchorX: 4, anchorY: 4 }] },
    members, terrain: [members[0]], objects: [members[1]], supportAnchors: [anchor], sourceRevision: 'source-revision' };
  const args = { compiled: [group], chunk: 3, code: 0, baseSurface: () => 72, baseSolid: (_x, y) => y >= 72 };
  return { args, group, floor, pole, flag };
};
describe('bounded authored attachment placement', () => {
  it('replays flag, pole and evidenced base together with exact relative offsets and separate object collision', () => {
    const { args } = fixture(), result = placeAuthoredAssemblies(args);
    expect(result.assemblies).to.have.length(1); expect(result.terrainPlacements).to.have.length(2); expect(result.objects).to.have.length(1);
    const pole = result.terrainPlacements[0], flag = result.objects[0];
    expect(flag.x - 384 - pole.x).to.equal(1); expect(flag.y - pole.y).to.equal(-4);
    expect(flag.assembly).to.equal(pole.assembly); expect(flag.supportY).to.equal(null);
    expect(result.assemblies[0].foundationSupports.every(p => p.y === 72)).to.equal(true);
  });
  it('rejects an ambiguous anchor, gap support, partial group overlap, and unanchored sky placement', () => {
    const { args, group } = fixture(); group.supportAnchors[0].confidence = 0.55;
    expect(placeAuthoredAssemblies(args).objects).to.have.length(0); group.supportAnchors[0].confidence = 0.9;
    expect(placeAuthoredAssemblies({ ...args, baseSolid: () => false }).objects).to.have.length(0);
    expect(placeAuthoredAssemblies({ ...args, gapX: 10, gapWidth: 10 }).objects).to.have.length(0);
    expect(placeAuthoredAssemblies({ ...args, occupied: [{ piece: piece(20, 10, 20), x: 8, y: 50 }] }).objects).to.have.length(0);
    group.supportAnchors = []; expect(placeAuthoredAssemblies(args).objects).to.have.length(0);
  });
  it('tries another evidenced support variant when the first is not constructible', () => {
    const { args, group } = fixture(), valid = group.supportAnchors[0];
    group.supportAnchors = [{ ...valid, anchor: { ...valid.anchor, y: -60 } }, valid];
    expect(placeAuthoredAssemblies(args).assemblies).to.have.length(1);
  });
  it('attaches hanging artwork to a matched real ceiling support and never snaps it to the floor', () => {
    const { args, group, floor } = fixture();
    group.supportAnchors[0].anchor.y = -4; group.supportAnchors[0].anchorY = -1;
    const occupied = [{ piece: floor, x: 8, y: 20, flip: false, flipY: false, decor: false }];
    const ground = (x, y) => y >= 72 || x === 7 && y >= 20 || x >= 8 && x < 18 && y >= 20 && y < 24;
    const result = placeAuthoredAssemblies({ ...args, occupied, baseSolid: ground });
    expect(result.objects).to.have.length(1); expect(result.objects[0].y).to.equal(24);
    expect(result.terrainPlacements).to.have.length(1); expect(result.assemblies[0].foundationSupports.every(p => p.x === 391)).to.equal(true);
  });
  it('preserves source flips and protects the complete lethal art/trigger envelope from the intro', () => {
    const { args, group, flag } = fixture(); group.members[0].orientation.flipY = true; group.members[1].orientation.flipX = true;
    expect(placeAuthoredAssemblies(args).terrainPlacements[0].flipY).to.equal(true);
    expect(placeAuthoredAssemblies(args).objects[0].flip).to.equal(true);
    Object.assign(flag.image, { trigger_effect_id: Types.TRAP, trigger_left: -20, trigger_top: 0, trigger_width: 120, trigger_height: 6 });
    expect(placeAuthoredAssemblies({ ...args, chunk: 1 }).objects).to.have.length(0);
    expect(placeAuthoredAssemblies(args).objects).to.have.length(0);
  });
  it('gates the complete group on reveal and actual edited contacts without composing collision chunks', () => {
    const { args } = fixture(), result = placeAuthoredAssemblies(args), object = result.objects[0], edits = new Map(); let probes = 0;
    const world = { laneCount: 1, laneSeeds: [1], generation: 1, leftEdgeX: 8, generatedThrough: [1024], terrainTileRevisions: new Map(), editChunks: edits,
      _editKey: (x, y) => Math.floor(y / 96) * 0x2000000 + Math.floor(x / 32), terrain: { chunkWidth: 128, solidSample: (_seed, _chunk, x, y) => {
        probes++; if (y >= 72) return true;
        return result.terrainPlacements.some(p => x >= p.x && x < p.x + p.piece.width && y >= p.y && y < p.y + p.piece.height);
      } } };
    expect(assemblyPlacementReady(world, 0, object, {})).to.equal(true); const first = probes;
    expect(assemblyPlacementReady(world, 0, object, {})).to.equal(true); expect(probes).to.equal(first);
    world.generatedThrough[0] = object.assembly.bounds.x2 - 1; expect(assemblyPlacementReady(world, 0, object, {})).to.equal(false);
    world.generatedThrough[0] = 1024;
    const contact = object.assembly.contacts[0], mask = new Uint8Array(32 * 96); mask[contact.y * 32 + contact.x % 32] = 1;
    edits.set(world._editKey(contact.x, contact.y), mask); world.terrainTileRevisions.set(3, 1);
    expect(assemblyPlacementReady(world, 0, object, {})).to.equal(false);
  });
});
