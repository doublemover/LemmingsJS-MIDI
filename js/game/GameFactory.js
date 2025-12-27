import { ConfigReader } from '../data/ConfigReader.js';
import { FileProvider } from '../data/FileProvider.js';
import { Game } from './Game.js';
import { GameResources } from './GameResources.js';
import { getDependency } from '../core/dependencies.js';

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
  getGame(gameType, gameResources = null) {
    const perfEnabled = typeof lemmings !== 'undefined' &&
      (lemmings.performanceAPI === true || lemmings.perfMetrics === true) &&
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
    return new Promise((resolve, reject) => {
      if (gameResources) {
        const GameCtor = getDependency('Game', Game);
        resolve(new GameCtor(gameResources));
        return;
      }
      this.getGameResources(gameType)
        .then((res) => {
          const GameCtor = getDependency('Game', Game);
          resolve(new GameCtor(res));
        })
        .catch(reject);
    }).finally(finish);
  }
  /** return the config of a game type */
  getConfig(gameType) {
    return this.configReader.getConfig(gameType);
  }
  /** return a Game Resources that gives access to images, maps, sounds  */
  getGameResources(gameType) {
    const perfEnabled = typeof lemmings !== 'undefined' &&
      (lemmings.performanceAPI === true || lemmings.perfMetrics === true) &&
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
    return new Promise((resolve, reject) => {
      this.configReader.getConfig(gameType).then((config) => {
        if (config == null) {
          reject();
          return;
        }
        const Resources = getDependency('GameResources', GameResources);
        resolve(new Resources(this.fileProvider, config));
      });
    }).finally(finish);
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
