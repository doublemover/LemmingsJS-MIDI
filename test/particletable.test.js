import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ParticleTable } from '../js/ParticleTable.js';

// Minimal palette stub with predictable color values
function makePalette() {
  return {
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

  it('draw() calls setPixel with expected coordinates and palette values', function() {
    globalThis.lemmings = { game: { showDebug: false } };
    ParticleTable._sharedParticleData = undefined;
    const pal = makePalette();
    const pt = new ParticleTable(pal);
    const calls = [];
    const display = { setPixel(...args) { calls.push(args); } };
    pt.draw(display, 0, 60, 120);
    expect(calls.length).to.equal(80);
    expect(calls.slice(0, 5)).to.eql([
      [8, 20, 4, 14, 24, 255],
      [37, 73, 14, 24, 34, 255],
      [67, 95, 12, 22, 32, 255],
      [58, 99, 10, 20, 30, 255],
      [63, 106, 8, 18, 28, 255]
    ]);
  });
});
