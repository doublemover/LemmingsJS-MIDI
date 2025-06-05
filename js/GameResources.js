import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';
import './Frame.js';

class GameResources extends Lemmings.BaseLogger {
  constructor(fileProvider, config) {
    super();
    this.fileProvider = fileProvider;
    this.config = config;
    this.mainDat = null;
  }
  /** return the main.dat file container */
  getMainDat() {
    if (this.mainDat != null) {
      return this.mainDat;
    }
    this.mainDat = new Promise((resolve, reject) => {
      this.fileProvider.loadBinary(this.config.path, 'MAIN.DAT')
        .then((data) => {
          // split the file
          const mainParts = new Lemmings.FileContainer(data);
          resolve(mainParts);
        })
        .catch((e) => {
          this.log.log('Failed to load MAIN.DAT', e);
          reject(e);
        });
    });
    return this.mainDat;
  }
  getLemmingsSprite(colorPalette) {
    return new Promise((resolve, reject) => {
      this.getMainDat().then((container) => {
        const sprite = new Lemmings.LemmingsSprite(container.getPart(0), colorPalette);
        resolve(sprite);
      });
    });
  }
  getSkillPanelSprite(colorPalette) {
    return new Promise((resolve, reject) => {
      this.getMainDat().then((container) => {
        resolve(new Lemmings.SkillPanelSprites(container.getPart(2), container.getPart(6), colorPalette));
      });
    });
  }
  getCursorSprite() {
    return new Promise((resolve) => {
      this.getMainDat().then((container) => {
        const fr = container.getPart(5);
        const pimg = new Lemmings.PaletteImage(17, 17);
        pimg.processImage(fr, 1);
        pimg.processTransparentByColorIndex(0);
        const pal = new Lemmings.ColorPalette();
        pal.setColorRGB(1, 255, 255, 255);
        resolve(pimg.createFrame(pal));
      });
    });
  }
  getMasks() {
    return new Promise((resolve, reject) => {
      this.getMainDat().then((container) => {
        resolve(new Lemmings.MaskProvider(container.getPart(1)));
      });
    });
  }
  /** return the Level Data for a given Level-Index */
  getLevel(levelMode, levelIndex) {
    const levelReader = new Lemmings.LevelLoader(this.fileProvider, this.config);
    return levelReader.getLevel(levelMode, levelIndex);
  }
  /** return the level group names for this game */
  getLevelGroups() {
    return this.config.level.groups;
  }
}
Lemmings.GameResources = GameResources;

export { GameResources };
