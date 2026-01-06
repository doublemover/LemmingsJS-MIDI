import { expect } from 'chai';
import { withActionStubs } from './helpers/lemming-actions.js';
import { useGlobalLemmings } from './helpers/lemmings.js';
import { makeManager } from './helpers/lemming-manager.js';
import '../js/render/SolidLayer.js';
import '../js/lemmings/LemmingStateType.js';
import '../js/lemmings/Lemming.js';
import '../js/game/SkillTypes.js';
import '../js/LemmingsBootstrap.js';

describe('LemmingManager extra spawning', function() {
  useGlobalLemmings({ bench: true, extraLemmings: 2, game: { showDebug: false } });

  beforeEach(function() {
    this._restoreActions = withActionStubs();
  });

  afterEach(function() {
    this._restoreActions();
  });

  it('adds extra lemmings and updates spawnTotal', function() {
    const { manager } = makeManager();
    manager.addLemming(1, 1);
    expect(manager.lemmings.length).to.equal(3);
    expect(manager.spawnTotal).to.equal(3);
    for (const lem of manager.lemmings) expect(typeof lem.lookRight).to.equal('boolean');
  });
});
