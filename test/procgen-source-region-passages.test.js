import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { expect } from 'chai';
import { classifySourceRegionPassages, MAX_PASSAGE_PORTS, MAX_PASSAGE_VOIDS } from '../js/app/procgen/ProcgenSourceRegionPassages.js';
import { loadProcgenTerrain } from '../scripts/bench-procgen-lanes.js';
import { placeSourceRegion } from '../js/app/procgen/ProcgenSourceRegions.js';
import { terrainStampAt, compileTerrainGroup } from '../js/app/procgen/ProcgenTerrainCompositing.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { LevelReader } from '../js/level/LevelReader.js';
import { SolidLayer } from '../js/render/SolidLayer.js';
import { Lemming } from '../js/lemmings/Lemming.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';
import { ActionJumpSystem } from '../js/actions/ActionJumpSystem.js';
import { ActionFallSystem } from '../js/actions/ActionFallSystem.js';

const voidBounds = { x1: 754, x2: 786, y1: 96, y2: 128, purpose: 'source-underpass' };
const ports = [{ x: 754, y: 128, direction: 1 }, { x: 785, y: 128, direction: -1 }];

describe('bounded actual source passage classifications', function() {
  this.timeout(30000); let terrain, native, source, ground, flat;
  before(async () => {
    terrain = await loadProcgenTerrain('lemmings', 2);
    native = new LevelReader(new FileContainer(new BinaryReader(await fs.readFile('lemmings/LEVEL007.DAT'))).getPart(4));
    const placements = native.terrains.map(placement => ({ id: placement.id, x: placement.x, y: placement.y,
      f: (placement.drawProperties.isUpsideDown ? 2 : 0) | (placement.drawProperties.noOverwrite ? 4 : 0) | (placement.drawProperties.isErase ? 1 : 0) }));
    source = compileTerrainGroup({ placements }, new Map(terrain.pieces.map(piece => [piece.id, piece])), native.levelWidth, native.levelHeight);
    ground = new SolidLayer(native.levelWidth, native.levelHeight, Uint8Array.from(source.frame, pixel => !(pixel & 128)));
  });
  it('classifies the existing generated complete overhang wall and right opening without altering its ports or geometry', () => {
    const atom = terrain.sourceRegions.find(group => group.entry.id === 'lemmings/2/a0c2b0ac0a99a380');
    const result = placeSourceRegion({ library: [atom], seed: 42, firstChunk: 8, code: 25, height: 144, occupied: [],
      surface: () => 120, solid: (x, y) => y >= 120, steel: () => false });
    flat = result;
    const { region } = result, classification = region.passages;
    expect(region.ports.every(port => port.qualified === false)).to.equal(true);
    expect(classification.ports.map(port => port.role)).to.deep.equal(['source-wall', 'opening-candidate']);
    expect(classification.cavities[0]).to.include({ purpose: 'return-corridor-candidate', supportedColumns: 32, clearColumns: 32, qualified: false });
    expect(classification.cavities[0].entry.x).to.equal(1152); expect(classification.cavities[0].returnPort).to.equal(classification.cavities[0].entry);
    expect(Object.isFrozen(classification)).to.equal(true); expect(classification.crewStatus).to.equal('unqualified');
    expect(region.sourcePlacements).to.have.length(5); expect(region.bounds).to.deep.equal({ x1: 1057, x2: 1153, y1: 56, y2: 120 });
  });
  it('does not invent an open authored corridor where the complete native source contains neighbouring body blocks', () => {
    expect(native.levelProperties.levelName.trim()).to.equal('Just a Minute...'); expect(native.graphicSet1).to.equal(2);
    expect(native.steel).to.deep.equal([]);
    expect([3, 4, 5, 6, 17, 18, 19].map(index => [native.terrains[index].id, native.terrains[index].x, native.terrains[index].y])).to.deep.equal([
      [39, 754, 96], [39, 754, 128], [39, 722, 128], [39, 722, 96], [39, 722, 64], [39, 754, 64], [39, 786, 64]
    ]);
    const solid = ground.hasGroundAt.bind(ground), classification = classifySourceRegionPassages({ ports, protectedVoids: [voidBounds], height: native.levelHeight, solid, sourceSolid: solid });
    expect(classification.ports.map(port => port.role)).to.deep.equal(['blocked-standing', 'blocked-standing']);
    expect(classification.cavities[0]).to.include({ purpose: 'unresolved-source-cavity', clearColumns: 0 });
  });
  it('separately returns eight ordinary actors through the controlled complete source atom on an unchanged actual motif foundation', () => {
    terrain.configure(1, 8, { laneHeight: 144 });
    const seed = 90, chunk = 12, descriptors = [terrain._describeSingle(seed, chunk, true), terrain._describeSingle(seed, chunk + 1, true)];
    const base = (x, y) => x >= 0 && x < 256 && terrain.solidSample(seed, chunk + Math.floor(x / 128), x % 128, y, descriptors[Math.floor(x / 128)]);
    const surface = x => terrain._surface(seed, chunk + Math.floor(x / 128), x % 128, descriptors[Math.floor(x / 128)]);
    const atom = terrain.sourceRegions.find(group => group.entry.id === 'lemmings/2/a0c2b0ac0a99a380');
    const result = placeSourceRegion({ library: [atom], seed, firstChunk: chunk, code: 25, height: 144, surface, solid: base, steel: () => false,
      occupied: descriptors.flatMap((descriptor, part) => descriptor.placements.map(placement => ({ ...placement, x: placement.x + part * 128 }))) });
    expect(result.region.bounds).to.deep.equal({ x1: 1569, x2: 1665, y1: 43, y2: 107 });
    expect(result.region.source).to.deep.equal({ level: 'lemmings/LEVEL007.DAT#4', terrainIndices: [7, 10, 15, 16, 17] });
    const sample = (x, y) => { const operation = terrainStampAt(result.placement, x, y, base(x, y)) & 3; return operation ? operation !== 1 : base(x, y); };
    const mask = new SolidLayer(256, 144, Uint8Array.from({ length: 256 * 144 }, (_, at) => sample(at % 256, Math.floor(at / 256))));
    const before = mask.mask.slice(), actions = { [State.WALKING]: new ActionWalkSystem(), [State.JUMPING]: new ActionJumpSystem(), [State.FALLING]: new ActionFallSystem() };
    const level = { width: 256, height: 144, getGroundMaskLayer: () => mask, hasGroundAt: mask.hasGroundAt.bind(mask) };
    const actors = Array.from({ length: 8 }, (_, index) => { const actor = new Lemming(132 + index, 120, index); actor.lookRight = false; actor.setAction(actions[State.WALKING]); return actor; });
    const turns = new Map(); let tick = 0;
    while (tick < 128 && !actors.every(actor => actor.lookRight && actor.x >= 139)) {
      tick++;
      for (const actor of actors) {
        const direction = actor.lookRight, state = actor.process(level);
        if (state !== State.NO_STATE_TYPE) { expect(actions[state]).to.exist; actor.setAction(actions[state]); }
        if (actor.lookRight !== direction) turns.set(actor.id, { tick, x: actor.x + 1536, y: actor.y });
      }
    }
    expect(tick).to.equal(101); expect(turns.size).to.equal(8);
    expect([...turns.values()].every(turn => turn.x === 1625 && turn.y === 108)).to.equal(true);
    expect(actors.every(actor => actor.x >= 139 && actor.lookRight && actor.y === 120 && actor.action === actions[State.WALKING] && !actor.canClimb && !actor.hasParachute && !actor.removed)).to.equal(true);
    expect(mask.mask).to.deep.equal(before);
    // The forced bounded atom selection and controlled placement are capability
    // evidence, not unaided arrival or a general source-port certification.
    expect(result.region.passages.cavities[0].purpose).to.equal('unresolved-source-cavity');
    expect(result.region.passages.crewStatus).to.equal('unqualified');
  });
  it('keeps uneven support, surrounding terrain lips, unsafe edges and invalid bounded samples distinct from opening candidates', () => {
    const sample = (x, y) => { const operation = terrainStampAt(flat.placement, x - 1024, y, y >= 120) & 3; return operation ? operation !== 1 : y >= 120; };
    const sourceSolid = (x, y) => (terrainStampAt(flat.placement, x - 1024, y, y >= 120) & 3) >= 2;
    const inspect = extra => classifySourceRegionPassages({ ports: flat.region.ports, protectedVoids: flat.region.protectedVoids, height: 144, solid: sample, sourceSolid, ...extra });
    const missing = inspect({ solid: (x, y) => !(x === 1137 && y === 120) && sample(x, y) });
    expect(missing.cavities[0]).to.include({ purpose: 'unresolved-source-cavity', supportedColumns: 31 });
    const lip = inspect({ solid: (x, y) => x >= 1153 && y >= 112 || sample(x, y) }); expect(lip.ports[1].role).to.equal('existing-wall');
    const edge = inspect({ solid: (x, y) => x < 1153 && sample(x, y) }); expect(edge.ports[1].role).to.equal('unsupported-edge');
    const step = inspect({ solid: (x, y) => x === 1153 && y >= 117 || sample(x, y) }); expect(step.ports[1].role).to.equal('step-candidate');
    const blocked = inspect({ solid: (x, y) => x === 1152 && y >= 112 || sample(x, y) }); expect(blocked.ports[1].role).to.equal('blocked-standing');
    const absent = inspect({ solid: (x, y) => !(x === 1152 && y === 120) && sample(x, y) }); expect(absent.ports[1].role).to.equal('missing-support');
    const invalid = inspect({ ports: [{ x: 1152, y: 2, direction: -1 }] }); expect(invalid.ports[0].role).to.equal('out-of-bounds');
    const bounded = inspect({ ports: Array(32).fill(flat.region.ports[0]), protectedVoids: Array(32).fill(flat.region.protectedVoids[0]) });
    expect(bounded.ports).to.have.length(MAX_PASSAGE_PORTS); expect(bounded.cavities).to.have.length(MAX_PASSAGE_VOIDS);
    expect(inspect({ protectedVoids: [{ ...flat.region.protectedVoids[0], x2: 1400 }] }).cavities[0].supportedColumns).to.equal(0);
  });
});
