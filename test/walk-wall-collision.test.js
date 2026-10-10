import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import '../js/render/SolidLayer.js';
import '../js/lemmings/LemmingStateType.js';
import '../js/lemmings/Lemming.js';
import { Level } from '../js/level/Level.js';
import { ActionWalkSystem } from '../js/actions/ActionWalkSystem.js';

// minimal global for logging


describe('ActionWalkSystem wall collision', function() {
  useGlobalLemmings({ game: { showDebug: false } });

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
  it('preserves authored left and right bounces and moves away on the next tick', () => {
    for (const right of [true, false]) {
      const action = new ActionWalkSystem(null), level = new Level(24, 24);
      for (let x = 0; x < 24; x++) level.groundMask.setGroundAt(x, 16);
      for (let y = 9; y <= 16; y++) level.groundMask.setGroundAt(12, y);
      const actor = new Lemmings.Lemming(right ? 11 : 13, 16); actor.lookRight = right;
      action.process(level, actor); expect(actor.x).to.equal(right ? 11 : 13); expect(actor.lookRight).to.equal(!right);
      action.process(level, actor); expect(actor.x).to.equal(right ? 10 : 14); expect(actor.lookRight).to.equal(!right);
    }
  });
  it('walks a shallow corner and enters a partially dug tunnel using the authored mask', () => {
    for (const right of [true, false]) {
      for (const tunnel of [true, false]) {
        const action = new ActionWalkSystem(null), level = new Level(24, 24);
        for (let x = 0; x < 24; x++) level.groundMask.setGroundAt(x, 16);
        if (tunnel) for (let y = 6; y <= 8; y++) level.groundMask.setGroundAt(12, y);
        else for (let y = 14; y <= 16; y++) level.groundMask.setGroundAt(12, y);
        const actor = new Lemmings.Lemming(right ? 11 : 13, 16); actor.lookRight = right;
        const result = action.process(level, actor);
        expect(actor.x).to.equal(12); expect(actor.lookRight).to.equal(right); expect(actor.y).to.equal(tunnel ? 16 : 14);
        expect(result).to.equal(Lemmings.LemmingStateType.NO_STATE_TYPE);
      }
    }
  });

});
