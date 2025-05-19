import { Lemmings } from './LemmingsNamespace.js';

class LevelLoader {
        constructor(fileProvider, config) {
            this.fileProvider = fileProvider;
            this.config = config;
            this.levelIndexResolve = new Lemmings.LevelIndexResolve(config);
        }
        /** return the map and it's config */
        getLevel(levelMode, levelIndex) {
            let level;
            let levelReader;
            return new Promise((resolve, reject) => {
                let levelInfo = this.levelIndexResolve.resolve(levelMode, levelIndex);
                if (levelInfo == null) {
                    resolve(null);
                    return;
                }
                let useOddTable = levelInfo.useOddTable && this.config.level.useOddTable;
                let promiseList = [];
                let paddedFileId = ("0000" + levelInfo.fileId).slice(-3);
                promiseList.push(this.fileProvider.loadBinary(this.config.path, this.config.level.filePrefix + paddedFileId + ".DAT"));
                if (useOddTable) {
                    promiseList.push(this.fileProvider.loadBinary(this.config.path, "ODDTABLE.DAT"));
                }
                Promise.all(promiseList)
                    .then((files) => {
                        /// read the level metadata
                        let levelsContainer = new Lemmings.FileContainer(files[0]);
                        levelReader = new Lemmings.LevelReader(levelsContainer.getPart(levelInfo.partIndex));
                        level = new Lemmings.Level(levelReader.levelWidth, levelReader.levelHeight);
                        level.gameType = this.config.gametype;
                        level.levelIndex = levelIndex;
                        level.levelMode = levelMode;
                        level.screenPositionX = levelReader.screenPositionX;
                        level.isSuperLemming = levelReader.isSuperLemming;
                        /// default level properties
                        let levelProperties = levelReader.levelProperties;
                        /// switch level properties to oddTable config
                        if (useOddTable) {
                            let oddTable = new Lemmings.OddTableReader(files[1]);
                            levelProperties = oddTable.getLevelProperties(levelInfo.levelNumber);
                        }
                        level.name = levelProperties.levelName;
                        level.releaseRate = levelProperties.releaseRate;
                        level.releaseCount = levelProperties.releaseCount;
                        level.needCount = levelProperties.needCount;
                        level.timeLimit = levelProperties.timeLimit;
                        level.skills = levelProperties.skills;
                        let fileList = [];
                        /// load level ground
                        fileList.push(this.fileProvider.loadBinary(this.config.path, "VGAGR" + levelReader.graphicSet1 + ".DAT"));
                        fileList.push(this.fileProvider.loadBinary(this.config.path, "GROUND" + levelReader.graphicSet1 + "O.DAT"));
                        if (levelReader.graphicSet2 != 0) {
                            /// this is a Image Map
                            fileList.push(this.fileProvider.loadBinary(this.config.path, "VGASPEC" + (levelReader.graphicSet2 - 1) + ".DAT"));
                        }
                        return Promise.all(fileList);
                    })
                    .then((fileList) => {
                        let goundFile = fileList[1];
                        let vgaContainer = new Lemmings.FileContainer(fileList[0]);
                        /// read the images used for the map and for the objects of the map
                        let groundReader = new Lemmings.GroundReader(goundFile, vgaContainer.getPart(0), vgaContainer.getPart(1));
                        /// render the map background image
                        let render = new Lemmings.GroundRenderer();
                        if (fileList.length > 2) {
                            /// use a image for this map background
                            let VGASpecReader = new Lemmings.VGASpecReader(fileList[2], level.width, level.height);
                            render.createVgaspecMap(levelReader, VGASpecReader);
                        } else {
                            /// this is a normal map background
                            render.createGroundMap(levelReader, groundReader.getTerrainImages());
                        }
                        level.setGroundImage(render.img.getData());
                        level.setGroundMaskLayer(new Lemmings.SolidLayer(level.width, level.height, render.img.mask));
                        level.setMapObjects(levelReader.objects, groundReader.getObjectImages());
                        level.setPalettes(groundReader.colorPalette, groundReader.groundPalette);
                        level.setSteelAreas(levelReader.steel);
                        resolve(level);
                    });
            });
        }
    }
    Lemmings.LevelLoader = LevelLoader;

export { LevelLoader };
