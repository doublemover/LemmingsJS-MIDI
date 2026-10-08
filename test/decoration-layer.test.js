import { expect } from 'chai';
import { DecorationLayer } from '../js/decorations/DecorationLayer.js';
import { decorationPlacements } from '../js/decorations/ProcgenDecorationPacks.js';

const makeContext = () => ({
  clears: 0, uploads: [], draws: [], fills: [], events: [], globalCompositeOperation: 'source-over',
  createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  putImageData(data) { this.uploads.push(data); },
  clearRect() { this.clears++; },
  drawImage(...args) { const entry = { args, operation: this.globalCompositeOperation }; this.draws.push(entry); this.events.push({ type: 'draw', entry }); },
  fillRect(...args) { const entry = { args, color: this.fillStyle, operation: this.globalCompositeOperation }; this.fills.push(entry); this.events.push({ type: 'fill', entry }); }
});
const makeDocument = () => ({
  canvases: [],
  createElement() {
    const context = makeContext(), canvas = { width: 0, height: 0, context, getContext: () => context };
    this.canvases.push(canvas); return canvas;
  }
});
const makePiece = (placement, width, height, palette = { getColor: index => index ? 0xffcc7744 : 0xff2277dd }) => ({
  placement, width, height,
  image: { width, height, palette, frames: [new Uint8Array(width * height), new Uint8Array(width * height).fill(1)] }
});
const makePack = () => ({ id: 'test', pieces: [makePiece('ceiling', 32, 24), makePiece('stage', 48, 64), makePiece('trim', 128, 16)] });
const makeRenderer = ({ width = 64, height = 48, step = 1, laneCount = 1000000, originX = 0, originY = 0, through = 1e12 } = {}) => {
  let frontierReads = 0;
  const generatedThrough = new Proxy({}, { get() { frontierReads++; return through; } });
  return {
    world: { tickIndex: 0, frontierRevision: 0, generation: 1, laneCount, generatedThrough },
    buffer: { width, height }, bufferContext: makeContext(), rasterStep: step,
    originX, originY, viewWidth: width * step, viewHeight: height * step,
    lastTerrainKey: 'initial', pixels: new Uint32Array(width * height).fill(0xff0e0807),
    frontierReads: () => frontierReads
  };
};
const artworkDraws = layer => layer.context.draws.filter(draw => draw.args[0] !== layer.mask);

