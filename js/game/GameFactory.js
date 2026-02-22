import { ConfigReader } from '../data/ConfigReader.js';
import { FileProvider } from '../data/FileProvider.js';
import { Game } from './Game.js';
import { GameResources } from './GameResources.js';
import { getDependency, getAppContext } from '../core/dependencies.js';

const getApp = () => {
  const app = getAppContext();
  if (app) return app;
  if (typeof globalThis !== 'undefined' && globalThis.lemmings) return globalThis.lemmings;
  if (typeof lemmings !== 'undefined') return lemmings;
  return null;
};

class GameFactory {
  constructor(rootPath) {
    this.rootPath = rootPath;
    const Provider = getDependency('FileProvider', FileProvider);
    this.fileProvider = new Provider(rootPath);
    let configFileReader = this.fileProvider.loadString('config.json');
    const Reader = getDependency('ConfigReader', ConfigReader);
    this.configReader = new Reader(configFileReader);
  }
  /** return a game object to control/run the game */
  async getGame(gameType, gameResources = null) {
    const app = getApp();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      typeof performance !== 'undefined' &&
      typeof performance.measure === 'function' &&
      typeof performance.now === 'function';
    const perfStart = perfEnabled ? performance.now() : 0;
    const finish = () => {
      if (!perfEnabled) return;
      try {
        performance.measure('GameFactory getGame', {
          start: perfStart,
          detail: { devtools: { track: 'GameFactory', trackGroup: 'Load', color: 'primary', tooltipText: 'getGame' } }
        });
      } catch {
        /* ignored */
      }
    };
    try {
      if (gameResources) {
        const GameCtor = getDependency('Game', Game);
        return new GameCtor(gameResources);
      }
      const res = await this.getGameResources(gameType);
      const GameCtor = getDependency('Game', Game);
      return new GameCtor(res);
    } finally {
      finish();
    }
  }
  /** return the config of a game type */
  getConfig(gameType) {
    return this.configReader.getConfig(gameType);
  }
  /** return a Game Resources that gives access to images, maps, sounds  */
  async getGameResources(gameType) {
    const app = getApp();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      typeof performance !== 'undefined' &&
      typeof performance.measure === 'function' &&
      typeof performance.now === 'function';
    const perfStart = perfEnabled ? performance.now() : 0;
    const finish = () => {
      if (!perfEnabled) return;
      try {
        performance.measure('GameFactory getGameResources', {
          start: perfStart,
          detail: { devtools: { track: 'GameFactory', trackGroup: 'Load', color: 'secondary', tooltipText: 'getGameResources' } }
        });
      } catch {
        /* ignored */
      }
    };
    try {
      const config = await this.configReader.getConfig(gameType);
      if (config === null || config === undefined) {
        throw new Error('Game config not found');
      }
      const Resources = getDependency('GameResources', GameResources);
      return new Resources(this.fileProvider, config);
    } finally {
      finish();
    }
  }

  /** create and load a game from a provided config */
  async createFromConfig(config, groupIndex = 0, levelIndex = 0) {
    const Resources = getDependency('GameResources', GameResources);
    const GameCtor = getDependency('Game', Game);
    const res = new Resources(this.fileProvider, config);
    const game = new GameCtor(res);
    await game.loadLevel(groupIndex, levelIndex);
    return game;
  }
}
export { GameFactory };
