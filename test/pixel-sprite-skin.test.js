import { expect } from 'chai';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { PixelSpriteSkin } from '../js/lemmings/PixelSpriteSkin.js';
import { SpriteTypes } from '../js/lemmings/SpriteTypes.js';
import { GameResources } from '../js/game/GameResources.js';
import { ConfigReader } from '../js/data/ConfigReader.js';
import { GameTypes } from '../js/game/GameTypes.js';
import { ColorPalette } from '../js/render/ColorPalette.js';

const manifestPath = 'assets/hydro/hydro-skin.json';
const read = () => JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

describe('PixelSpriteSkin hydro actor replacement', function () {
  it('covers all 337 frames and both directions of all 18 states', function () {
    const manifest = read();
    const skin = new PixelSpriteSkin(manifest);
    expect(manifest.animations.reduce((n, a) => n + a.frameCount, 0)).to.equal(337);
    for (const record of manifest.animations) {
      for (const right of [true, false]) {
        const animation = skin.getAnimation(SpriteTypes[record.state], right);
        expect(animation.frameCount).to.equal(record.frameCount);
        expect(animation.getFrame(animation.frameCount)).to.equal(animation.getFrame(0));
        for (const frame of animation.frames) {
          expect([frame.width, frame.height, frame.offsetX, frame.offsetY]).to.eql([record.width, record.height, record.offsetX, record.offsetY]);
        }
      }
    }
  });

  it('matches installed PNG strips and binary masks when the PNGs are present', function () {
    const manifest = read();
    const skin = new PixelSpriteSkin(manifest);
    for (const record of manifest.animations) {
      const animation = skin.getAnimation(SpriteTypes[record.state], record.direction >= 0);
      const filename = `assets/hydro/${record.strip}`;
      const png = fs.existsSync(filename) ? PNG.sync.read(fs.readFileSync(filename)) : null;
      for (let i = 0; i < animation.frames.length; i++) {
        const frame = animation.frames[i];
        const rgba = frame.getData();
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < frame.width; x++) {
            const pixel = y * frame.width + x;
            expect(frame.mask[pixel]).to.equal(rgba[pixel * 4 + 3] === 255 ? 1 : 0);
            if (png) {
              const source = (y * png.width + i * frame.width + x) * 4;
              expect([...rgba.subarray(pixel * 4, pixel * 4 + 4)]).to.eql([...png.data.subarray(source, source + 4)]);
            }
          }
        }
        expect(frame.getSpanCache()).to.not.equal(null);
      }
    }
  });

  it('keeps climbers on the correct side of the x=8 wall anchor', function () {
    const skin = new PixelSpriteSkin(read());
    for (const right of [true, false]) {
      for (const frame of skin.getAnimation(SpriteTypes.CLIMBING, right).frames) {
        for (let y = 0; y < frame.height; y++) {
          for (let x = 0; x < frame.width; x++) {
            if (frame.mask[y * frame.width + x]) expect(right ? x <= 8 : x >= 8).to.equal(true);
          }
        }
      }
    }
  });

  it('rejects incomplete manifests and altered timing or alpha', function () {
    for (const change of [m => m.animations.pop(), m => m.animations[0].frameCount++, m => m.palette[1][3] = 128]) {
      const manifest = read();
      change(manifest);
      expect(() => new PixelSpriteSkin(manifest)).to.throw('Invalid sprite skin');
    }
  });

  it('retains the opt-in setting through the real configuration reader', async function () {
    const json = JSON.stringify([{ name: 'hydro', path: 'lemmings', gametype: 'LEMMINGS', spriteSkin: manifestPath, 'level.filePrefix': 'LEVEL', 'level.order': [[91]], 'level.groups': ['Fun'] }]);
    const config = await new ConfigReader(Promise.resolve(json)).getConfig(GameTypes.LEMMINGS);
    expect(config.spriteSkin).to.equal(manifestPath);
    const resources = new GameResources({ loadString: async () => fs.readFileSync(manifestPath, 'utf8') }, config);
    expect((await resources.getLemmingsSprite(new ColorPalette())).getAnimation(SpriteTypes.WALKING, true).frameCount).to.equal(8);
  });

  it('retries failed manifest loads without mutating the level palette', async function () {
    let attempts = 0;
    const resources = new GameResources({ loadString: async () => {
      attempts++;
      if (attempts === 1) throw new Error('temporary failure');
      return fs.readFileSync(manifestPath, 'utf8');
    } }, { spriteSkin: manifestPath });
    const palette = new ColorPalette();
    palette.setColorRGB(1, 240, 10, 20);
    const before = [...palette.data];
    try {
      await resources.getLemmingsSprite(palette);
      throw new Error('expected failure');
    } catch (error) {
      expect(error.message).to.include('temporary failure');
    }
    expect(await resources.getLemmingsSprite(palette)).to.be.instanceOf(PixelSpriteSkin);
    expect(attempts).to.equal(2);
    expect([...palette.data]).to.eql(before);
  });
});
