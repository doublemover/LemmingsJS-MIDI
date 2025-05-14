import { Lemmings } from './LemmingsNamespace.js';

export const GameStateTypes = Object.freeze({
  UNKNOWN: 0, RUNNING: 1, FAILED_OUT_OF_TIME: 2, FAILED_LESS_LEMMINGS: 3, SUCCEEDED: 4
});

Lemmings.GameStateTypes = GameStateTypes;