import { Lemmings } from './LemmingsNamespace.js';

class LevelConfig {
        constructor() {
            /** file Prefix used in the filename of the level-file */
            this.filePrefix = "LEVEL";
            /** use the odd-table-file */
            this.useOddTable = false;
            /** the names of the level groups */
            this.groups = [];
            /** sort order of the levels for each group
             *   every entry is a number where:
             *     ->  (FileId * 10 + FilePart) * (useOddTabelEntry? -1 : 1)
             */
            this.order = [];
        }
        getGroupLength(groupIndex) {
            if ((groupIndex < 0) || (groupIndex > this.order.length)) {
                return 0;
            }
            return this.order[groupIndex].length;
        }
    }
    Lemmings.LevelConfig = LevelConfig;

export { LevelConfig };
