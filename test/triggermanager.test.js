import { expect } from 'chai';
import { useGlobalLemmings } from './helpers/lemmings.js';
import '../js/util/LogHandler.js';
import '../js/render/ColorPalette.js';
import '../js/render/Frame.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerManager } from '../js/level/TriggerManager.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

useGlobalLemmings({ game: { showDebug: false } });

describe('TriggerManager', function () {
  it('handles bucketed triggers and removal', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);

    const a = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5, 0, -1, { id: 'a' });
    const b = new Trigger(TriggerTypes.FRYING, 20, 1, 23, 5, 0, -1, { id: 'b' });
    const c = new Trigger(TriggerTypes.DROWN, 20, 20, 22, 22, 0, -1, { id: 'c' });
    tm.addRange([a, b, c]);

    expect(tm._grid[0].includes(a)).to.be.true;
    expect(tm._grid[1].includes(b)).to.be.true;
    expect(tm._grid[3].includes(c)).to.be.true;

    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.TRAP);
    expect(tm.trigger(21, 2)).to.equal(TriggerTypes.FRYING);
    expect(tm.trigger(21, 21)).to.equal(TriggerTypes.DROWN);
    expect(tm.trigger(2, 21)).to.equal(TriggerTypes.NO_TRIGGER);

    tm.removeByOwner(a.owner);
    expect(tm._grid[0].includes(a)).to.be.false;
    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.NO_TRIGGER);
  });

  it('removes all same-owner triggers without skipping swap-pop entries', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 63, 31, 16);
    const owner = { id: 'shared-owner' };
    const a = new Trigger(TriggerTypes.BLOCKER_LEFT, 1, 1, 5, 5, 0, -1, owner);
    const b = new Trigger(TriggerTypes.BLOCKER_RIGHT, 20, 1, 25, 5, 0, -1, owner);
    tm.addRange([a, b]);

    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.BLOCKER_LEFT);
    expect(tm.trigger(22, 2)).to.equal(TriggerTypes.BLOCKER_RIGHT);

    tm.removeByOwner(owner);

    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(22, 2)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm._ownerTriggers.has(owner)).to.equal(false);
    expect(tm._triggers.size).to.equal(0);
  });

  it('cleans up owner triggers without touching other owners or leaving stale grid refs', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 63, 31, 16);
    const ownerA = { id: 'owner-a' };
    const ownerB = { id: 'owner-b' };
    const a1 = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5, 0, -1, ownerA);
    const a2 = new Trigger(TriggerTypes.FRYING, 18, 1, 25, 5, 0, -1, ownerA);
    const b1 = new Trigger(TriggerTypes.DROWN, 34, 1, 40, 5, 0, -1, ownerB);
    tm.addRange([a1, a2, b1]);

    tm.removeByOwner(ownerA);

    expect(tm._ownerTriggers.has(ownerA)).to.equal(false);
    expect(tm._ownerTriggers.has(ownerB)).to.equal(true);
    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(20, 2)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(36, 2)).to.equal(TriggerTypes.DROWN);

    for (const bucket of tm._grid) {
      for (const trigger of bucket) {
        expect(trigger.owner).to.not.equal(ownerA);
      }
    }

    tm.removeByOwner(ownerA);
    expect(tm.trigger(36, 2)).to.equal(TriggerTypes.DROWN);
    expect(tm._triggers.size).to.equal(1);
  });

  it('reuses debug frame', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);
    const tr = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5);
    tm.add(tr);

    const g = {
      drawRectCalls: [],
      drawFrameCalls: [],
      drawRect (...args) { this.drawRectCalls.push(args); },
      drawFrame (frame, x, y) { this.drawFrameCalls.push({ frame, x, y }); }
    };

    tm.renderDebug(g);
    const first = tm._debugFrame;
    expect(g.drawFrameCalls[0].frame).to.equal(first);

    g.drawFrameCalls = [];
    tm.renderDebug(g);
    expect(g.drawFrameCalls[0].frame).to.equal(first);
    expect(tm._debugFrame).to.equal(first);
  });

  it('returns NO_TRIGGER when outside bounds', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);
    const tr = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5);
    tm.add(tr);

    expect(tm.trigger(-1, 0)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(0, -1)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(31, 1)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(32, 1)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(1, 31)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(1, 32)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(2, 2)).to.equal(TriggerTypes.TRAP);
  });

  it('uses real level dimensions and half-open trigger bounds', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 2000, 240, 16);
    const tr = new Trigger(TriggerTypes.TRAP, 1700, 200, 1710, 210);
    tm.add(tr);

    expect(tm.trigger(1705, 205)).to.equal(TriggerTypes.TRAP);
    expect(tm.trigger(1709, 209)).to.equal(TriggerTypes.TRAP);
    expect(tm.trigger(1710, 209)).to.equal(TriggerTypes.NO_TRIGGER);
    expect(tm.trigger(1709, 210)).to.equal(TriggerTypes.NO_TRIGGER);
  });

  it('colors cells based on state in renderDebug', function () {
    const timer = { tick: 5, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);

    const tr = new Trigger(TriggerTypes.TRAP, 20, 20, 23, 23);
    tm.add(tr);

    tm._lastHitTick[0] = 5;
    tm._lastCheckTick[1] = 5;

    const g = { calls: [], drawRect (...args) { this.calls.push(args); }, drawFrame () {} };

    tm.renderDebug(g);

    expect(g.calls).to.deep.equal([
      [0, 0, 15, 15, 255, 0, 0],
      [16, 0, 15, 15, 255, 255, 255],
      [0, 16, 15, 15, 128, 128, 128],
      [16, 16, 15, 15, 0, 0, 255]
    ]);
  });

  it('ignores duplicate triggers and empty ranges', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);
    const tr = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5);
    tm.add(tr);
    tm.add(tr);
    tm.addRange([]);
    expect(tm._triggers.size).to.equal(1);
  });

  it('skips arrow triggers in debug frame', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);
    const arrow = new Trigger(TriggerTypes.ONEWAY_LEFT, 1, 1, 5, 5);
    const trap = new Trigger(TriggerTypes.TRAP, 10, 10, 12, 12);
    tm.addRange([arrow, trap]);
    const g = { drawRect() {}, drawFrame() {} };
    tm.renderDebug(g);
    expect(tm._debugFrame).to.be.ok;
  });

  it('records history on add/remove when available', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const calls = { add: [], remove: [] };
    const tm = new TriggerManager(timer, 31, 31, 16, {
      history: {
        recordTriggerAdd(trigger, snapshot) { calls.add.push({ trigger, snapshot }); },
        recordTriggerRemove(trigger, snapshot) { calls.remove.push({ trigger, snapshot }); }
      }
    });
    const owner = { id: 7 };
    const tr = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5, 0, 2, owner);
    tm.add(tr);
    tm.removeByOwner(owner);

    expect(calls.add).to.have.length(1);
    expect(calls.add[0].snapshot.ownerId).to.equal(7);
    expect(calls.remove).to.have.length(1);

  });

  it('records null owner ids in history snapshots', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const calls = { add: [], remove: [] };
    const tm = new TriggerManager(timer, 31, 31, 16, {
      history: {
        recordTriggerAdd(trigger, snapshot) { calls.add.push({ trigger, snapshot }); },
        recordTriggerRemove(trigger, snapshot) { calls.remove.push({ trigger, snapshot }); }
      }
    });
    const tr = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5);
    tm.add(tr);
    tm.removeByOwner(null);

    expect(calls.add[0].snapshot.ownerId).to.equal(null);
    expect(calls.remove[0].snapshot.ownerId).to.equal(null);

  });

  it('runs observer triggers without blocking gameplay triggers', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const cases = [
      ['gameplay-first', (tm, gameplay, observer) => { tm.add(gameplay); tm.addObserver(observer); }],
      ['observer-first', (tm, gameplay, observer) => { tm.addObserver(observer); tm.add(gameplay); }]
    ];

    for (const [name, register] of cases) {
      const calls = [];
      const tm = new TriggerManager(timer, 31, 31, 16);
      const gameplay = new Trigger(TriggerTypes.EXIT_LEVEL, 1, 1, 5, 5, 0, -1, { id: `${name}:exit` });
      const observer = new Trigger(TriggerTypes.NO_TRIGGER, 1, 1, 5, 5, 0, -1, {
        id: `${name}:observer`,
        onTrigger(tick, lemming, trigger, x, y) {
          calls.push({ tick, x, y, trigger });
        }
      });
      register(tm, gameplay, observer);

      expect(tm.trigger(2, 2), name).to.equal(TriggerTypes.EXIT_LEVEL);
      expect(calls).to.have.length(1);
      expect(calls[0]).to.include({ tick: 0, x: 2, y: 2 });
    }
  });

  it('keeps observer cooldown independent from gameplay resolution', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);
    const calls = [];
    const observer = new Trigger(TriggerTypes.NO_TRIGGER, 1, 1, 5, 5, 5, -1, {
      id: 'observer',
      onTrigger(tick) {
        calls.push(tick);
      }
    });
    const gameplay = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5, 0, -1, { id: 'trap' });
    tm.addObserver(observer);
    tm.add(gameplay);

    expect(tm.trigger(2, 2, null, 0)).to.equal(TriggerTypes.TRAP);
    expect(tm.trigger(2, 2, null, 1)).to.equal(TriggerTypes.TRAP);
    expect(tm.trigger(2, 2, null, 4)).to.equal(TriggerTypes.TRAP);
    expect(tm.trigger(2, 2, null, 5)).to.equal(TriggerTypes.TRAP);
    expect(calls).to.eql([0, 5]);

    tm.removeByOwner(gameplay.owner);
    expect(tm.trigger(2, 2, null, 6)).to.equal(TriggerTypes.NO_TRIGGER);
  });

  it('dispose clears references', function () {
    const timer = { tick: 0, getGameTicks () { return this.tick; } };
    const tm = new TriggerManager(timer, 31, 31, 16);
    const tr = new Trigger(TriggerTypes.TRAP, 1, 1, 5, 5);
    tm.add(tr);
    tm.renderDebug({ drawRect() {}, drawFrame() {} });

    tm.dispose();

    expect(tm.gameTimer).to.equal(null);
    expect(tm._grid).to.equal(null);
    expect(tm._triggers).to.equal(null);
    expect(tm._debugFrame).to.equal(null);

    // should not throw
    tm.removeByOwner(tr.owner);
  });
});
