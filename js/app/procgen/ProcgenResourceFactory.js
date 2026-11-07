import { GameFactory } from '../../game/GameFactory.js';
import { getDependency } from '../../core/dependencies.js';

export function createProcgenResourceFactory({ rootPath = './', Factory = getDependency('GameFactory', GameFactory) } = {}) {
  if (typeof rootPath !== 'string' || !rootPath || rootPath.length > 2048 || typeof Factory !== 'function') throw new TypeError('ProcGen resources require their configured source root and factory.');
  return new Factory(rootPath);
}
