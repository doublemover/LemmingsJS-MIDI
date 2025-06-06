import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { BaseImageInfo } from '../js/BaseImageInfo.js';
import { TerrainImageInfo } from '../js/TerrainImageInfo.js';

globalThis.lemmings = Lemmings;

describe('BaseImageInfo', function() {
  it('uses default values in constructor', function() {
    const info = new BaseImageInfo();
    expect(info.width).to.equal(0);
    expect(info.height).to.equal(0);
    expect(info.imageLoc).to.equal(0);
    expect(info.maskLoc).to.equal(0);
    expect(info.vgaLoc).to.equal(0);
    expect(info.frameDataSize).to.equal(0);
    expect(info.frameCount).to.equal(0);
    expect(info.palette).to.equal(null);
  });

  it('TerrainImageInfo inherits BaseImageInfo fields', function() {
    const info = new TerrainImageInfo();
    expect(info).to.be.instanceOf(BaseImageInfo);
    expect(info.width).to.equal(0);
    expect(info.height).to.equal(0);
    expect(info.imageLoc).to.equal(0);
    expect(info.maskLoc).to.equal(0);
    expect(info.vgaLoc).to.equal(0);
    expect(info.frameDataSize).to.equal(0);
    expect(info.frameCount).to.equal(0);
    expect(info.palette).to.equal(null);
  });
});
