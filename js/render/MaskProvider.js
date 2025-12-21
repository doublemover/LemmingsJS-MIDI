import { MaskList } from './MaskList.js';
import { MaskTypes } from './MaskTypes.js';

class MaskProvider {
  constructor(fr) {
    this.maskList = [];
    this.maskList[MaskTypes.BASHING_R] = new MaskList(fr, 16, 10, 4, -8, -10);
    this.maskList[MaskTypes.BASHING_L] = new MaskList(fr, 16, 10, 4, -8, -10);
    this.maskList[MaskTypes.MINING_R] = new MaskList(fr, 16, 13, 2, -8, -12);
    this.maskList[MaskTypes.MINING_L] = new MaskList(fr, 16, 13, 2, -8, -12);
    this.maskList[MaskTypes.EXPLODING] = new MaskList(fr, 16, 22, 1, -8, -14);
    this.maskList[MaskTypes.NUMBERS] = new MaskList(fr, 8, 8, 10, -1, -19);
  }
  GetMask(maskTypes) {
    return this.maskList[maskTypes];
  }
}
export { MaskProvider };
