import { Lemmings } from './LemmingsNamespace.js';

class LevelIndexResolve {
        constructor(config) {
            this.config = config;
        }
        resolve(levelMode, levelIndex) {
            let levelOrderList = this.config.level.order;
            if (levelOrderList.length <= levelMode)
                return null;
            if (levelMode < 0)
                return null;
            let levelOrder = levelOrderList[levelMode];
            if (levelOrder.length <= levelIndex)
                return null;
            if (levelIndex < 0)
                return null;
            let levelOrderConfig = levelOrder[levelIndex];
            let liType = new Lemmings.LevelIndexType();
            liType.fileId = Math.abs((levelOrderConfig / 10) | 0);
            liType.partIndex = Math.abs((levelOrderConfig % 10) | 0);
            liType.useOddTable = (levelOrderConfig < 0);
            /// the level number is the sum-index of the level
            let levelNo = 0;
            for (let i = 0; i < levelMode; i++) {
                levelNo += levelOrderList[i].length;
            }
            liType.levelNumber = levelNo + levelIndex;
            return liType;
        }
}
Lemmings.LevelIndexResolve = LevelIndexResolve;

export { LevelIndexResolve };
