import { Lemmings } from './LemmingsNamespace.js';

class GameConfig {
  constructor() {
    /** Name of the Lemmings Game */
    this.name = '';
    /** Path/Url to the resources */
    this.path = '';
    /** unique GameType Name */
    this.gametype = Lemmings.GameTypes.UNKNOWN;
    this.level = new Lemmings.LevelConfig();
    /** mechanics customization */
    this.mechanics = {};
  }
}
Lemmings.GameConfig = GameConfig;

export { GameConfig };
