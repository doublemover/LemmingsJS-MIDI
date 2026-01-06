import { expect } from 'chai';
import { setGlobalLemmings } from './helpers/lemmings.js';
import { withActionStubs } from './helpers/lemming-actions.js';
import { makeManager } from './helpers/lemming-manager.js';
import '../js/render/SolidLayer.js';
import '../js/lemmings/LemmingStateType.js';
import '../js/lemmings/Lemming.js';
import '../js/game/SkillTypes.js';
import '../js/LemmingsBootstrap.js';

// enable debug logging for Logger
beforeEach(function() {
  this.restoreLemmings = setGlobalLemmings({
    bench: false,
    extraLemmings: 0,
    game: { showDebug: false }
  });
  this.restoreActions = withActionStubs();
});

afterEach(function() {
  this.restoreActions();
  this.restoreLemmings();
});

describe('LemmingManager.getNearestLemming', function() {
  it('returns the closest lemming or null', function() {
    const { manager } = makeManager({ width: 100, height: 100 });

    manager.addLemming(10, 10);
    manager.addLemming(50, 50);

    const lem1 = manager.lemmings[0];
    const lem2 = manager.lemmings[1];

    expect(manager.getNearestLemming(10, 10)).to.equal(lem1);
    expect(manager.getNearestLemming(52, 50)).to.equal(lem2);
    expect(manager.getNearestLemming(7, 8)).to.equal(lem1);
    expect(manager.getNearestLemming(100, 100)).to.equal(null);
  });
});
