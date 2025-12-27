import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import { GameFactory } from '../js/game/GameFactory.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('GameFactory resource helpers', function () {
  it('loads config and resources and builds Game', async function () {
    const mockConfig = { path: 'data', level: {} };

    class FileProviderStub {
      constructor(root) { this.root = root; }
      loadString() { return Promise.resolve('[]'); }
    }

    class ConfigReaderStub {
      constructor() { this.calls = []; }
      getConfig(gt) { this.calls.push(gt); return Promise.resolve(mockConfig); }
    }

    class GameResourcesStub {
      constructor(fp, cfg) { this.fp = fp; this.cfg = cfg; }
    }

    class GameStub {
      constructor(res) { this.res = res; }
    }

    const orig = {
      FileProvider: Lemmings.FileProvider,
      ConfigReader: Lemmings.ConfigReader,
      GameResources: Lemmings.GameResources,
      Game: Lemmings.Game
    };

    setDependency('FileProvider', FileProviderStub);
    setDependency('ConfigReader', ConfigReaderStub);
    setDependency('GameResources', GameResourcesStub);
    setDependency('Game', GameStub);

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

    setDependency('FileProvider', orig.FileProvider);
    setDependency('ConfigReader', orig.ConfigReader);
    setDependency('GameResources', orig.GameResources);
    setDependency('Game', orig.Game);
  });

  it('creates Game when resources are not provided', async function () {
    const mockConfig = { path: 'data', level: {} };

    class FileProviderStub {
      constructor(root) { this.root = root; }
      loadString() { return Promise.resolve('[]'); }
    }

    class ConfigReaderStub {
      constructor() { this.calls = []; }
      getConfig(gt) { this.calls.push(gt); return Promise.resolve(mockConfig); }
    }

    class GameResourcesStub {
      constructor(fp, cfg) { this.fp = fp; this.cfg = cfg; }
    }

    class GameStub {
      constructor(res) { this.res = res; }
    }

    const orig = {
      FileProvider: Lemmings.FileProvider,
      ConfigReader: Lemmings.ConfigReader,
      GameResources: Lemmings.GameResources,
      Game: Lemmings.Game
    };

    setDependency('FileProvider', FileProviderStub);
    setDependency('ConfigReader', ConfigReaderStub);
    setDependency('GameResources', GameResourcesStub);
    setDependency('Game', GameStub);

    const gf = new GameFactory('root');

    const game = await gf.getGame(5);
    expect(game).to.be.instanceOf(GameStub);
    expect(game.res).to.be.instanceOf(GameResourcesStub);
    expect(game.res.cfg).to.equal(mockConfig);
    expect(gf.configReader.calls).to.eql([5]);

    setDependency('FileProvider', orig.FileProvider);
    setDependency('ConfigReader', orig.ConfigReader);
    setDependency('GameResources', orig.GameResources);
    setDependency('Game', orig.Game);
  });

  it('rejects when config is missing', async function () {
    class FileProviderStub {
      constructor(root) { this.root = root; }
      loadString() { return Promise.resolve('[]'); }
    }

    class ConfigReaderStub {
      getConfig() { return Promise.resolve(null); }
    }

    const orig = {
      FileProvider: Lemmings.FileProvider,
      ConfigReader: Lemmings.ConfigReader
    };

    setDependency('FileProvider', FileProviderStub);
    setDependency('ConfigReader', ConfigReaderStub);

    const gf = new GameFactory('root');

    let rejected = false;
    try {
      await gf.getGameResources(1);
    } catch (e) {
      rejected = true;
    }
    expect(rejected).to.be.true;

    setDependency('FileProvider', orig.FileProvider);
    setDependency('ConfigReader', orig.ConfigReader);
  });

  it('records performance measures when enabled', async function () {
    const measures = [];
    const origPerf = globalThis.performance;
    const origLemmings = globalThis.lemmings;
    globalThis.performance = { now: () => 1, measure: (name) => measures.push(name) };
    globalThis.lemmings = { performanceAPI: true, game: { showDebug: false } };

    class FileProviderStub {
      constructor(root) { this.root = root; }
      loadString() { return Promise.resolve('[]'); }
    }
    class ConfigReaderStub {
      getConfig() { return Promise.resolve({ path: 'data', level: {} }); }
    }
    class GameResourcesStub {}
    class GameStub {}

    const orig = {
      FileProvider: Lemmings.FileProvider,
      ConfigReader: Lemmings.ConfigReader,
      GameResources: Lemmings.GameResources,
      Game: Lemmings.Game
    };
    setDependency('FileProvider', FileProviderStub);
    setDependency('ConfigReader', ConfigReaderStub);
    setDependency('GameResources', GameResourcesStub);
    setDependency('Game', GameStub);

    const gf = new GameFactory('root');
    await gf.getGameResources(1);
    await gf.getGame(1, new GameResourcesStub());

    setDependency('FileProvider', orig.FileProvider);
    setDependency('ConfigReader', orig.ConfigReader);
    setDependency('GameResources', orig.GameResources);
    setDependency('Game', orig.Game);
    globalThis.performance = origPerf;
    globalThis.lemmings = origLemmings;

    expect(measures).to.include('GameFactory getGameResources');
    expect(measures).to.include('GameFactory getGame');
  });

  it('swallows performance measurement errors', async function () {
    const origPerf = globalThis.performance;
    const origLemmings = globalThis.lemmings;
    globalThis.performance = { now: () => 1, measure: () => { throw new Error('boom'); } };
    globalThis.lemmings = { performanceAPI: true, game: { showDebug: false } };

    class FileProviderStub {
      constructor(root) { this.root = root; }
      loadString() { return Promise.resolve('[]'); }
    }
    class ConfigReaderStub {
      getConfig() { return Promise.resolve({ path: 'data', level: {} }); }
    }
    class GameResourcesStub {}
    class GameStub {}

    const orig = {
      FileProvider: Lemmings.FileProvider,
      ConfigReader: Lemmings.ConfigReader,
      GameResources: Lemmings.GameResources,
      Game: Lemmings.Game
    };
    setDependency('FileProvider', FileProviderStub);
    setDependency('ConfigReader', ConfigReaderStub);
    setDependency('GameResources', GameResourcesStub);
    setDependency('Game', GameStub);

    const gf = new GameFactory('root');
    await gf.getGameResources(1);
    await gf.getGame(1, new GameResourcesStub());

    setDependency('FileProvider', orig.FileProvider);
    setDependency('ConfigReader', orig.ConfigReader);
    setDependency('GameResources', orig.GameResources);
    setDependency('Game', orig.Game);
    globalThis.performance = origPerf;
    globalThis.lemmings = origLemmings;
  });
});
