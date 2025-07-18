import { expect } from 'chai';
import fs from 'fs';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';
import '../js/GameConfig.js';
import '../js/LevelConfig.js';
import '../js/GameTypes.js';
import { ConfigReader } from '../js/ConfigReader.js';
import { packMechanics } from '../js/packMechanics.js';

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

    const jsonDefault = `[
      { "name": "t", "path": "lemmings", "gametype": "LEMMINGS",
        "level.filePrefix": "LEVEL", "level.groups": ["Fun"],
        "level.order": [[0]], "level.useOddTable": false }
    ]`;
    const cr = new ConfigReader(Promise.resolve(jsonDefault));
    const cfgDefault = await cr.getConfig(Lemmings.GameTypes.LEMMINGS);
    expect(cfgDefault.mechanics).to.eql(packMechanics.lemmings);
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

  it('parses the Oh No pack from config.json', async function () {
    const json = fs.readFileSync('config.json', 'utf8');
    const reader = new ConfigReader(Promise.resolve(json));
    const cfg = await reader.getConfig(Lemmings.GameTypes.OHNO);
    expect(cfg.path).to.equal('lemmings_ohNo');
    expect(cfg.gametype).to.equal(Lemmings.GameTypes.OHNO);
    expect(cfg.level.filePrefix).to.equal('DLVEL');
    expect(cfg.level.groups).to.eql([
      'Tame',
      'Crazy',
      'Wild',
      'Wicked',
      'Havoc'
    ]);
    expect(cfg.mechanics).to.eql(packMechanics.lemmings_ohNo);
  });
});
