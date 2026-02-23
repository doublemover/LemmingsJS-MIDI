import { expect } from 'chai';
import { EditorKeybindings } from '../../js/input/EditorKeybindings.js';
import { EditorTools } from '../../js/editor/EditorTools.js';

describe('EditorKeybindings', function () {
  let originalWindowDescriptor;
  let originalNavigatorDescriptor;

  beforeEach(function () {
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const listeners = new Map();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: {
        addEventListener(type, handler) {
          listeners.set(type, handler);
        },
        removeEventListener(type) {
          listeners.delete(type);
        },
        requestAnimationFrame() {
          return 1;
        },
        cancelAnimationFrame() {},
        _listeners: listeners
      }
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        getGamepads() {
          return [];
        }
      }
    });
  });

  afterEach(function () {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }
  });

  it('binds and disposes key listeners', function () {
    const keybindings = new EditorKeybindings({ setTool() {} });
    keybindings.bind();
    expect(globalThis.window._listeners.has('keydown')).to.equal(true);
    keybindings.dispose();
    expect(globalThis.window._listeners.has('keydown')).to.equal(false);
    expect(keybindings.gamepad).to.equal(null);
  });

  it('ignores key events from editable targets', function () {
    const keybindings = new EditorKeybindings({ setTool() {} });
    expect(keybindings._shouldIgnoreKey({ target: { isContentEditable: true } })).to.equal(true);
    expect(keybindings._shouldIgnoreKey({ target: { tagName: 'input' } })).to.equal(true);
    expect(keybindings._shouldIgnoreKey({ target: { tagName: 'textarea' } })).to.equal(true);
    expect(keybindings._shouldIgnoreKey({ target: { tagName: 'div' } })).to.equal(false);
  });

  it('maps keyboard actions to editor callbacks and prevents defaults', function () {
    const toolChanges = [];
    let previews = 0;
    const keybindings = new EditorKeybindings(
      {
        setTool(tool) {
          toolChanges.push(tool);
        },
        gridSize: 8
      },
      {
        onToolChange(tool) {
          toolChanges.push(`on:${tool}`);
        },
        onPreview() {
          previews += 1;
        }
      }
    );

    let prevented = false;
    keybindings._onKeyDown({
      code: 'KeyS',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault() {
        prevented = true;
      },
      target: { tagName: 'canvas' }
    });

    expect(toolChanges[0]).to.equal(EditorTools.SELECT);
    expect(toolChanges[1]).to.equal(`on:${EditorTools.SELECT}`);
    expect(previews).to.equal(1);
    expect(prevented).to.equal(true);
  });

  it('returns false for unknown actions and delegates gamepad config updates', function () {
    const keybindings = new EditorKeybindings({ setTool() {} });
    expect(keybindings._handleAction('missing.action')).to.equal(false);

    const calls = [];
    keybindings.gamepad = {
      setConfig(config, options) {
        calls.push({ config, options });
      }
    };
    keybindings.setGamepadBindings({ bindings: {} }, { persist: false });
    expect(calls).to.deep.equal([
      {
        config: { bindings: {} },
        options: { persist: false }
      }
    ]);
  });
});
