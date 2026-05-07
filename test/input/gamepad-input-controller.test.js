import { expect } from 'chai';
import {
  DEFAULT_GAMEPAD_BINDINGS,
  GamepadInputController,
  GamepadBindingRegistry,
  mergeGamepadConfigLayers
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
    removeItem(key) {
      store.delete(key);
    },
    _store: store
  };
};

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

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

  it('keeps persisted overrides above async file defaults', async function () {
    const storage = createStorage();
    storage.setItem('lem-gamepad-bindings-v1', JSON.stringify({
      version: 1,
      bindings: {
        gameplay: {
          togglePause: ['button:0']
        }
      }
    }));
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
      storage,
      fileProvider: {
        loadString() {
          return Promise.resolve(JSON.stringify({
            version: 3,
            bindings: {
              gameplay: {
                togglePause: ['button:1'],
                restartLevel: ['button:3']
              }
            }
          }));
        }
      }
    });

    await flushPromises();

    expect(controller.getDisplayBindings('togglePause')).to.deep.equal(['A / Cross']);
    expect(controller.getDisplayBindings('restartLevel')).to.deep.equal(['Y / Triangle']);
    controller.dispose();
  });

  it('migrates legacy full persisted snapshots into user overrides', async function () {
    const storage = createStorage();
    storage.setItem('lem-gamepad-bindings-v1', JSON.stringify({
      version: 7,
      bindings: {
        gameplay: {
          ...DEFAULT_GAMEPAD_BINDINGS.bindings.gameplay,
          togglePause: ['button:0']
        },
        editor: {
          ...DEFAULT_GAMEPAD_BINDINGS.bindings.editor
        }
      }
    }));
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
      storage,
      fileProvider: {
        loadString() {
          return Promise.resolve(JSON.stringify({
            version: 4,
            bindings: {
              gameplay: {
                restartLevel: ['button:3']
              },
              editor: {
                editorUndo: ['button:1']
              }
            }
          }));
        }
      }
    });

    await flushPromises();

    expect(controller.getDisplayBindings('togglePause')).to.deep.equal(['A / Cross']);
    expect(controller.getDisplayBindings('restartLevel')).to.deep.equal(['Y / Triangle']);
    controller.mode = 'editor';
    expect(controller.getDisplayBindings('editorUndo')).to.deep.equal(['B / Circle']);
    const persisted = JSON.parse(storage.getItem('lem-gamepad-bindings-v1'));
    expect(persisted).to.deep.equal({
      version: 7,
      bindings: {
        gameplay: {
          togglePause: ['button:0']
        }
      }
    });
    controller.dispose();
  });

  it('persists only the user override layer', async function () {
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
      storage,
      fileProvider: {
        loadString() {
          return Promise.resolve(JSON.stringify({
            version: 2,
            bindings: {
              gameplay: {
                restartLevel: ['button:3']
              }
            }
          }));
        }
      }
    });

    await flushPromises();
    controller.setConfig({
      version: 5,
      bindings: {
        gameplay: {
          togglePause: ['button:0']
        }
      }
    });

    const persisted = JSON.parse(storage.getItem('lem-gamepad-bindings-v1'));
    expect(persisted).to.deep.equal({
      version: 5,
      bindings: {
        gameplay: {
          togglePause: ['button:0']
        }
      }
    });
    expect(persisted.bindings.gameplay.restartLevel).to.equal(undefined);
    expect(controller.getDisplayBindings('restartLevel')).to.deep.equal(['Y / Triangle']);
    controller.dispose();
  });

  it('applies non-persisted session overrides without writing storage', function () {
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
      bindings: {
        gameplay: {
          togglePause: ['button:0']
        }
      }
    }, { persist: false });

    expect(storage.getItem('lem-gamepad-bindings-v1')).to.equal(null);
    expect(controller.getDisplayBindings('togglePause')).to.deep.equal(['A / Cross']);
    controller.dispose();
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

  it('merges config layers in default, file, persisted, session order', function () {
    const merged = mergeGamepadConfigLayers(
      { bindings: { gameplay: { togglePause: ['button:1'], restartLevel: ['button:2'] } } },
      { bindings: { gameplay: { togglePause: ['button:3'] } } },
      { bindings: { gameplay: { togglePause: ['button:4'] } } }
    );

    expect(merged.bindings.gameplay.togglePause).to.deep.equal(['button:4']);
    expect(merged.bindings.gameplay.restartLevel).to.deep.equal(['button:2']);
    expect(merged.bindings.gameplay.panLeft).to.deep.equal(['button:14', 'axis:0:-:0.35']);
  });
});
