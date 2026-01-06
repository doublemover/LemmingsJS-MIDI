import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import { ActionBaseSystem } from '../js/actions/ActionBaseSystem.js';
import { MaskProvider } from '../js/render/MaskProvider.js';
import '../js/render/MaskTypes.js';
import '../js/render/MaskList.js';

// Minimal environment for LogHandler
useGlobalLemmings({ game: { showDebug: false } });

describe('ActionBaseSystem mask caching', function() {
  beforeEach(function() {
    ActionBaseSystem.maskCache = new WeakMap();
  });

  it('caches mask lists for identical actions', function() {
    const mp = new MaskProvider(null);
    mp.maskList[Lemmings.MaskTypes.BASHING_L] = { name: 'BL' };
    mp.maskList[Lemmings.MaskTypes.BASHING_R] = { name: 'BR' };

    const a1 = new ActionBaseSystem({
      masks: mp,
      maskTypes: { left: Lemmings.MaskTypes.BASHING_L, right: Lemmings.MaskTypes.BASHING_R },
      actionName: 'bash'
    });
    const a2 = new ActionBaseSystem({
      masks: mp,
      maskTypes: { left: Lemmings.MaskTypes.BASHING_L, right: Lemmings.MaskTypes.BASHING_R },
      actionName: 'bash'
    });

    const cache = ActionBaseSystem.maskCache.get(mp);
    expect(cache.size).to.equal(1);
    expect(a1.masks).to.equal(a2.masks);
    const cached = cache.get('bash');
    expect(cached.get('left')).to.equal(mp.maskList[Lemmings.MaskTypes.BASHING_L]);
    expect(cached.get('right')).to.equal(mp.maskList[Lemmings.MaskTypes.BASHING_R]);
  });

  it('stores separate entries for different mask types', function() {
    const mp = new MaskProvider(null);
    mp.maskList[Lemmings.MaskTypes.BASHING_L] = { name: 'BL' };
    mp.maskList[Lemmings.MaskTypes.BASHING_R] = { name: 'BR' };
    mp.maskList[Lemmings.MaskTypes.MINING_L] = { name: 'ML' };
    mp.maskList[Lemmings.MaskTypes.MINING_R] = { name: 'MR' };

    new ActionBaseSystem({
      masks: mp,
      maskTypes: { left: Lemmings.MaskTypes.BASHING_L, right: Lemmings.MaskTypes.BASHING_R },
      actionName: 'bash'
    });
    new ActionBaseSystem({
      masks: mp,
      maskTypes: { left: Lemmings.MaskTypes.MINING_L, right: Lemmings.MaskTypes.MINING_R },
      actionName: 'mine'
    });

    const cache = ActionBaseSystem.maskCache.get(mp);
    expect(cache.size).to.equal(2);
    const bashEntry = cache.get('bash');
    const mineEntry = cache.get('mine');
    expect(bashEntry.get('left')).to.equal(mp.maskList[Lemmings.MaskTypes.BASHING_L]);
    expect(mineEntry.get('left')).to.equal(mp.maskList[Lemmings.MaskTypes.MINING_L]);
  });
});
