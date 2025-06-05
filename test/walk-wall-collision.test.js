import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/SolidLayer.js';
import '../js/LemmingStateType.js';
import '../js/Lemming.js';
import { Level } from '../js/Level.js';
import { ActionWalkSystem } from '../js/ActionWalkSystem.js';

// minimal global for logging
globalThis.lemmings = { game: { showDebug: false } };

describe('ActionWalkSystem wall collision', function() {
  it('reverts position when walking into a wall', function() {
    const spriteStub = { getAnimation() { return { frames: [] }; } };
    const walkAction = new ActionWalkSystem(spriteStub);
    const level = new Level(20, 20);

    // floor at y=10
    for (let x = 0; x < 20; x++) level.groundMask.setGroundAt(x, 10);
    // vertical wall at x=6 from y=3 to 10
    for (let y = 3; y <= 10; y++) level.groundMask.setGroundAt(6, y);

    const lem = new Lemmings.Lemming(5, 10);
    lem.lookRight = true;

    const result = walkAction.process(level, lem);

    expect(lem.x).to.equal(5);
    expect(lem.lookRight).to.equal(false);
    expect(result).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
  });
});
