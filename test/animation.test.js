import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BinaryReader } from '../js/BinaryReader.js';
import { Animation } from '../js/Animation.js';
import '../js/ColorPalette.js';
import '../js/PaletteImage.js';
import '../js/Frame.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('Animation.loadFromFileWithPaletteSwap', function () {
  it('replaces FIRE_INDICES colors with ICE_COLORS', function () {
    const palette = new Lemmings.ColorPalette();
    for (let i = 0; i < 16; i++) palette.setColorRGB(i, i, i, i);

    const data = new Uint8Array([0x40]);
    const reader = new BinaryReader(data);

    const anim = new Animation();
    anim.loadFromFileWithPaletteSwap(reader, 4, 1, 1, 1, palette);

    const color = anim.frames[0].getBuffer()[0] >>> 0;
    const expected = Lemmings.ColorPalette.colorFromRGB(64, 160, 255) >>> 0;
    expect(color).to.equal(expected);
  });

  it('handles non-looping playback and restart', function() {
    const anim = new Animation(null, false);
    anim.frames = ['a','b','c'];

    expect(anim.getFrame(-5)).to.equal('a');
    expect(anim.isFinished).to.equal(false);

    expect(anim.getFrame(10)).to.equal('c');
    expect(anim.isFinished).to.equal(true);
    expect(anim.getFrame(11)).to.equal('c');

    anim.restart(3);
    expect(anim.isFinished).to.equal(false);
    expect(anim.firstFrameIndex).to.equal(3);
  });

  it('wraps frame index when looping', function () {
    const anim = new Animation();
    anim.frames = ['a', 'b', 'c'];

    expect(anim.getFrame(-1)).to.equal('c');
    expect(anim.getFrame(4)).to.equal('b');
  });

  it('uses local index after restart when not looping', function () {
    const anim = new Animation(null, false);
    anim.frames = ['a', 'b', 'c'];

    anim.getFrame(10); // finish playback
    anim.restart(5);

    expect(anim.isFinished).to.equal(false);
    expect(anim.getFrame(6)).to.equal('b');
  });
});
