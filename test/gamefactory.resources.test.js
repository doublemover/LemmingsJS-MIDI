import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { GameFactory } from '../js/GameFactory.js';

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

    Lemmings.FileProvider = FileProviderStub;
    Lemmings.ConfigReader = ConfigReaderStub;
    Lemmings.GameResources = GameResourcesStub;
    Lemmings.Game = GameStub;

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

    Lemmings.FileProvider = orig.FileProvider;
    Lemmings.ConfigReader = orig.ConfigReader;
    Lemmings.GameResources = orig.GameResources;
    Lemmings.Game = orig.Game;
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

    Lemmings.FileProvider = FileProviderStub;
    Lemmings.ConfigReader = ConfigReaderStub;
    Lemmings.GameResources = GameResourcesStub;
    Lemmings.Game = GameStub;

    const gf = new GameFactory('root');

    const game = await gf.getGame(5);
    expect(game).to.be.instanceOf(GameStub);
    expect(game.res).to.be.instanceOf(GameResourcesStub);
    expect(game.res.cfg).to.equal(mockConfig);
    expect(gf.configReader.calls).to.eql([5]);

    Lemmings.FileProvider = orig.FileProvider;
    Lemmings.ConfigReader = orig.ConfigReader;
    Lemmings.GameResources = orig.GameResources;
    Lemmings.Game = orig.Game;
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

    Lemmings.FileProvider = FileProviderStub;
    Lemmings.ConfigReader = ConfigReaderStub;

    const gf = new GameFactory('root');

    let rejected = false;
    try {
      await gf.getGameResources(1);
    } catch (e) {
      rejected = true;
    }
    expect(rejected).to.be.true;

    Lemmings.FileProvider = orig.FileProvider;
    Lemmings.ConfigReader = orig.ConfigReader;
  });
});
