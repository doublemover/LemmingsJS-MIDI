import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/GameConfig.js';
import '../js/LevelConfig.js';
import '../js/GameTypes.js';
import { ConfigReader } from '../js/ConfigReader.js';
import { packMechanics } from '../js/packMechanics.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('ConfigReader mechanics merge', function () {
  it('applies pack defaults to GameConfig', async function () {
    const json = JSON.stringify([
      {
        name: 'lemmings',
        path: 'lemmings',
        gametype: 'LEMMINGS',
        'level.filePrefix': 'LEVEL',
        'level.groups': ['Fun'],
        'level.useOddTable': false,
        'level.order': [[0]]
      }
    ]);

    const cr = new ConfigReader(Promise.resolve(json));
    const cfg = await cr.getConfig(Lemmings.GameTypes.LEMMINGS);
    expect(cfg.mechanics).to.eql(packMechanics.lemmings);
  });

  it('overrides defaults from config', async function () {
    const json = JSON.stringify([
      {
        name: 'lemmings',
        path: 'lemmings',
        gametype: 'LEMMINGS',
        mechanics: { bomberAssist: true },
        'level.filePrefix': 'LEVEL',
        'level.groups': ['Fun'],
        'level.useOddTable': false,
        'level.order': [[0]]
      }
    ]);

    const cr = new ConfigReader(Promise.resolve(json));
    const cfg = await cr.getConfig(Lemmings.GameTypes.LEMMINGS);
    const expected = { ...packMechanics.lemmings, bomberAssist: true };
    expect(cfg.mechanics).to.eql(expected);
  });
});
