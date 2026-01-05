import { expect } from 'chai';
import fs from 'fs';
import { Lemmings } from './helpers/lemmings.js';
import '../js/util/LogHandler.js';
import '../js/game/GameConfig.js';
import '../js/level/LevelConfig.js';
import '../js/game/GameTypes.js';
import { ConfigReader } from '../js/data/ConfigReader.js';
import { packMechanics } from '../js/level/packMechanics.js';

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

  it('returns empty configs on parse errors', function () {
    const reader = new ConfigReader(Promise.resolve('bad json'));
    const parsed = reader.parseConfig('bad json');
    expect(parsed).to.eql([]);
  });

  it('returns undefined for gameType 0', async function () {
    const reader = new ConfigReader(Promise.resolve('[]'));
    const result = await reader.getConfig(0);
    expect(result).to.equal(undefined);
  });

  it('rejects when loading config fails', async function () {
    const err = new Error('boom');
    const reader = new ConfigReader(Promise.reject(err));
    try {
      await reader.configs;
      expect.fail('expected rejection');
    } catch (caught) {
      expect(caught).to.equal(err);
    }
  });

  it('rejects when config is missing and handles legacy odd table flag', async function () {
    const json = JSON.stringify([
      {
        name: 'lemmings',
        path: 'lemmings',
        gametype: 'LEMMINGS',
        'level.filePrefix': 'LEVEL',
        'level.groups': ['Fun'],
        'level.useoddtable': true,
        'level.order': [[0]]
      }
    ]);
    const reader = new ConfigReader(Promise.resolve(json));
    const cfg = await reader.getConfig(Lemmings.GameTypes.LEMMINGS);
    expect(cfg.level.useOddTable).to.equal(true);
    try {
      await reader.getConfig(Lemmings.GameTypes.OHNO);
      expect.fail('expected rejection');
    } catch (e) {
      expect(e).to.be.instanceOf(Error);
      expect(e.message).to.equal('Game config not found');
    }
  });
});
