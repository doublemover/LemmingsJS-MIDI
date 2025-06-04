import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { ActionBaseSystem } from '../js/ActionBaseSystem.js';
import { MaskProvider } from '../js/MaskProvider.js';
import '../js/MaskTypes.js';
import '../js/MaskList.js';

// Minimal environment for LogHandler
globalThis.lemmings = { game: { showDebug: false } };

describe('ActionBaseSystem mask caching', function() {
  beforeEach(function() {
    ActionBaseSystem.maskCache.clear();
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

    expect(ActionBaseSystem.maskCache.size).to.equal(1);
    expect(a1.masks).to.equal(a2.masks);
    const cached = ActionBaseSystem.maskCache.get('bash');
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

    expect(ActionBaseSystem.maskCache.size).to.equal(2);
    const bashEntry = ActionBaseSystem.maskCache.get('bash');
    const mineEntry = ActionBaseSystem.maskCache.get('mine');
    expect(bashEntry.get('left')).to.equal(mp.maskList[Lemmings.MaskTypes.BASHING_L]);
    expect(mineEntry.get('left')).to.equal(mp.maskList[Lemmings.MaskTypes.MINING_L]);
  });
});
