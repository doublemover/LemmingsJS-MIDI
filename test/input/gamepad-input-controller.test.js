import { expect } from 'chai';
import {
  GamepadInputController,
  GamepadBindingRegistry
} from '../../js/input/GamepadInputController.js';

const createButton = (pressed = false, value = null) => ({
  pressed: !!pressed,
  value: value == null ? (pressed ? 1 : 0) : value
});

const createPad = ({
  buttons = [],
  axes = [],
  connected = true
} = {}) => ({
  connected,
  buttons,
  axes
});

const createStorage = () => {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    _store: store
  };
};

describe('GamepadInputController', function () {
  it('routes button and axis bindings with held-action semantics', function () {
    const rafCallbacks = [];
    const windowStub = {
      requestAnimationFrame(callback) {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      },
      cancelAnimationFrame() {}
    };
    const pads = [
      createPad({
        buttons: Array.from({ length: 17 }, () => createButton(false)),
        axes: [0, 0, 0, 0]
      })
    ];
    const navigatorStub = {
      getGamepads() {
        return pads;
      }
    };
    const calls = [];
    const controller = new GamepadInputController({
      mode: 'gameplay',
      window: windowStub,
      navigator: navigatorStub,
      onAction(action, type) {
        calls.push(`${action}:${type}`);
      }
    });

    const step = () => {
      const cb = rafCallbacks.shift();
      expect(cb).to.be.a('function');
      cb();
    };

    step();
    expect(calls).to.deep.equal([]);

    pads[0].buttons[14].pressed = true;
    pads[0].buttons[14].value = 1;
    step();
    expect(calls).to.deep.equal(['panLeft:down']);

    pads[0].axes[0] = -0.9;
    step();
    expect(calls).to.deep.equal(['panLeft:down']);

    pads[0].buttons[14].pressed = false;
    pads[0].buttons[14].value = 0;
    step();
    expect(calls).to.deep.equal(['panLeft:down']);

    pads[0].axes[0] = 0;
    step();
    expect(calls).to.deep.equal(['panLeft:down', 'panLeft:up']);

    controller.dispose();
  });

  it('persists remapped configs and reloads persisted bindings', function () {
    const storage = createStorage();
    const windowStub = {
      requestAnimationFrame() { return 1; },
      cancelAnimationFrame() {}
    };
    const navigatorStub = {
      getGamepads() {
        return [];
      }
    };
    const controller = new GamepadInputController({
      mode: 'gameplay',
      window: windowStub,
      navigator: navigatorStub,
      storage
    });

    controller.setConfig({
      version: 2,
      bindings: {
        gameplay: {
          togglePause: ['button:0']
        }
      }
    });
    const persisted = storage.getItem('lem-gamepad-bindings-v1');
    expect(persisted).to.be.a('string');
    controller.dispose();

    const restored = new GamepadInputController({
      mode: 'gameplay',
      window: windowStub,
      navigator: navigatorStub,
      storage
    });
    expect(restored.getDisplayBindings('togglePause')).to.deep.equal(['A / Cross']);
    restored.dispose();
  });
});

describe('GamepadBindingRegistry', function () {
  it('normalizes and exposes specs for gameplay/editor actions', function () {
    const registry = new GamepadBindingRegistry({
      version: 1,
      bindings: {
        gameplay: {
          togglePause: ['button:9', 'axis:3:-:0.25']
        },
        editor: {
          editorUndo: ['button:6']
        }
      }
    });

    const gameplay = registry.getBindingsForAction('gameplay', 'togglePause');
    expect(gameplay).to.have.lengthOf(2);
    expect(gameplay[0].kind).to.equal('button');
    expect(gameplay[1].kind).to.equal('axis');

    const compiledEditor = registry.getCompiledBindings('editor');
    expect(compiledEditor.some(entry => entry.action === 'editorUndo')).to.equal(true);
  });
});
