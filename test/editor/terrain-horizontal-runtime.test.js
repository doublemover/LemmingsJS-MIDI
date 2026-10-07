import { expect } from 'chai';
import { EditorSession } from '../../js/editor/EditorSession.js';
import { createClassicLevelData } from '../../js/editor/EditorLevelLoader.js';
import { GroundRenderer } from '../../js/render/GroundRenderer.js';
import { Frame } from '../../js/render/Frame.js';
import { ColorPalette } from '../../js/render/ColorPalette.js';

const render = (properties = {}, rgba = false, scale = 1, x = 0) => {
  const pixels = [1, 0x80, 2, 3, 4, 0x80];
  const palette = new ColorPalette();
  for (let i = 1; i <= 4; i += 1) palette.setColorRGB(i, i * 40, i * 20, i * 10);
  let frame = new Uint8Array(3 * 2 * scale * scale).fill(0x80);
  for (let y = 0; y < 2; y += 1) for (let x = 0; x < 3; x += 1) {
    for (let sy = 0; sy < scale; sy += 1) for (let sx = 0; sx < scale; sx += 1) frame[(y * scale + sy) * 3 * scale + x * scale + sx] = pixels[y * 3 + x];
  }
  if (rgba) {
    const output = new Frame(3 * scale, 2 * scale);
    for (let i = 0; i < frame.length; i += 1) if (frame[i] !== 0x80) { output.data[i] = palette.getColor(frame[i]); output.mask[i] = 1; }
    frame = output;
  }
  const source = { width: 3 * scale, height: 2 * scale, sourceScaleX: scale, sourceScaleY: scale, frames: [frame], palette };
  const cfg = { id: 0, x, y: 0, drawProperties: properties };
  const renderer = new GroundRenderer(); renderer.createGroundMap({ levelWidth: 3, levelHeight: 2, terrains: [cfg] }, [source]);
  return { renderer, source, cfg };
};

describe('terrain horizontal runtime lowering', function() {
  it('lowers horizontal flips for runtime without pretending classic LVL can store them', function() {
    const session = new EditorSession(); session.createBlank();
    session.level.terrains.push({ props: { PIECE: 0, X: 3, Y: 4, FLIP_HORIZONTAL: true }, order: [], unknownLines: [] });
    session.level.gadgets.push({ props: { PIECE: 0, X: 3, Y: 4, FLIP_HORIZONTAL: true }, order: [], unknownLines: [] });
    const classic = createClassicLevelData(session.level);
    const runtime = createClassicLevelData(session.level, { runtimeTransforms: true });
    expect(classic.levelReader.terrains[0].drawProperties.isFlippedHorizontally).not.to.equal(true);
    expect(runtime.levelReader.terrains[0].drawProperties.isFlippedHorizontally).to.equal(true);
    expect(runtime.levelReader.objects[0].drawProperties.isFlippedHorizontally).not.to.equal(true);
    expect(classic.warnings.some(warning => warning.code === 'classic_unsupported_terrain_props')).to.equal(true);
    expect(session.level.terrains[0].props.FLIP_HORIZONTAL).to.equal(true);
  });

  for (const rgba of [false, true]) for (const scale of [1, 2]) for (const vertical of [false, true]) {
    it(`mirrors pixels and collision mask exactly (${rgba ? 'RGBA' : 'indexed'}, source ${scale}x, vertical ${vertical})`, function() {
      const original = render({ isUpsideDown: vertical }, rgba, scale).renderer.img;
      const flipped = render({ isUpsideDown: vertical, isFlippedHorizontally: true }, rgba, scale).renderer.img;
      for (let y = 0; y < 2; y += 1) for (let x = 0; x < 3; x += 1) {
        expect(flipped.data[y * 3 + x]).to.equal(original.data[y * 3 + 2 - x]);
        expect(flipped.mask[y * 3 + x]).to.equal(original.mask[y * 3 + 2 - x]);
      }
    });
  }

  it('respects clipping, transparent pixels, erase and overwrite rules', function() {
    const clipped = render({ isFlippedHorizontally: true }, false, 1, -1).renderer.img;
    expect([...clipped.mask]).to.deep.equal([0, 1, 0, 1, 1, 0]);
    const { renderer, source, cfg } = render({ isFlippedHorizontally: true });
    const pixelsBefore = [...source.frames[0]];
    renderer.img.data.fill(0xffabcdef); renderer.img.mask.fill(1);
    renderer._blit(source, { ...cfg, drawProperties: { isFlippedHorizontally: true, noOverwrite: true } });
    expect([...renderer.img.data]).to.deep.equal(Array(6).fill(0xffabcdef));
    renderer._blit(source, { ...cfg, drawProperties: { isFlippedHorizontally: true, isErase: true } });
    expect([...renderer.img.mask]).to.deep.equal([0, 1, 0, 1, 0, 0]);
    expect([...source.frames[0]]).to.deep.equal(pixelsBefore);
  });
});
