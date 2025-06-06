import { Lemmings } from './LemmingsNamespace.js';

class GameFactory {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.fileProvider = new Lemmings.FileProvider(rootPath);
    let configFileReader = this.fileProvider.loadString('config.json');
    this.configReader = new Lemmings.ConfigReader(configFileReader);
  }
  /** return a game object to control/run the game */
  getGame(gameType, gameResources = null) {
    return new Promise((resolve, reject) => {
      if (gameResources) {
        resolve(new Lemmings.Game(gameResources));
        return;
      }
      this.getGameResources(gameType)
        .then((res) => resolve(new Lemmings.Game(res)))
        .catch(reject);
    });
  }
  /** return the config of a game type */
  getConfig(gameType) {
    return this.configReader.getConfig(gameType);
  }
  /** return a Game Resources that gives access to images, maps, sounds  */
  getGameResources(gameType) {
    return new Promise((resolve, reject) => {
      this.configReader.getConfig(gameType).then((config) => {
        if (config == null) {
          reject();
          return;
        }
        resolve(new Lemmings.GameResources(this.fileProvider, config));
      });
    });
  }

  /** create and load a game from a provided config */
  async createFromConfig(config, groupIndex = 0, levelIndex = 0) {
    const res = new Lemmings.GameResources(this.fileProvider, config);
    const game = new Lemmings.Game(res);
    await game.loadLevel(groupIndex, levelIndex);
    return game;
  }
}
Lemmings.GameFactory = GameFactory;

export { GameFactory };
