import { expect } from 'chai';
import { Lemmings } from './helpers/lemmings.js';
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
  afterEach(function() {
    delete globalThis.lemmings;
    ParticleTable._sharedParticleData = undefined;
  });

  it('decodes Base64 data into 51 frames', function() {
    globalThis.lemmings = { game: { showDebug: false } };
    ParticleTable._sharedParticleData = undefined;
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    expect(pt.particleData.length).to.equal(51);
  });

  it('draw() calls drawFrame with a populated frame', function() {
    globalThis.lemmings = { game: { showDebug: false } };
    ParticleTable._sharedParticleData = undefined;
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
    globalThis.lemmings = { game: { showDebug: false } };
    ParticleTable._sharedParticleData = undefined;
    const pal = makePalette();
    const pt1 = new ParticleTable(pal);
    const shared = ParticleTable._sharedParticleData;
    expect(pt1.particleData).to.equal(shared);
    const pt2 = new ParticleTable(pal);
    expect(ParticleTable._sharedParticleData).to.equal(shared);
    expect(pt2.particleData).to.equal(shared);
  });

  it('draw() returns early when display is null', function() {
    globalThis.lemmings = { game: { showDebug: false } };
    ParticleTable._sharedParticleData = undefined;
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    expect(() => pt.draw(null, 0, 0, 0)).to.not.throw();
  });
});
