import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { BaseImageInfo } from '../js/BaseImageInfo.js';
import { TerrainImageInfo } from '../js/TerrainImageInfo.js';

globalThis.lemmings = Lemmings;

describe('TerrainImageInfo', function() {
  it('extends BaseImageInfo', function() {
    const terrain = new TerrainImageInfo();
    expect(terrain).to.be.instanceOf(BaseImageInfo);
  });

  it('does not override BaseImageInfo defaults', function() {
    const base = new BaseImageInfo();
    const terrain = new TerrainImageInfo();
    for (const prop of [
      'width',
      'height',
      'imageLoc',
      'maskLoc',
      'vgaLoc',
      'frameDataSize',
      'frameCount',
      'palette'
    ]) {
      expect(terrain[prop]).to.equal(base[prop]);
    }
  });
});
