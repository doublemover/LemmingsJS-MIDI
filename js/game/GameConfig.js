import { GameTypes } from './GameTypes.js';
import { LevelConfig } from '../level/LevelConfig.js';

class GameConfig {
  constructor() {
    /** Name of the Lemmings Game */
    this.name = '';
    /** Path/Url to the resources */
    this.path = '';
    this.spriteSkin = null;
    this.characterCatalog = null;
    /** unique GameType Name */
    this.gametype = GameTypes.UNKNOWN;
    this.level = new LevelConfig();
    /** mechanics customization */
    this.mechanics = {};
  }
}
export { GameConfig };
