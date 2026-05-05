import { expect } from 'chai';
import { ProcgenController } from '../js/app/procgenController.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';

describe('ProcgenController', function () {
  it('finds nearest hazard trigger in both scan directions', function () {
    const level = {
      triggers: [
        { type: TriggerTypes.TRAP, x1: 22, x2: 26, y1: 0, y2: 12 },
        { type: TriggerTypes.FRYING, x1: 15, x2: 16, y1: 0, y2: 12 },
        { type: TriggerTypes.DROWN, x1: 7, x2: 9, y1: 0, y2: 12 },
        { type: TriggerTypes.EXIT_LEVEL, x1: 13, x2: 14, y1: 0, y2: 12 }
      ]
    };
    const controller = new ProcgenController({ level });
    controller._rebuildHazardIndex();

    const right = controller._findHazardAhead(12, 6, 20, 1);
    expect(right).to.deep.equal({ dx: 3, type: TriggerTypes.FRYING });

    const left = controller._findHazardAhead(12, 6, 20, -1);
    expect(left).to.deep.equal({ dx: 4, type: TriggerTypes.DROWN });
  });

  it('prunes stale tracking state and offscreen gap backlog', function () {
    const manager = {
      lemmings: [{ id: 1, removed: false, disabled: false }]
    };
    const controller = new ProcgenController({
      game: { getLemmingManager: () => manager },
      level: {}
    });
    controller.fallEventMemoryTicks = 40;
    controller._cameraX = 300;
    controller._seenFalls.set(1, 145);
    controller._seenFalls.set(2, 10);
    controller._aiLemmingCooldown.set(1, 170);
    controller._aiLemmingCooldown.set(2, 20);
    controller._aiStallState.set(2, { stallTicks: 99 });
    controller._gaps = [
      { x: 20, width: 6, assigned: false },
      { x: 180, width: 8, assigned: true }
    ];

    controller._pruneTrackingState(150);

    expect(controller._seenFalls.has(1)).to.equal(true);
    expect(controller._seenFalls.has(2)).to.equal(false);
    expect(controller._aiLemmingCooldown.has(1)).to.equal(true);
    expect(controller._aiLemmingCooldown.has(2)).to.equal(false);
    expect(controller._aiStallState.has(2)).to.equal(false);
    expect(controller._gaps).to.have.length(1);
    expect(controller._gaps[0].x).to.equal(180);
  });

  it('cleans up obsolete gaps even when no lemmings are present', function () {
    const manager = { lemmings: [] };
    const controller = new ProcgenController({
      game: { getLemmingManager: () => manager },
      level: {}
    });
    controller._cameraX = 260;
    controller._gaps = [
      { x: 8, width: 4, assigned: false },
      { x: 120, width: 12, assigned: false }
    ];

    controller._processGapBridges();

    expect(controller._gaps).to.have.length(1);
    expect(controller._gaps[0].x).to.equal(120);
  });

  it('uses injected rng streams for deterministic procgen decisions', function () {
    const sequence = [0.1, 0.9, 0.2, 0.75, 0.33];
    let index = 0;
    const controller = new ProcgenController({
      level: { width: 200, height: 80 },
      options: {
        rng: () => sequence[(index++) % sequence.length]
      }
    });
    index = 0;

    expect(controller._randInt(1, 10)).to.equal(2);
    const plan = controller._seedStructurePlan();
    expect(plan.type).to.equal('staircase');
    expect(plan.remaining).to.equal(5);
    expect(plan.step).to.equal(3);
    expect(plan.direction).to.equal(-1);
  });

  it('advances and compacts gap scan cursor for large backlogs', function () {
    const controller = new ProcgenController({ level: {} });
    controller._gaps = Array.from({ length: 600 }, (_, i) => ({
      x: i * 5,
      width: 3,
      assigned: false
    }));

    controller._pruneGapQueue(2200);

    expect(controller._gapScanStart).to.equal(0);
    expect(controller._gaps.length).to.be.lessThan(600);
    expect(controller._gaps[0].x).to.be.at.least(2000);
  });

  it('reuses scan-cache results inside a single AI decision window', function () {
    let gapDepthCalls = 0;
    let wallHeightCalls = 0;
    const ground = {
      getColumnGapDepth() {
        gapDepthCalls += 1;
        return 1;
      },
      getColumnWallHeight() {
        wallHeightCalls += 1;
        return 0;
      }
    };
    const controller = new ProcgenController({
      level: {
        height: 80,
        groundMask: ground,
        triggers: []
      }
    });
    const lemming = { x: 40, y: 50, lookRight: true };

    controller._beginScanCacheWindow(100);
    controller._scanAhead(lemming);
    const firstGapCalls = gapDepthCalls;
    const firstWallCalls = wallHeightCalls;

    controller._scanAhead(lemming);
    expect(gapDepthCalls).to.equal(firstGapCalls);
    expect(wallHeightCalls).to.equal(firstWallCalls);

    controller._beginScanCacheWindow(101);
    controller._scanAhead(lemming);
    expect(gapDepthCalls).to.be.greaterThan(firstGapCalls);
    expect(wallHeightCalls).to.be.greaterThan(firstWallCalls);
  });
});
