import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import { ParticleTable } from '../js/render/ParticleTable.js';

// Minimal palette stub with predictable color values
function makePalette() {
  return {
    getColor(i) { return ColorPalette.colorFromRGB(i, i + 10, i + 20); },
    getR(i) { return i; },
    getG(i) { return i + 10; },
    getB(i) { return i + 20; }
  };
}

describe('ParticleTable', function() {
  useGlobalLemmings({ game: { showDebug: false } });

  beforeEach(function() {
    ParticleTable._sharedParticleData = undefined;
  });

  afterEach(function() {
    ParticleTable._sharedParticleData = undefined;
  });

  it('decodes Base64 data into 51 frames', function() {
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    expect(pt.particleData.length).to.equal(51);
  });

  it('draw() calls drawFrame with a populated frame', function() {
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    const calls = [];
    const display = { drawFrame(frame, x, y) { calls.push({ frame, x, y }); } };
    pt.draw(display, 0, 60, 120);
    expect(calls).to.have.lengthOf(1);
    expect(calls[0].x).to.equal(60);
    expect(calls[0].y).to.equal(120);
    const expected = ColorPalette.colorFromRGB(4, 14, 24);
    expect(calls[0].frame.getBuffer().includes(expected)).to.equal(true);
  });

  it('decodes shared data only once for multiple instances', function() {
    const pal = makePalette();
    const pt1 = new ParticleTable(pal);
    const shared = ParticleTable._sharedParticleData;
    expect(pt1.particleData).to.equal(shared);
    const pt2 = new ParticleTable(pal);
    expect(ParticleTable._sharedParticleData).to.equal(shared);
    expect(pt2.particleData).to.equal(shared);
  });

  it('draw() returns early when display is null', function() {
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    expect(() => pt.draw(null, 0, 0, 0)).to.not.throw();
  });

  it('builds a placeholder frame when particle data is empty', function() {
    const originalCache = ParticleTable._frameCache;
    ParticleTable._frameCache = new WeakMap();
    ParticleTable._sharedParticleData = [Int8Array.from([-128, -128])];
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    let drawn = null;
    pt.draw({ drawFrame(frame) { drawn = frame; } }, 0, 0, 0);
    expect(drawn.width).to.equal(1);
    expect(drawn.height).to.equal(1);
    ParticleTable._frameCache = originalCache;
  });

  it('uses window.atob when available', function() {
    const originalWindow = globalThis.window;
    globalThis.window = {
      atob: (value) => Buffer.from(value, 'base64').toString('binary')
    };
    ParticleTable._frameCache = new WeakMap();
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    expect(pt.particleData.length).to.equal(51);
    globalThis.window = originalWindow;
  });
});
