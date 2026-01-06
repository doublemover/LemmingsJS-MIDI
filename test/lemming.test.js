import { expect } from 'chai';
import { Lemmings, setGlobalLemmings } from './helpers/lemmings.js';
import { withActionStubs } from './helpers/lemming-actions.js';
import { withConsoleStub } from './helpers/console.js';
import { makeManager } from './helpers/lemming-manager.js';
import '../js/render/SolidLayer.js';
import '../js/lemmings/LemmingStateType.js';
import '../js/lemmings/Lemming.js';
import '../js/game/SkillTypes.js';
import '../js/LemmingsBootstrap.js';

describe('LemmingManager', function() {
  beforeEach(function() {
    this.restoreLemmings = setGlobalLemmings({
      bench: false,
      extraLemmings: 0,
      game: { showDebug: true }
    });
    this.restoreActions = withActionStubs();
  });

  afterEach(function() {
    this.restoreActions();
    this.restoreLemmings();
  });

  it('logs state changes when lemmings transition actions', function() {
    const { manager } = makeManager();

    class StubAction {
      constructor(name, next) { this.name = name; this.next = next; }
      getActionName() { return this.name; }
      triggerLemAction() { return false; }
      process() { return this.next; }
    }

    const fallAction = new StubAction('fall', Lemmings.LemmingStateType.WALKING);
    const walkAction = new StubAction('walk', Lemmings.LemmingStateType.NO_STATE_TYPE);

    manager.actions[Lemmings.LemmingStateType.FALLING] = fallAction;
    manager.actions[Lemmings.LemmingStateType.WALKING] = walkAction;

    const restoreConsole = withConsoleStub({ log: () => {} });

    manager.addLemming(5, 5);
    expect(manager.lemmings.length).to.equal(1);

    manager.tick();

    restoreConsole();

    const lem = manager.getLemming(0);
    expect(lem.action).to.equal(walkAction);
  });
});
