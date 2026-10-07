import { BaseLogger } from '../util/LogHandler.js';
import { ColorPalette } from '../render/ColorPalette.js';
import { FileContainer } from '../data/FileContainer.js';
import { Frame } from '../render/Frame.js';
import { getDependency } from '../core/dependencies.js';
import { LemmingsSprite } from '../lemmings/LemmingsSprite.js';
import { CharacterSpriteSet } from '../lemmings/CharacterSpriteSet.js';
import { PixelSpriteSkin } from '../lemmings/PixelSpriteSkin.js';
import { LevelLoader } from '../level/LevelLoader.js';
import { MaskProvider } from '../render/MaskProvider.js';
import { PaletteImage } from '../render/PaletteImage.js';
import { SkillPanelSprites } from '../render/SkillPanelSprites.js';

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
    if (this.mainDat !== null) {
      return this.mainDat;
    }
    this.mainDat = this._loadMainDat();
    return this.mainDat;
  }
  async _loadMainDat() {
    try {
      const data = await this.fileProvider.loadBinary(this.config.path, 'MAIN.DAT');
      const Container = getDependency('FileContainer', FileContainer);
      return new Container(data);
    } catch (e) {
      this.mainDat = null;
      this.log.log('Failed to load MAIN.DAT', e);
      throw e;
    }
  }
  async getLemmingsSprite(colorPalette) {
    const base = await this._getBaseLemmingsSprite(colorPalette);
    if (!this.config.characterCatalog) return base;
    try {
      const text = await this.fileProvider.loadString(this.config.characterCatalog);
      const sprites = new CharacterSpriteSet(base, JSON.parse(text), path => this.fileProvider.loadString(path));
      await sprites.prepare();
      this.characterSprites = sprites;
      return sprites;
    } catch (error) {
      this.log.log('Character catalog unavailable', error);
      const sprites = new CharacterSpriteSet(base, null, path => this.fileProvider.loadString(path));
      sprites.catalogError = `Character catalog unavailable: ${error.message}`;
      await sprites.prepare();
      this.characterSprites = sprites;
      return sprites;
    }
  }
  async _getBaseLemmingsSprite(colorPalette) {
    const skinPath = this.config.spriteSkin;
    if (skinPath) {
      if (typeof skinPath !== 'string') throw new Error('spriteSkin must be a manifest path');
      if (!this._spriteSkinPromise || this._spriteSkinPath !== skinPath) {
        this._spriteSkinPath = skinPath;
        const pending = Promise.resolve()
          .then(() => this.fileProvider.loadString(skinPath))
          .then(text => new PixelSpriteSkin(JSON.parse(text)))
          .catch(error => {
            if (this._spriteSkinPromise === pending) this._spriteSkinPromise = null;
            throw new Error(`Unable to load sprite skin ${skinPath}: ${error.message}`);
          });
        this._spriteSkinPromise = pending;
      }
      return this._spriteSkinPromise;
    }
    const container = await this.getMainDat();
    const Sprite = getDependency('LemmingsSprite', LemmingsSprite);
    return new Sprite(container.getPart(0), colorPalette);
  }
  async getSkillPanelSprite(colorPalette) {
    const container = await this.getMainDat();
    const PanelSprites = getDependency('SkillPanelSprites', SkillPanelSprites);
    return new PanelSprites(container.getPart(2), container.getPart(6), colorPalette);
  }
  async getCursorSprite() {
    const container = await this.getMainDat();
    const fr = container.getPart(5);
    const Palette = getDependency('PaletteImage', PaletteImage);
    const pimg = new Palette(14, 14);
    pimg.processImage(fr, 1);
    pimg.processTransparentByColorIndex(0);
    const PaletteCtor = getDependency('ColorPalette', ColorPalette);
    const pal = new PaletteCtor();
    pal.setColorRGB(1, 255, 255, 255);
    return pimg.createFrame(pal);
  }
  async getMasks() {
    const container = await this.getMainDat();
    const Provider = getDependency('MaskProvider', MaskProvider);
    return new Provider(container.getPart(1));
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
