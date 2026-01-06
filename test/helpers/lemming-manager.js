import { Level } from '../../js/level/Level.js';
import { LemmingManager } from '../../js/lemmings/LemmingManager.js';
import { GameVictoryCondition } from '../../js/game/GameVictoryCondition.js';

const spriteStub = {
  getAnimation() {
    return { frames: [], getFrame() { return {}; } };
  }
};

const maskStub = {
  GetMask() {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0, at() { return 0; } };
  }
};

const triggerStub = { trigger() { return 0; }, removeByOwner() {} };
const particleStub = {};

const makeManager = ({
  width = 10,
  height = 10,
  entrances = [{ x: 0, y: 0 }],
  releaseCount,
  releaseRate,
  levelInit
} = {}) => {
  const level = new Level(width, height);
  level.entrances = entrances;
  if (releaseCount !== undefined) level.releaseCount = releaseCount;
  if (releaseRate !== undefined) level.releaseRate = releaseRate;
  if (levelInit) levelInit(level);
  const gvc = new GameVictoryCondition(level);
  const manager = new LemmingManager(level, spriteStub, triggerStub, gvc, maskStub, particleStub);
  return { level, gvc, manager };
};

export { spriteStub, maskStub, triggerStub, particleStub, makeManager };
