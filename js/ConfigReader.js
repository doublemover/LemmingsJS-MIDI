import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';

class ConfigReader extends Lemmings.BaseLogger {
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
      this.log.log('tried to get gametype 0?')
      return;
    }
    return new Promise((resolve, reject) => {
      this.configs.then((configs) => {
        const config = configs.find((config) => config.gametype == gameType);
        if (config == null) {
          this.log.log('config for GameTypes:' + Lemmings.GameTypes.toString(gameType) + ' not found!');
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
      let newConfig = new Lemmings.GameConfig();
      let configData = config[c];
      newConfig.name = configData.name;
      newConfig.path = configData.path;
      newConfig.gametype = Lemmings.GameTypes[configData.gametype];
      /// read level config
      if (configData['level.useoddtable'] != null) {
        newConfig.level.useOddTable = (!!configData['level.useoddtable']);
      }
      newConfig.level.order = configData['level.order'];
      newConfig.level.filePrefix = configData['level.filePrefix'];
      newConfig.level.groups = configData['level.groups'];
      gameConfigs.push(newConfig);
    }
    return gameConfigs;
  }
}
Lemmings.ConfigReader = ConfigReader;

export { ConfigReader };
