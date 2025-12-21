import { expect } from 'chai';
import { Lemmings, setDependency } from './helpers/lemmings.js';
import { GameFactory } from '../js/game/GameFactory.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('GameFactory.createFromConfig', function () {
  it('builds a Game with GameResources and timer', async function () {
    class FileProviderStub {
      constructor(root) { this.root = root; }
      loadString() { return Promise.resolve('[]'); }
    }
    class ConfigReaderStub {
      constructor() {}
      getConfig() {}
    }
    class GameResourcesStub {
      constructor(fp, cfg) { this.fp = fp; this.cfg = cfg; }
      async getLevel() { return { timeLimit: 5, colorPalette: null, triggers: [], objects: [] }; }
      async getMasks() { return []; }
      async getLemmingsSprite() { return null; }
      async getSkillPanelSprite() { return null; }
    }
    class GameTimerStub {}
    class GameStub {
      constructor(res) { this.res = res; this.loadArgs = []; this.gameTimer = null; }
      async loadLevel(g, i) {
        this.loadArgs = [g, i];
        this.gameTimer = new Lemmings.GameTimer({});
        return this;
      }
    }

    const orig = {
      FileProvider: Lemmings.FileProvider,
      ConfigReader: Lemmings.ConfigReader,
      GameResources: Lemmings.GameResources,
      Game: Lemmings.Game,
      GameTimer: Lemmings.GameTimer
    };

    setDependency('FileProvider', FileProviderStub);
    setDependency('ConfigReader', ConfigReaderStub);
    setDependency('GameResources', GameResourcesStub);
    setDependency('Game', GameStub);
    setDependency('GameTimer', GameTimerStub);

    const config = { path: 'data', level: {} };
    const gf = new GameFactory('root');
    const game = await gf.createFromConfig(config, 1, 2);

    expect(game).to.be.instanceOf(GameStub);
    expect(game.res).to.be.instanceOf(GameResourcesStub);
    expect(game.res.fp).to.be.instanceOf(FileProviderStub);
    expect(game.res.cfg).to.equal(config);
    expect(game.loadArgs).to.eql([1, 2]);
    expect(game.gameTimer).to.be.instanceOf(GameTimerStub);

    setDependency('FileProvider', orig.FileProvider);
    setDependency('ConfigReader', orig.ConfigReader);
    setDependency('GameResources', orig.GameResources);
    setDependency('Game', orig.Game);
    setDependency('GameTimer', orig.GameTimer);
  });
});
