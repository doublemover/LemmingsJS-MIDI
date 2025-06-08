import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LemmingStateType.js';
import { KeyboardShortcuts } from '../js/KeyboardShortcuts.js';

globalThis.lemmings = { game: { showDebug: false } };

describe('KeyboardShortcuts _instantNuke', function () {
  it('ignores lemmings already set to explode', function () {
    const explodingAction = {};
    const ohnoAction = {};
    const lemmingsList = [
      { removed: false, action: {}, setAction() {} },
      { removed: false, action: {}, countdownAction: {}, setAction() {} },
      { removed: true, action: null, setAction() {} },
      { removed: false, action: explodingAction, setAction() {} },
      { removed: false, action: ohnoAction, setAction() {} }
    ];
    const manager = {
      lemmings: lemmingsList,
      actions: {
        [Lemmings.LemmingStateType.EXPLODING]: explodingAction,
        [Lemmings.LemmingStateType.OHNO]: ohnoAction
      },
      setLemmingState(lem) {
        lem.calls = (lem.calls || 0) + 1;
        lem.action = explodingAction;
      }
    };
    const game = { getLemmingManager() { return manager; } };
    const view = { game };
    const ks = new KeyboardShortcuts(view);

    ks._instantNuke();
    ks._instantNuke();

    expect(lemmingsList[0].calls).to.equal(1);
    expect(lemmingsList[1].calls).to.be.undefined;
    expect(lemmingsList[2].calls).to.be.undefined;
    expect(lemmingsList[3].calls).to.be.undefined;
    expect(lemmingsList[4].calls).to.be.undefined;
  });

  it('ignores lemmings that have already exploded', function () {
    const explodingAction = {};
    const lemmingsList = [
      { removed: false, action: {}, setAction() {}, hasExploded: true },
      { removed: false, action: {}, setAction() {} }
    ];
    const manager = {
      lemmings: lemmingsList,
      actions: { [Lemmings.LemmingStateType.EXPLODING]: explodingAction },
      setLemmingState(lem) {
        lem.calls = (lem.calls || 0) + 1;
        lem.action = explodingAction;
      }
    };
    const game = { getLemmingManager() { return manager; } };
    const view = { game };
    const ks = new KeyboardShortcuts(view);

    ks._instantNuke();

    expect(lemmingsList[0].calls).to.be.undefined;
    expect(lemmingsList[1].calls).to.equal(1);
  });
});