describe('screen-bounded procedural decoration layer', () => {
  it('retains scenery across the viewport at zoom 1/4 through 1/256', () => {
    for (const step of [4, 8, 16, 32, 64, 128, 256]) {
      const document = makeDocument(), layer = new DecorationLayer(document, makePack()), renderer = makeRenderer({ step });
      layer.draw(renderer);
      const positions = [...artworkDraws(layer).map(draw => draw.args.slice(1)), ...layer.context.fills.map(fill => fill.args)];
      expect(positions.length, `step ${step}`).to.be.greaterThan(0);
      expect(positions.some(([x, , width]) => x + width >= renderer.buffer.width * 0.8), `right edge at step ${step}`).to.equal(true);
      expect(positions.some(([, y, , height]) => y + height >= renderer.buffer.height * 0.8), `bottom edge at step ${step}`).to.equal(true);
      expect([layer.canvas.width, layer.canvas.height, layer.mask.width, layer.mask.height]).to.deep.equal([64, 48, 64, 48]);
      expect(renderer.bufferContext.draws[0].args[0]).to.equal(layer.canvas);
    }
  });

  it('bounds tiny-zoom candidate work and pixel bins by screen size, without source canvases', () => {
    for (const step of [256, 65536]) {
      const document = makeDocument(), pack = makePack(), pieces = pack.pieces;
      let catalogReads = 0;
      Object.defineProperty(pack, 'pieces', { get() { catalogReads++; return pieces; } });
      const layer = new DecorationLayer(document, pack), renderer = makeRenderer({ step });
      layer.draw(renderer);
      expect(renderer.frontierReads()).to.be.at.most(2 * renderer.buffer.height + 8);
      expect(catalogReads).to.be.at.most(12 * (renderer.buffer.width + 4) * (renderer.buffer.height + 4));
      expect(layer.placements.length).to.be.at.most(renderer.buffer.width * renderer.buffer.height);
      expect(layer.trims.length).to.be.at.most(renderer.buffer.width * renderer.buffer.height);
      expect(layer.context.fills.length).to.be.greaterThan(1024);
      expect(layer.context.fills.every(({ args: [x, y, w, h] }) => x >= 0 && y >= 0 && x < 64 && y < 48 && w === 1 && h === 1)).to.equal(true);
      expect(document.canvases).to.have.length(2);
      const reads = renderer.frontierReads(), catalogs = catalogReads, fills = layer.context.fills.length;
      layer.draw(renderer);
      expect(layer.context.fills.length).to.equal(fills);
      renderer.world.tickIndex += 4; layer.draw(renderer);
      expect(renderer.frontierReads()).to.equal(reads); expect(catalogReads).to.equal(catalogs);
      expect(layer.context.fills.length).to.be.greaterThan(fills);
      expect(document.canvases).to.have.length(2);
    }
  });

  it('retains the final visible lane and chunk when overscan falls between sampling strides', () => {
    for (const step of [256, 65536]) {
      const layer = new DecorationLayer(makeDocument(), makePack());
      const renderer = makeRenderer({ step, width: 4, height: 4, originX: 512, originY: 192, laneCount: 3, through: 640 });
      layer.draw(renderer);
      expect(layer.context.fills.length).to.be.greaterThan(0);
      expect(layer.trims.some(entry => entry.px === 0 && entry.py === 0)).to.equal(true);
    }
  });

  it('caches terrain masks and placements independently of animation and reduced motion', () => {
    const layer = new DecorationLayer(makeDocument(), makePack()), renderer = makeRenderer({ width: 256, height: 96 });
    layer.draw(renderer, true);
    const reads = renderer.frontierReads();
    renderer.world.tickIndex = 100; layer.draw(renderer, true);
    expect(layer.context.clears).to.equal(1); expect(layer.maskContext.uploads).to.have.length(1);
    layer.draw(renderer, false);
    expect(layer.context.clears).to.equal(2); expect(layer.maskContext.uploads).to.have.length(1);
    expect(renderer.frontierReads()).to.equal(reads);
    renderer.world.tickIndex = 0; layer.draw(renderer, false);
    const clears = layer.context.clears;
    layer.draw(renderer, true); layer.draw(renderer, false);
    expect(layer.context.clears).to.equal(clears + 2);
    expect(renderer.frontierReads()).to.equal(reads);
    expect(layer.maskContext.uploads).to.have.length(1);
  });

  it('invalidates both bitmap and pixel-color caches when a same-ID pack is replaced', () => {
    for (const step of [1, 256]) {
      const pack = makePack(), layer = new DecorationLayer(makeDocument(), pack), renderer = makeRenderer({ step });
      layer.draw(renderer);
      const oldDraws = artworkDraws(layer), oldBitmap = oldDraws[0]?.args[0], oldColor = layer.context.fills[0]?.color, reads = renderer.frontierReads();
      layer.pack = { ...pack, pieces: pack.pieces.map(piece => ({ ...piece, image: { ...piece.image, palette: { getColor: () => 0xff00ff00 } } })) };
      layer.draw(renderer);
      expect(layer.context.clears).to.equal(2); expect(layer.maskContext.uploads).to.have.length(1);
      expect(renderer.frontierReads()).to.be.greaterThan(reads);
      if (step === 1) {
        const bitmap = artworkDraws(layer)[oldDraws.length].args[0];
        expect(bitmap).not.to.equal(oldBitmap);
        expect(new Uint32Array(bitmap.context.uploads[0].data.buffer)[0]).to.equal(0xff00ff00);
      }
      else { expect(layer.context.fills.at(-1).color).to.equal('rgb(0,255,0)'); expect(layer.context.fills.at(-1).color).not.to.equal(oldColor); }
    }
  });

  it('invalidates viewport, frontier, terrain and world-generation caches precisely', () => {
    const layer = new DecorationLayer(makeDocument(), makePack()), renderer = makeRenderer({ step: 256 });
    layer.draw(renderer);
    let clears = layer.context.clears, reads = renderer.frontierReads(), masks = layer.maskContext.uploads.length;
    renderer.lastTerrainKey = 'terrain-edit'; renderer.pixels[0] = 0xff123456; layer.draw(renderer);
    expect(layer.context.clears).to.equal(++clears); expect(layer.maskContext.uploads).to.have.length(++masks);
    expect(renderer.frontierReads()).to.equal(reads);
    expect(new Uint32Array(layer.maskContext.uploads.at(-1).data.buffer)[0]).to.equal(0xff000000);
    renderer.world.frontierRevision++; layer.draw(renderer);
    expect(layer.context.clears).to.equal(++clears); expect(layer.maskContext.uploads).to.have.length(masks);
    expect(renderer.frontierReads()).to.be.greaterThan(reads); reads = renderer.frontierReads();
    for (const mutate of [() => renderer.originX += 128, () => renderer.originY += 96, () => renderer.rasterStep /= 2, () => renderer.world.generation++, () => renderer.world.laneCount--]) {
      mutate(); layer.draw(renderer);
      expect(layer.context.clears).to.equal(++clears); expect(layer.maskContext.uploads).to.have.length(++masks);
      expect(renderer.frontierReads()).to.be.greaterThan(reads); reads = renderer.frontierReads();
    }
    renderer.buffer.width = 32; renderer.buffer.height = 24;
    renderer.viewWidth = 32 * renderer.rasterStep; renderer.viewHeight = 24 * renderer.rasterStep;
    renderer.pixels = new Uint32Array(32 * 24).fill(0xff0e0807); layer.draw(renderer);
    expect([layer.canvas.width, layer.canvas.height, layer.mask.width, layer.mask.height]).to.deep.equal([32, 24, 32, 24]);
    expect(layer.maskContext.uploads.at(-1).data.length).to.equal(32 * 24 * 4);
  });

  it('keeps large sprites visible from anchors in earlier chunks without dimension caps', () => {
    const architecture = makePiece('ceiling', 256, 64), dancer = makePiece('stage', 192, 192);
    const pack = { pieces: [architecture, dancer] }, layer = new DecorationLayer(makeDocument(), pack);
    const renderer = makeRenderer({ width: 32, height: 32, originX: 256, originY: 10, laneCount: 1, through: 256 });
    layer.draw(renderer);
    const draws = artworkDraws(layer);
    expect(draws.some(({ args: [bitmap, x, , width, height] }) => bitmap.width === 256 && x < 0 && width === 256 && height === 64)).to.equal(true);
    expect(layer.placements.some(entry => entry.image === architecture.image)).to.equal(true);
    const initialReads = renderer.frontierReads(); layer.draw(renderer);
    expect(renderer.frontierReads()).to.equal(initialReads);
    const dancerRenderer = makeRenderer({ width: 256, height: 96, laneCount: 1 });
    layer.draw(dancerRenderer);
    const placement = decorationPlacements(pack, 0, 0).find(p => p.piece === dancer);
    const entry = layer.placements.find(p => p.image === dancer.image);
    expect(placement.scale).to.equal(68 / 192);
    expect(entry.width).to.equal(dancer.width * placement.scale);
    expect(entry.height).to.equal(dancer.height * (placement.scale ?? 1));
    expect(entry.py).to.equal(placement.y);
    expect(artworkDraws(layer).some(({ args: [bitmap] }) => bitmap.width === 192 && bitmap.height === 192)).to.equal(true);
  });

  it('includes art extending down from an earlier lane and reuses full-size frame canvases', () => {
    const piece = makePiece('ceiling', 192, 192), pack = { pieces: [piece] };
    const document = makeDocument(), layer = new DecorationLayer(document, pack);
    const renderer = makeRenderer({ width: 256, height: 32, originY: 100, laneCount: 1, through: 256 });
    layer.draw(renderer);
    expect(layer.placements.length).to.be.greaterThan(0);
    expect(layer.placements.every(entry => entry.py < 0 && entry.py + entry.height > 0)).to.equal(true);
    const reads = renderer.frontierReads();
    for (let tick = 4; tick <= 64; tick += 4) { renderer.world.tickIndex = tick; layer.draw(renderer); }
    expect(renderer.frontierReads()).to.equal(reads);
    expect(document.canvases).to.have.length(4);
    expect(document.canvases.slice(2).every(canvas => canvas.width === 192 && canvas.height === 192)).to.equal(true);
    expect(layer.maskContext.uploads).to.have.length(1);
  });

  it('does not rasterize offscreen art or transparent subpixel sprites', () => {
    const piece = makePiece('ceiling', 32, 24), pack = { pieces: [piece] };
    for (const frame of piece.image.frames) frame.fill(128);
    const document = makeDocument(), layer = new DecorationLayer(document, pack), renderer = makeRenderer({ step: 256 });
    layer.draw(renderer);
    expect(layer.context.fills).to.have.length(0); expect(artworkDraws(layer)).to.have.length(0);
    expect(document.canvases).to.have.length(2);
    renderer.rasterStep = 1; renderer.viewWidth = 64; renderer.viewHeight = 48; renderer.originX = 1000;
    renderer.world.generatedThrough = [128]; renderer.world.laneCount = 1; layer.draw(renderer);
    expect(artworkDraws(layer)).to.have.length(0); expect(document.canvases).to.have.length(2);
  });

  it('occludes background art before drawing trim, including far-zoom dots', () => {
    for (const step of [1, 256]) {
      const layer = new DecorationLayer(makeDocument(), makePack()), renderer = makeRenderer({ width: 256, height: 96, step, laneCount: 1 });
      layer.draw(renderer);
      const maskIndex = layer.context.draws.findIndex(draw => draw.args[0] === layer.mask);
      expect(layer.context.draws[maskIndex].operation).to.equal('destination-out');
      expect(layer.context.globalCompositeOperation).to.equal('source-over');
      expect(layer.context.imageSmoothingEnabled).to.equal(false);
      expect(layer.maskContext.uploads).to.have.length(1);
      if (step === 1) {
        expect(maskIndex).to.be.greaterThan(0);
        expect(layer.context.draws.slice(maskIndex + 1).some(draw => draw.args[0].height === 16)).to.equal(true);
      } else {
        const events = layer.context.events, maskEvent = events.findIndex(({ entry }) => entry.args[0] === layer.mask);
        expect(events.slice(0, maskEvent).some(event => event.type === 'fill')).to.equal(true);
        expect(events.slice(maskEvent + 1).some(event => event.type === 'fill')).to.equal(true);
      }
    }
  });
});
