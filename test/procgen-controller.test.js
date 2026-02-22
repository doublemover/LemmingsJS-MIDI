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
    expect(left).to.deep.equal({ dx: 3, type: TriggerTypes.DROWN });
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
});
