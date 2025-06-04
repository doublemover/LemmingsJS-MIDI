import { Lemmings } from './LemmingsNamespace.js';

/**
 * Default glitch mechanic flags for each level pack.
 * These values can be overridden via config.json.
 */
export const packMechanics = {
  lemmings: {
    classicBuilder: true,
    bomberAssist: false
  },
  lemmings_ohNo: {
    classicBuilder: true,
    bomberAssist: false
  },
  xmas91: {
    classicBuilder: true,
    bomberAssist: false
  },
  xmas92: {
    classicBuilder: true,
    bomberAssist: false
  },
  holiday93: {
    classicBuilder: false,
    bomberAssist: true
  },
  holiday94: {
    classicBuilder: false,
    bomberAssist: true
  }
};

Lemmings.packMechanics = packMechanics;

export default packMechanics;
