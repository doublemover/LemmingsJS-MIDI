import { expect } from 'chai';
import { ProcgenObjectPlacementCache } from '../js/app/procgen/ProcgenObjectPlacementCache.js';
import { ProcgenTerrainRevisions } from '../js/app/procgen/ProcgenTerrainRetention.js';

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
  it('validates dependencies and assembly supports without touching physical revision retention', () => {
    const { cache, world, descriptor, object } = fixture(), revisions = new ProcgenTerrainRevisions(1, 128);
    revisions.set(1, 9); revisions.set(0, 4); world.terrainTileRevisions = revisions;
    world.peekTerrainTileRevision = key => revisions.peek(key);
    world.getTerrainTileRevision = () => { throw new Error('Rendering cannot retain physical terrain revisions.'); };
    object.assembly = { chunk: 0, bounds: { x1: 0, x2: 4, y1: 0, y2: 4 }, contacts: [{ x: 1, y: 1 }], foundationSupports: [{ x: 1, y: 2 }] };
    const order = [...revisions], first = cache.get(0, 0, descriptor);
    expect(first).to.have.length(1); expect(cache.get(0, 0, descriptor)).to.equal(first); expect([...revisions]).to.deep.equal(order);
    revisions.set(0, 5);
    expect(cache.get(0, 0, descriptor)).not.to.equal(first); expect(cache.getStats().placementRebuilds).to.equal(2);
    cache.dispose();
  });
  it('rejects aggregate masks before any clip allocation sampling or reservation', () => {
    const { cache, descriptor, object, samples, reservations } = fixture({ maxClipBytes: 12 });
    descriptor.objects.push({ ...object, x: 140 });
    expect(() => cache.get(0, 0, descriptor)).to.throw('Aggregate'); expect(samples).to.have.length(0); expect(reservations.size).to.equal(0);
    expect(cache.getStats().clipBytes).to.equal(0); cache.dispose();
  });
  it('reserves the whole candidate before sampling and retires it after a sampling exception', () => {
    const { cache, world, descriptor, reservations } = fixture(); let calls = 0;
    world.terrain.solidSample = () => { calls++; expect([...reservations.values()]).to.deep.equal([8]); throw new Error('sample failure'); };
    expect(() => cache.get(0, 0, descriptor)).to.throw('sample failure'); expect(calls).to.equal(1); expect(reservations.size).to.equal(0); cache.dispose();
  });
  it('admits exactly the aggregate limit and refuses limit plus one before allocating masks', () => {
    const { cache, descriptor, object, samples, reservations } = fixture({ maxClipBytes: 16 }); descriptor.objects.push({ ...object, x: 140 });
    expect(cache.get(0, 0, descriptor)).to.have.length(2); expect(cache.getStats()).to.include({ clipBytes: 16, peakClipBytes: 16, maskAllocations: 2, stagedClipBytes: 0 });
    const calls = samples.length, masks = cache.getStats().maskAllocations;
    descriptor.objects.push({ ...object, x: 150, piece: { image: { ...object.piece.image, width: 1, height: 1, frames: [new Uint8Array([1])] } } });
    expect(() => cache.get(0, 0, descriptor)).to.throw('Aggregate'); expect(samples.length).to.equal(calls); expect(cache.getStats().maskAllocations).to.equal(masks);
    expect([...reservations.values()]).to.deep.equal([16]); cache.dispose();
  });
  it('preserves the prior entry and bitmap ownership after replacement sampling or admission failure', () => {
    const { cache, world, descriptor, reservations, revisions } = fixture({ maxClipBytes: 16 }), first = cache.get(0, 0, descriptor), entry = cache.tiles.get(0);
    const bitmap = {}; first[0].clippedFrames.set(0, bitmap); reservations.set(bitmap, 100);
    revisions.set(0, 1); const sample = world.terrain.solidSample; world.terrain.solidSample = () => { expect(cache.getStats()).to.include({ clipBytes: 8, stagedClipBytes: 8, peakClipBytes: 16 }); throw new Error('replacement sample failed'); };
    expect(() => cache.get(0, 0, descriptor)).to.throw('replacement sample failed');
    expect(cache.tiles.get(0)).to.equal(entry); expect(reservations.get(entry)).to.equal(8); expect(reservations.get(bitmap)).to.equal(100); expect(reservations.size).to.equal(2);
    world.terrain.solidSample = sample; const retain = cache.resources.retain;
    cache.resources.retain = (key, bytes) => { if (key !== entry) throw new Error('shared budget refusal'); retain(key, bytes); };
    expect(() => cache.get(0, 0, descriptor)).to.throw('shared budget refusal'); expect(cache.tiles.get(0)).to.equal(entry);
    cache.resources.retain = retain; const second = cache.get(0, 0, descriptor);
    expect(second).not.to.equal(first); expect(reservations.has(entry)).to.equal(false); expect(reservations.has(bitmap)).to.equal(false);
    expect(cache.getStats()).to.include({ clipBytes: 8, stagedClipBytes: 0, peakClipBytes: 16 }); cache.dispose(); expect(reservations.size).to.equal(0);
  });
  it('includes retained masks in peak admission and keeps them intact when a candidate cannot fit', () => {
    const { cache, descriptor, revisions, samples, reservations } = fixture({ maxClipBytes: 8 }); const first = cache.get(0, 0, descriptor), calls = samples.length;
    revisions.set(0, 1); expect(() => cache.get(0, 0, descriptor)).to.throw('retained plus candidate');
    expect(cache.tiles.get(0).placements).to.equal(first); expect(samples.length).to.equal(calls); expect([...reservations.values()]).to.deep.equal([8]);
    expect(cache.getStats()).to.include({ clipBytes: 8, stagedClipBytes: 0, peakClipBytes: 8 }); cache.dispose();
  });
  it('retires invisible candidate masks after accounting their allocation peak', () => {
    const { cache, world, descriptor, reservations } = fixture({ maxClipBytes: 8 }); world.terrain.solidSample = () => false;
    expect(cache.get(0, 0, descriptor)).to.deep.equal([]); expect(cache.getStats()).to.include({ clipBytes: 0, stagedClipBytes: 0, peakClipBytes: 8, maskAllocations: 1 });
    expect([...reservations.values()]).to.deep.equal([0]); cache.dispose(); expect(reservations.size).to.equal(0);
  });

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
