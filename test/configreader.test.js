import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import { ConfigReader } from '../js/ConfigReader.js';

// silence debug
globalThis.lemmings = { game: { showDebug: false } };

describe('ConfigReader', function () {
  it('returns configs containing mechanics', async function () {
    const json = `[
      { "name": "t", "path": "p", "gametype": "LEMMINGS",
        "mechanics": { "fallDistance": 50 },
        "level.filePrefix": "LEVEL", "level.groups": ["Fun"],
        "level.order": [[0]], "level.useOddTable": false }
    ]`;
    const reader = new ConfigReader(Promise.resolve(json));
    const cfg = await reader.getConfig(Lemmings.GameTypes.LEMMINGS);
    expect(cfg.mechanics).to.deep.equal({ fallDistance: 50 });
  });
});
