import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { LevelIndexResolve } from '../js/LevelIndexResolve.js';
import '../js/LevelIndexType.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('LevelIndexResolve and LevelIndexType', function () {
  const config = {
    level: {
      order: [
        [91, -6, 95],
        [0, -16]
      ]
    }
  };

  it('LevelIndexType defaults useOddTable to false', function () {
    const lit = new Lemmings.LevelIndexType();
    expect(lit.useOddTable).to.be.false;
  });

  it('resolves positive entry', function () {
    const resolver = new LevelIndexResolve(config);
    const result = resolver.resolve(0, 0);
    expect(result.fileId).to.equal(9);
    expect(result.partIndex).to.equal(1);
    expect(result.levelNumber).to.equal(0);
    expect(result.useOddTable).to.be.false;
  });

  it('resolves negative entry', function () {
    const resolver = new LevelIndexResolve(config);
    const result = resolver.resolve(0, 1);
    expect(result.fileId).to.equal(0);
    expect(result.partIndex).to.equal(6);
    expect(result.levelNumber).to.equal(1);
    expect(result.useOddTable).to.be.true;
  });

  it('computes levelNumber across modes', function () {
    const resolver = new LevelIndexResolve(config);
    const result = resolver.resolve(1, 1);
    expect(result.fileId).to.equal(1);
    expect(result.partIndex).to.equal(6);
    expect(result.levelNumber).to.equal(4);
    expect(result.useOddTable).to.be.true;
  });
});
