import { expect } from 'chai';
import { setGlobalLemmings, useGlobalLemmings } from './helpers/lemmings.js';
import { GameFactory } from '../js/game/GameFactory.js';
import { applyDependencyOverrides } from './support/deps.js';

useGlobalLemmings({ game: { showDebug: false } });

class FileProviderStub {
  constructor(root) { this.root = root; }
  loadString() { return Promise.resolve('[]'); }
}

const makeConfigReaderStub = (getConfig) => class ConfigReaderStub {
  constructor() { this.calls = []; }
  getConfig(gt) {
    this.calls.push(gt);
    return Promise.resolve(getConfig(gt));
  }
};

const withPerfStub = async (perf, lemmings, fn) => {
  const origPerf = globalThis.performance;
  globalThis.performance = perf;
  const restoreLemmings = setGlobalLemmings(lemmings);
  try {
    return await fn();
  } finally {
    globalThis.performance = origPerf;
    restoreLemmings();
  }
};

describe('GameFactory resource helpers', function () {
  afterEach(function () {
    delete globalThis.__LEMMINGS_RUNTIME_REVISION__;
  });

  it('loads config and resources and builds Game', async function () {
    const mockConfig = { path: 'data', level: {} };
    const ConfigReaderStub = makeConfigReaderStub(() => mockConfig);
    class GameResourcesStub {
      constructor(fp, cfg) { this.fp = fp; this.cfg = cfg; }
    }

    class GameStub {
      constructor(res) { this.res = res; }
    }
    const restore = applyDependencyOverrides({
      FileProvider: FileProviderStub,
      ConfigReader: ConfigReaderStub,
      GameResources: GameResourcesStub,
      Game: GameStub
    });
    try {
      const gf = new GameFactory('root');

      const cfg = await gf.getConfig(1);
      expect(cfg).to.equal(mockConfig);

      const resources = await gf.getGameResources(2);
      expect(resources).to.be.instanceOf(GameResourcesStub);
      expect(resources.cfg).to.equal(mockConfig);
      expect(resources.fp).to.be.instanceOf(FileProviderStub);
      expect(gf.configReader.calls).to.eql([1, 2]);

      const game = await gf.getGame(3, resources);
      expect(game).to.be.instanceOf(GameStub);
      expect(game.res).to.equal(resources);
    } finally {
      restore();
    }
  });

  it('creates Game when resources are not provided', async function () {
    const mockConfig = { path: 'data', level: {} };
    const ConfigReaderStub = makeConfigReaderStub(() => mockConfig);
    class GameResourcesStub {
      constructor(fp, cfg) { this.fp = fp; this.cfg = cfg; }
    }

    class GameStub {
      constructor(res) { this.res = res; }
    }
    const restore = applyDependencyOverrides({
      FileProvider: FileProviderStub,
      ConfigReader: ConfigReaderStub,
      GameResources: GameResourcesStub,
      Game: GameStub
    });
    try {
      const gf = new GameFactory('root');

      const game = await gf.getGame(5);
      expect(game).to.be.instanceOf(GameStub);
      expect(game.res).to.be.instanceOf(GameResourcesStub);
      expect(game.res.cfg).to.equal(mockConfig);
      expect(gf.configReader.calls).to.eql([5]);
    } finally {
      restore();
    }
  });

  it('rejects when config is missing', async function () {
    const ConfigReaderStub = makeConfigReaderStub(() => null);
    const restore = applyDependencyOverrides({
      FileProvider: FileProviderStub,
      ConfigReader: ConfigReaderStub
    });
    try {
      const gf = new GameFactory('root');

      let rejected = false;
      try {
        await gf.getGameResources(1);
      } catch (e) {
        rejected = true;
      }
      expect(rejected).to.be.true;
    } finally {
      restore();
    }
  });

  it('records performance measures when enabled', async function () {
    const measures = [];
    const ConfigReaderStub = makeConfigReaderStub(() => ({ path: 'data', level: {} }));
    class GameResourcesStub {}
    class GameStub {}
    const restore = applyDependencyOverrides({
      FileProvider: FileProviderStub,
      ConfigReader: ConfigReaderStub,
      GameResources: GameResourcesStub,
      Game: GameStub
    });
    await withPerfStub(
      { now: () => 1, measure: (name) => measures.push(name) },
      { performanceAPI: true, game: { showDebug: false } },
      async () => {
        const gf = new GameFactory('root');
        await gf.getGameResources(1);
        await gf.getGame(1, new GameResourcesStub());
      }
    );
    restore();

    expect(measures).to.include('GameFactory getGameResources');
    expect(measures).to.include('GameFactory getGame');
  });

  it('swallows performance measurement errors', async function () {
    const ConfigReaderStub = makeConfigReaderStub(() => ({ path: 'data', level: {} }));
    class GameResourcesStub {}
    class GameStub {}
    const restore = applyDependencyOverrides({
      FileProvider: FileProviderStub,
      ConfigReader: ConfigReaderStub,
      GameResources: GameResourcesStub,
      Game: GameStub
    });
    await withPerfStub(
      { now: () => 1, measure: () => { throw new Error('boom'); } },
      { performanceAPI: true, game: { showDebug: false } },
      async () => {
        const gf = new GameFactory('root');
        await gf.getGameResources(1);
        await gf.getGame(1, new GameResourcesStub());
      }
    );
    restore();
  });

  it('passes runtime cache-bust revision to FileProvider', async function () {
    class CapturingFileProvider {
      constructor(root, options) {
        this.root = root;
        this.options = options || {};
      }
      loadString() {
        return Promise.resolve('[]');
      }
    }
    const restore = applyDependencyOverrides({
      FileProvider: CapturingFileProvider,
      ConfigReader: makeConfigReaderStub(() => ({ path: 'data', level: {} }))
    });
    const previousLocation = globalThis.location;
    globalThis.location = { search: '?rev=phase30a' };
    try {
      const gf = new GameFactory('root');
      expect(gf.fileProvider.options.cacheBustRevision).to.equal('phase30a');
    } finally {
      if (previousLocation === undefined) {
        delete globalThis.location;
      } else {
        globalThis.location = previousLocation;
      }
      restore();
    }
  });
});
