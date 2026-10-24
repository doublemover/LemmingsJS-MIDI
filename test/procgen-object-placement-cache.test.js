import { expect } from 'chai';
import { ProcgenObjectPlacementCache } from '../js/app/procgen/ProcgenObjectPlacementCache.js';

const fixture = (options = {}) => {
  const image = { width: 4, height: 2, frames: [new Uint8Array(8).fill(1)], palette: { getColor: () => 0xffabcdef } };
  const object = { x: 126, y: 2, phase: 0, role: 'ambient', animation: 'loop', clipToTerrain: true, piece: { image } };
  const descriptor = { objects: [object] }, tiles = new Map([[0, descriptor]]), revisions = new Map(), reservations = new Map(), samples = [];
  const world = { generation: 1, laneHeight: 96, laneCount: 1, leftEdgeX: 0, generatedThrough: [10000], laneSeeds: [1], terrainTileRevisions: revisions,
    editChunks: new Map(), _editKey: (x, y) => `${Math.floor(x / 32)}:${Math.floor(y / 96)}`,
    terrain: { chunkWidth: 128, describe: (seed, chunk) => tiles.get(chunk) || { objects: [] },
      solidSample(seed, chunk, x, y) { samples.push({ chunk, x, y }); return x >= 0 && x < 128; } } };
  const resources = { retain: (key, bytes) => reservations.set(key, bytes), release: key => reservations.delete(key) };
  const cache = new ProcgenObjectPlacementCache(world, resources, options);
  return { cache, world, descriptor, object, image, samples, reservations, revisions };
};

describe('local ProcGen object placement geometry', () => {
  it('retains geometry and clips through distant edits, camera redraws and hazard phase changes', () => {
    const { cache, world, descriptor, samples, revisions } = fixture();
    const first = cache.get(0, 0, descriptor), sampled = samples.length;
    revisions.set(9, 1); world.terrainRevision = 1; world.hazards = { revision: 17 };
    expect(cache.get(0, 0, descriptor)).to.equal(first);
    expect(cache.get(0, 0, descriptor)[0].clip).to.equal(first[0].clip); expect(samples.length).to.equal(sampled);
    expect(cache.getStats()).to.include({ hits: 2, placementRebuilds: 1, clipPixelsSampled: 8 }); cache.dispose();
  });

  it('samples a cross-chunk mask against both canonical tiles and invalidates only participating dependencies', () => {
    const { cache, world, descriptor, samples, revisions } = fixture();
    const first = cache.get(0, 0, descriptor);
    expect(Array.from(first[0].clip)).to.deep.equal(new Array(8).fill(1));
    expect(new Set(samples.map(sample => sample.chunk))).to.deep.equal(new Set([0, 1]));
    const patch = new Uint8Array(32 * 96); patch[2 * 32] = 1; world.editChunks.set(world._editKey(128, 2), patch); revisions.set(1, 1);
    const second = cache.get(0, 0, descriptor);
    expect(second).not.to.equal(first); expect(second[0].clip[2]).to.equal(0); expect(second[0].clip[0]).to.equal(1);
    expect(cache.getStats().placementRebuilds).to.equal(2); cache.dispose();
  });

  it('recognizes added terrain, source asset replacement, reveal progress and same-tick generations', () => {
    const { cache, world, descriptor, object, revisions } = fixture();
    world.generatedThrough[0] = 129; expect(cache.get(0, 0, descriptor)).to.have.length(0);
    world.generatedThrough[0] = 130; const first = cache.get(0, 0, descriptor);
    expect(first).to.have.length(1);
    object.piece = { image: { ...object.piece.image } };
    expect(cache.get(0, 0, descriptor)[0].image).to.equal(object.piece.image);
    const patch = new Uint8Array(32 * 96); patch[2 * 32] = 3; world.editChunks.set(world._editKey(128, 2), patch); revisions.set(1, 1);
    expect(cache.get(0, 0, descriptor)[0].clip[2]).to.equal(1);
    world.generation++; const restored = cache.get(0, 0, descriptor);
    expect(restored).not.to.equal(first); expect(cache.getStats().tiles).to.equal(1); cache.dispose();
  });

  it('bounds tile and mask residency during a long scroll and retires retained byte reservations', () => {
    const { cache, world, object, reservations } = fixture({ maxTiles: 2, maxClipBytes: 16 });
    for (let chunk = 0; chunk < 50; chunk++) {
      const descriptor = { objects: [{ ...object, x: chunk * 128 + 8 }] };
      cache.get(0, chunk, descriptor);
      expect(cache.getStats().tiles).to.be.at.most(2); expect(cache.getStats().clipBytes).to.be.at.most(16);
      expect(reservations.size).to.be.at.most(2);
    }
    expect(cache.getStats().evictions).to.be.greaterThan(0); cache.dispose(); expect(reservations.size).to.equal(0);
  });
});
