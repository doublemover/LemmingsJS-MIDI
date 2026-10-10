import { expect } from 'chai';
import { EditorAssetCache } from '../../js/editor/EditorAssetCache.js';
import { EditorPreviewCache } from '../../js/app/editorPreviewCache.js';
import { EditorSession } from '../../js/editor/EditorSession.js';
import { createTerrainEntry } from '../../js/editor/EditorEntryFactory.js';
import { createEditorLevelFromClassic } from '../../js/editor/ClassicLevelConverter.js';
import { createClassicLevelData } from '../../js/editor/EditorLevelLoader.js';
import { getEntryBounds } from '../../js/editor/EditorHitTest.js';
import { Frame } from '../../js/render/Frame.js';
import { GroundRenderer } from '../../js/render/GroundRenderer.js';
import { registerClassicStyles, resetStyleRegistry } from '../../js/editor/StyleRegistry.js';

const canvasDocument = () => {
  const outputs = [];
  return { outputs, createElement: () => ({ getContext: () => ({
    createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: image => outputs.push(image)
  }), toDataURL: () => 'data:image/png;base64,render-' + outputs.length }) };
};
const source = rgba => {
  const frame = new Frame(6, 4), indexed = new Uint8Array(24).fill(128);
  const palette = { getColor: index => (0xff100000 + index * 0x10203) >>> 0 };
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
    if (Math.floor(x / 2) === 1 && Math.floor(y / 2) === 0) continue;
    const index = 1 + Math.floor(y / 2) * 3 + Math.floor(x / 2);
    indexed[y * 6 + x] = index; frame.setPixel(x, y, palette.getColor(index));
  }
  return { width: 6, height: 4, sourceScaleX: 2, sourceScaleY: 2, frames: [rgba ? frame : indexed], ...(rgba ? {} : { palette }) };
};

describe('actual editor source and runtime round trips', function() {
  beforeEach(() => { resetStyleRegistry(); registerClassicStyles(); });
  after(() => { resetStyleRegistry(); registerClassicStyles(); });
  for (const rgba of [false, true]) it(`matches actual ground pixels, collision and palette bounds for scaled ${rgba ? 'RGBA' : 'indexed'} art`, async function() {
    const image = source(rgba);
    class Container { getPart() { return new Uint8Array(); } }
    class Reader { getTerrainImages() { return [image]; } getObjectImages() { return [image]; } }
    const assets = await new EditorAssetCache({ FileContainer: Container, GroundReader: Reader }).loadStyleAssets('dirt', { path: 'fixture' }, { loadBinary: async () => new Uint8Array() });
    expect(getEntryBounds({ props: { X: 4, Y: 5 } }, assets.terrain[0])).to.deep.equal({ x: 4, y: 5, width: 3, height: 2 });
    expect(assets.gadgets[0]).to.include({ width: 3, height: 2 });
    const renderer = new GroundRenderer(); renderer.createGroundMap({ levelWidth: 3, levelHeight: 2, terrains: [{ id: 0, x: 0, y: 0, drawProperties: {} }] }, [image]);
    const document = canvasDocument(), cache = new EditorPreviewCache({ document, storage: {} });
    const first = cache.getPreviewUrl({ type: 'terrain', id: 0, image });
    expect(first).to.be.a('string'); expect(document.outputs[0]).to.include({ width: 3, height: 2 });
    const visiblePixels = renderer.img.getData().slice();
    for (let at = 0; at < renderer.img.mask.length; at++) if (!renderer.img.mask[at]) visiblePixels.fill(0, at * 4, at * 4 + 4);
    expect([...document.outputs[0].data]).to.deep.equal([...visiblePixels]);
    expect([...renderer.img.mask]).to.deep.equal([1, 0, 1, 1, 1, 1]);
    expect(cache.getPreviewUrl({ type: 'terrain', id: 0, image })).to.equal(first); expect(document.outputs).to.have.length(1);
    if (rgba) { image.frames[0].clearPixel(0, 0); expect(cache.getPreviewUrl({ type: 'terrain', id: 0, image })).not.to.equal(first); expect(document.outputs[1].data[3]).to.equal(0); }
    image.sourceScaleY = 1; cache.getPreviewUrl({ type: 'terrain', id: 0, image }); expect(document.outputs.at(-1).height).to.equal(4);
  });
  it('preserves runtime horizontal terrain flips through editor text and fresh runtime lowering', function() {
    const original = new EditorSession(); original.createBlank();
    original.level.terrains.push(createTerrainEntry({ piece: 0, x: 3, y: 4, flipH: true, flipV: true, rotate: 90, width: 12, height: 8 }));
    const preserved = new EditorSession(); preserved.loadFromText(original.toText());
    expect(preserved.level.terrains[0].props).to.include({ ROTATE: 90, WIDTH: 12, HEIGHT: 8 });
    const runtime = createClassicLevelData(preserved.level, { runtimeTransforms: true });
    const returned = createEditorLevelFromClassic(runtime.levelReader), reloaded = new EditorSession(); reloaded.level = returned;
    const roundtrip = new EditorSession(); roundtrip.loadFromText(reloaded.toText());
    expect(roundtrip.level.terrains[0].props).to.include({ FLIP_HORIZONTAL: true, FLIP_VERTICAL: true });
    const fresh = createClassicLevelData(roundtrip.level, { runtimeTransforms: true });
    expect(fresh.levelReader.terrains[0].drawProperties).to.deep.equal(runtime.levelReader.terrains[0].drawProperties);
    expect(createClassicLevelData(roundtrip.level).warnings.some(warning => warning.code === 'classic_unsupported_terrain_props')).to.equal(true);
  });
});
