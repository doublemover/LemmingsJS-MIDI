import { expect } from 'chai';
import { createOldVegasPack, CHIP_DENOMINATIONS, SUITS } from '../js/decorations/OldVegasPack.js';
import { getDecorationPack, decorationPlacements } from '../js/decorations/ProcgenDecorationPacks.js';
import { DecorationLayer } from '../js/decorations/DecorationLayer.js';
import { readProcgenUrlConfig, createProcgenShareUrl } from '../js/app/procgen/ProcgenUrlConfig.js';

describe('Old Vegas runtime decoration pack', () => {
  it('shares a bounded indexed catalog with unique IDs and genuine animation', () => {
    const pack = createOldVegasPack(); expect(createOldVegasPack()).to.equal(pack);
    expect(pack.pieces.length).to.equal(44); expect(new Set(pack.pieces.map(p => p.id)).size).to.equal(44);
    let bytes = 0;
    for (const piece of pack.pieces) {
      expect(piece.interactive).to.equal(false); expect(piece.image.frames.length).to.equal(16);
      const hashes = new Set();
      for (const frame of piece.image.frames) {
        bytes += frame.byteLength; expect(frame.length).to.equal(piece.width * piece.height);
        expect([...frame].every(value => value === 128 || value < pack.palette.length)).to.equal(true);
        hashes.add(Buffer.from(frame).toString('base64'));
      }
      expect(hashes.size, piece.id).to.be.greaterThan(1);
    }
    expect(bytes).to.be.lessThan(2 * 1024 * 1024);
  });
  it('uses clear symmetric suit stencils and a documented eight-denomination chip set in both views', () => {
    const pack = createOldVegasPack();
    for (const rows of Object.values(SUITS)) for (const row of rows) expect(row).to.equal([...row].reverse().join(''));
    expect(CHIP_DENOMINATIONS.map(d => d.value)).to.deep.equal([1, 5, 25, 100, 500, 1000, 5000, 25000]);
    for (const d of CHIP_DENOMINATIONS) for (const view of ['side', 'face']) expect(pack.pieces.some(p => p.id === `chips-${view}-${d.value}`)).to.equal(true);
    const cards = pack.pieces.filter(p => p.id.startsWith('card-'));
    expect(cards.length).to.equal(8); expect(cards.every(p => p.height === 50)).to.equal(true);
  });
  it('scrolls symbols vertically through clipped slot windows instead of switching icons', () => {
    const frames = createOldVegasPack().pieces.find(p => p.id === 'slot-reels').image.frames;
    for (let reel = 0; reel < 3; reel++) for (let y = 7; y < 18; y++) for (let x = 12 + reel * 14; x < 22 + reel * 14; x++) expect(frames[1][y * 64 + x]).to.equal(frames[0][(y + 3) * 64 + x]);
  });
  it('provides three distinct humanoid dance loops with fitted costume and skin palette', () => {
    const dancers = createOldVegasPack().pieces.filter(p => p.id.startsWith('hydro-showgirl'));
    expect(dancers.length).to.equal(3);
    expect(new Set(dancers.map(p => Buffer.concat(p.image.frames.map(f => Buffer.from(f))).toString('base64'))).size).to.equal(3);
    for (const p of dancers) expect(p.image.frames.every(frame => frame.includes(14) && frame.includes(16) && frame.includes(4))).to.equal(true);
  });
  it('keeps placement deterministic, collision-free, bounded and lane-varied', () => {
    const pack = getDecorationPack('old-vegas');
    expect(getDecorationPack('unknown')).to.equal(null); expect(getDecorationPack('none')).to.equal(null);
    expect(decorationPlacements(null, 0, 0)).to.deep.equal([]);
    for (let lane = 0; lane < 6; lane++) for (let chunk = 0; chunk < 20; chunk++) {
      const placements = decorationPlacements(pack, lane, chunk);
      expect(placements).to.deep.equal(decorationPlacements(pack, lane, chunk));
      expect(placements.length).to.be.at.most(2);
      for (const p of placements) { expect(p.interactive).to.equal(false); expect(p.x).to.be.at.least(chunk * 128); expect(p.y + p.piece.height).to.be.at.most(96); }
    }
  });
  it('round-trips scenery choice without changing the terrain pack', () => {
    const config = readProcgenUrlConfig('?pack=2&decoration=old-vegas');
    expect(config.settings).to.include({ pack: 2, decoration: 'old-vegas' });
    expect(readProcgenUrlConfig('?decoration=unknown').settings).not.to.have.property('decoration');
    const url = createProcgenShareUrl({ url: 'https://example.test/procgen.html', seed: 4, settings: config.settings, appearance: {}, camera: {} });
    expect(new URL(url).searchParams.get('decoration')).to.equal('old-vegas');
  });
  it('caches terrain occlusion and freezes animation for reduced motion', () => {
    let masks = 0, clears = 0;
    const context = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: () => masks++, drawImage() {}, clearRect: () => clears++ };
    const document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
    const layer = new DecorationLayer(document, createOldVegasPack());
    const renderer = { world: { tickIndex: 0, frontierRevision: 0, laneCount: 1, generatedThrough: [128] }, buffer: { width: 128, height: 96 }, rasterStep: 1, originX: 0, originY: 0, viewWidth: 128, viewHeight: 96, lastTerrainKey: 'initial', pixels: new Uint32Array(128 * 96).fill(0xff0e0807), bufferContext: context };
    layer.draw(renderer, true); const firstMasks = masks;
    renderer.world.tickIndex = 100; layer.draw(renderer, true);
    expect(masks).to.equal(firstMasks); expect(clears).to.equal(1);
    layer.draw(renderer, false); expect(clears).to.equal(2);
    const before = clears; renderer.rasterStep = 4; layer.draw(renderer); expect(clears).to.equal(before);
    expect(context.globalCompositeOperation).to.equal('source-over');
  });
});
