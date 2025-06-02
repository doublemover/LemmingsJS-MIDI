import { Lemmings } from './LemmingsNamespace.js';

class LevelLoader {
  constructor(fileProvider, config) {
      this.fileProvider = fileProvider;
      this.config = config;
      this.levelIndexResolve = new Lemmings.LevelIndexResolve(config);
  }

  async getLevel (levelMode, levelIndex) {
    let level, levelReader;

    // ----------------------------------------------------------------------- //
    // 1 · Resolve the level-table entry and download the core .DAT             //
    // ----------------------------------------------------------------------- //
    const levelInfo = this.levelIndexResolve.resolve(levelMode, levelIndex);
    if (levelInfo == null) return null;

    const useOddTable   = levelInfo.useOddTable && this.config.level.useOddTable;
    const paddedFileId  = ('0000' + levelInfo.fileId).slice(-3);   

    const baseLevel     = this.fileProvider.loadBinary(
                          this.config.path,
                          this.config.level.filePrefix + paddedFileId + '.DAT');

    const oddTableBuf   = useOddTable ? this.fileProvider.loadBinary(this.config.path, 'ODDTABLE.DAT') : null;

    const [levelDat, oddBuf] = await Promise.all([baseLevel, oddTableBuf]);

    // ----------------------------------------------------------------------- //
    // 2 · Parse header and build Level shell                                  //
    // ----------------------------------------------------------------------- //
    const levelsContainer = new Lemmings.FileContainer(levelDat);
    levelReader           = new Lemmings.LevelReader(
                               levelsContainer.getPart(levelInfo.partIndex));

    level                      = new Lemmings.Level(
                                     levelReader.levelWidth,
                                     levelReader.levelHeight);
    level.gameType             = this.config.gametype;
    level.levelIndex           = levelIndex;
    level.levelMode            = levelMode;
    level.screenPositionX      = levelReader.screenPositionX;
    level.isSuperLemming       = levelReader.isSuperLemming;

    let levelProperties        = levelReader.levelProperties;
    if (useOddTable && oddBuf) {
      const oddTable           = new Lemmings.OddTableReader(oddBuf);
      levelProperties          = oddTable.getLevelProperties(levelInfo.levelNumber);
    }

    level.name         = levelProperties.levelName;
    level.releaseRate  = levelProperties.releaseRate;
    level.releaseCount = levelProperties.releaseCount;
    level.needCount    = levelProperties.needCount;
    level.timeLimit    = levelProperties.timeLimit;
    level.skills       = levelProperties.skills;

    // ----------------------------------------------------------------------- //
    // 3 · Fetch graphics set(s) in parallel                                   //
    // ----------------------------------------------------------------------- //
    const vgagrFile    = this.fileProvider.loadBinary(
                         this.config.path, `VGAGR${levelReader.graphicSet1}.DAT`);
    const groundFile   = this.fileProvider.loadBinary(
                         this.config.path, `GROUND${levelReader.graphicSet1}O.DAT`);
    const vgaspecFile  = (levelReader.graphicSet2 !== 0) ? this.fileProvider.loadBinary(this.config.path, `VGASPEC${levelReader.graphicSet2 - 1}.DAT`) : null;

    const [vgagrBuf, groundBuf, vgaspecBuf] =
      await Promise.all([vgagrFile, groundFile, vgaspecFile]);

    // ----------------------------------------------------------------------- //
    // 4 · Decode terrain / objects and render background                      //
    // ----------------------------------------------------------------------- //
    const vgaContainer = new Lemmings.FileContainer(vgagrBuf);
    const groundReader = new Lemmings.GroundReader(
                             groundBuf,
                             vgaContainer.getPart(0),
                             vgaContainer.getPart(1));

    const render = new Lemmings.GroundRenderer();
    if (vgaspecBuf) {
      const spec = new Lemmings.VGASpecReader(
                     vgaspecBuf, level.width, level.height);
      render.createVgaspecMap(levelReader, spec);
    } else {
      render.createGroundMap(levelReader, groundReader.getTerrainImages());
    }

    // ----------------------------------------------------------------------- //
    // 5 · Wire everything into the Level instance                             //
    // ----------------------------------------------------------------------- //
    level.setGroundImage(render.img.getData());
    level.setGroundMaskLayer(
        new Lemmings.SolidLayer(level.width, level.height, render.img.mask));

    level.setMapObjects(levelReader.objects, groundReader.getObjectImages());
    level.setPalettes(groundReader.colorPalette, groundReader.groundPalette);

    level.setSteelAreas(levelReader.steel);
    level.newSetSteelAreas(levelReader, groundReader.getTerrainImages()); 

    return level;  
  }
}

Lemmings.LevelLoader = LevelLoader;
export { LevelLoader };
