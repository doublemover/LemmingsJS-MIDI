import { expect } from 'chai';

function makePalette() {
  return {
    getR(i) { return i; },
    getG(i) { return i + 10; },
    getB(i) { return i + 20; }
  };
}

describe('ParticleTable lookup branches', function() {
  afterEach(function() {
    delete global.window;
    delete globalThis.lemmings;
  });

  it('skips sentinel coordinates while drawing', async function() {
    globalThis.lemmings = { game: { showDebug: false } };
    const { ParticleTable } = await import('../js/ParticleTable.js?sentinel');
    ParticleTable._sharedParticleData = [
      new Int8Array([0, 0, -128, 0, 1, 1, -128, -128])
    ];
    const pt = new ParticleTable(makePalette());
    const calls = [];
    const display = { setPixel(...args) { calls.push(args); } };
    pt.draw(display, 0, 5, 5);
    expect(calls.length).to.equal(2);
  });

  it('uses window.atob when available', async function() {
    let called = false;
    global.window = { atob(str) { called = true; return Buffer.from(str, 'base64').toString('binary'); } };
    globalThis.lemmings = { game: { showDebug: false } };
    const { ParticleTable } = await import('../js/ParticleTable.js?atob');
    ParticleTable._sharedParticleData = undefined;
    new ParticleTable(makePalette());
    expect(called).to.equal(true);
  });

  it('reads ParticleTable.particleDataBase64 when overridden', async function() {
    let accessed = false;
    globalThis.lemmings = { game: { showDebug: false } };
    const { ParticleTable } = await import('../js/ParticleTable.js?optchain');
    const original = ParticleTable.particleDataBase64;
    Object.defineProperty(ParticleTable, 'particleDataBase64', {
      configurable: true,
      get() {
        accessed = true;
        return original;
      }
    });
    ParticleTable._sharedParticleData = undefined;
    new ParticleTable(makePalette());
    expect(accessed).to.equal(true);
    Object.defineProperty(ParticleTable, 'particleDataBase64', {
      configurable: true,
      writable: true,
      value: original
    });
  });
});
