import { BaseLogger } from './LogHandler.js';
import { ColorPalette } from './ColorPalette.js';
import { FileContainer } from './FileContainer.js';
import { Frame } from './Frame.js';
import { getDependency } from './core/dependencies.js';
import { LemmingsSprite } from './LemmingsSprite.js';
import { LevelLoader } from './LevelLoader.js';
import { MaskProvider } from './MaskProvider.js';
import { PaletteImage } from './PaletteImage.js';
import { SkillPanelSprites } from './SkillPanelSprites.js';

class GameResources extends BaseLogger {
  constructor(fileProvider, config) {
    super();
    this.fileProvider = fileProvider;
    this.config = config;
    /** mechanics settings for gameplay */
    this.mechanics = config.mechanics || {};
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
          const Container = getDependency('FileContainer', FileContainer);
          const mainParts = new Container(data);
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
        const Sprite = getDependency('LemmingsSprite', LemmingsSprite);
        const sprite = new Sprite(container.getPart(0), colorPalette);
        resolve(sprite);
      });
    });
  }
  getSkillPanelSprite(colorPalette) {
    return new Promise((resolve, reject) => {
      this.getMainDat().then((container) => {
        const PanelSprites = getDependency('SkillPanelSprites', SkillPanelSprites);
        resolve(new PanelSprites(container.getPart(2), container.getPart(6), colorPalette));
      });
    });
  }
  getCursorSprite() {
    return new Promise((resolve) => {
      this.getMainDat().then((container) => {
        const fr = container.getPart(5);
        const Palette = getDependency('PaletteImage', PaletteImage);
        const pimg = new Palette(14, 14);
        pimg.processImage(fr, 1);
        pimg.processTransparentByColorIndex(0);
        const PaletteCtor = getDependency('ColorPalette', ColorPalette);
        const pal = new PaletteCtor();
        pal.setColorRGB(1, 255, 255, 255);
        resolve(pimg.createFrame(pal));
      });
    });
  }
  getMasks() {
    return new Promise((resolve, reject) => {
      this.getMainDat().then((container) => {
        const Provider = getDependency('MaskProvider', MaskProvider);
        resolve(new Provider(container.getPart(1)));
      });
    });
  }
  /** return the Level Data for a given Level-Index */
  getLevel(levelMode, levelIndex) {
    const Loader = getDependency('LevelLoader', LevelLoader);
    const levelReader = new Loader(this.fileProvider, this.config);
    return levelReader.getLevel(levelMode, levelIndex);
  }
  /** return the level group names for this game */
  getLevelGroups() {
    return this.config.level.groups;
  }
}
export { GameResources };
