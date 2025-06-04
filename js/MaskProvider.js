import { Lemmings } from './LemmingsNamespace.js';

class MaskProvider {
  constructor(fr) {
    this.maskList = [];
    this.maskList[Lemmings.MaskTypes.BASHING_R] = new Lemmings.MaskList(fr, 16, 10, 4, -8, -10);
    this.maskList[Lemmings.MaskTypes.BASHING_L] = new Lemmings.MaskList(fr, 16, 10, 4, -8, -10);
    this.maskList[Lemmings.MaskTypes.MINING_R] = new Lemmings.MaskList(fr, 16, 13, 2, -8, -12);
    this.maskList[Lemmings.MaskTypes.MINING_L] = new Lemmings.MaskList(fr, 16, 13, 2, -8, -12);
    this.maskList[Lemmings.MaskTypes.EXPLODING] = new Lemmings.MaskList(fr, 16, 22, 1, -8, -14);
    this.maskList[Lemmings.MaskTypes.NUMBERS] = new Lemmings.MaskList(fr, 8, 8, 10, -1, -19);
  }
  GetMask(maskTypes) {
    return this.maskList[maskTypes];
  }
}
Lemmings.MaskProvider = MaskProvider;

export { MaskProvider };
