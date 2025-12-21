import { BaseLogger } from '../util/LogHandler.js';
import { GameConfig } from '../game/GameConfig.js';
import { GameTypes } from '../game/GameTypes.js';
import { packMechanics } from '../level/packMechanics.js';

class ConfigReader extends BaseLogger {
  constructor(configFile) {
    super();
    this.configs = new Promise((resolve, reject) => {
      configFile.then((jsonString) => {
        let configJson = this.parseConfig(jsonString);
        resolve(configJson);
      });
    });
  }
  /** return the game config for a given GameType */
  getConfig(gameType) {
    if (gameType == 0) {
      this.log.log('tried to get gametype 0?');
      return;
    }
    return new Promise((resolve, reject) => {
      this.configs.then((configs) => {
        const config = configs.find((config) => config.gametype == gameType);
        if (config == null) {
          this.log.log('config for GameTypes:' + GameTypes.toString(gameType) + ' not found!');
          reject();
          return;
        }
        resolve(config);
      });
    });
  }
  /** parse the config file */
  parseConfig(jsonData) {
    let gameConfigs = [];
    let config = null;
    try {
      config = JSON.parse(jsonData);
    } catch (e) {
      this.log.log('Unable to parse config', e);
      return gameConfigs;
    }
    /// for all game types
    const configLength = config.length;
    for (let c = 0; c < configLength; c++) {
      let newConfig = new GameConfig();
      let configData = config[c];
      newConfig.name = configData.name;
      newConfig.path = configData.path;
      newConfig.gametype = GameTypes[configData.gametype];
      /// read level config
      const oddFlag = configData['level.useOddTable'];
      const oddFlagLegacy = configData['level.useoddtable'];
      if (oddFlag != null) {
        newConfig.level.useOddTable = !!oddFlag;
      } else if (oddFlagLegacy != null) {
        newConfig.level.useOddTable = !!oddFlagLegacy;
      }
      if (configData.mechanics != null) {
        newConfig.mechanics = configData.mechanics;
      }
      newConfig.level.order = configData['level.order'];
      newConfig.level.filePrefix = configData['level.filePrefix'];
      newConfig.level.groups = configData['level.groups'];
      const defaults = packMechanics[newConfig.path] || {};
      const overrides = configData.mechanics || {};
      newConfig.mechanics = { ...defaults, ...overrides };
      gameConfigs.push(newConfig);
    }
    return gameConfigs;
  }
}
export { ConfigReader };
