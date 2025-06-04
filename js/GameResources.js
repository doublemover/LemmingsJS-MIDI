import { Lemmings } from './LemmingsNamespace.js';
import './LogHandler.js';
import { NodeFileProvider } from '../tools/NodeFileProvider.js';
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
  async _loadCursorBmp(name) {
    try {
      const provider = this.fileProvider instanceof NodeFileProvider
        ? this.fileProvider
        : new NodeFileProvider('.');
      const reader = await provider.loadBinary(
        'src/Data/Cursors/Cursors.zip',
        name
      );
      return GameResources.parseBmp(reader);
    } catch (e) {
      this.log.log(`Failed to load ${name}`, e);
      return null;
    }
  }

  static parseBmp(reader) {
    reader.setOffset(0);
    const sig = String.fromCharCode(reader.readByte()) +
      String.fromCharCode(reader.readByte());
    if (sig !== 'BM') throw new Error('Invalid BMP');
    reader.readIntBE(); // file size
    reader.readIntBE(); // reserved
    const offBits = reader.readIntBE();
    reader.readIntBE(); // header size
    const width = reader.readIntBE();
    const height = reader.readIntBE();
    reader.readWordBE(); // planes
    const bpp = reader.readWordBE();
    if (bpp !== 8) throw new Error('Unsupported BMP depth');
    reader.readIntBE(); // compression
    reader.readIntBE(); // imageSize
    reader.readIntBE(); // xppm
    reader.readIntBE(); // yppm
    reader.readIntBE(); // colors used
    reader.readIntBE(); // important colors
    const palette = new Lemmings.ColorPalette();
    for (let i = 0; i < 256; i++) {
      const b = reader.readByte();
      const g = reader.readByte();
      const r = reader.readByte();
      reader.readByte();
      if (i < 16) palette.setColorRGB(i, r, g, b);
    }
    reader.setOffset(offBits);
    const rowSize = Math.ceil(width / 4) * 4;
    const img = new Lemmings.PaletteImage(width, height);
    const buf = img.getImageBuffer();
    for (let y = height - 1; y >= 0; y--) {
      const rowStart = y * width;
      for (let x = 0; x < width; x++) {
        buf[rowStart + x] = reader.readByte();
      }
      reader.setOffset(reader.getOffset() + rowSize - width);
    }
    img.processTransparentByColorIndex(0);
    return { img, palette, width, height };
  }

  async getCursorSprite() {
    const base = await this._loadCursorBmp('CursorDefault.bmp');
    if (!base) return null;
    const frame = new Lemmings.Frame(base.width, base.height);
    frame.drawPaletteImage(
      base.img.getImageBuffer(),
      base.width,
      base.height,
      base.palette,
      0,
      0
    );
    const highlight = await this._loadCursorBmp('CursorHighlight.bmp');
    if (highlight) {
      frame.drawPaletteImage(
        highlight.img.getImageBuffer(),
        highlight.width,
        highlight.height,
        highlight.palette,
        0,
        0
      );
    }
    return frame;
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