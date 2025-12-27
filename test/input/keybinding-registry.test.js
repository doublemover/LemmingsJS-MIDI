import { expect } from 'chai';
import { KeybindingRegistry } from '../../js/input/KeybindingRegistry.js';

const makeEvent = (code, mods = {}) => ({
  code,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  metaKey: !!mods.meta
});

describe('KeybindingRegistry', () => {
  it('prefers exact modifier matches when available', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: 'KeyU',
        actionShift: 'Shift+KeyU'
      }
    });
    const plain = registry.getActionsForEvent(makeEvent('KeyU'));
    expect(plain).to.include('actionBase');
    expect(plain).to.not.include('actionShift');

    const shifted = registry.getActionsForEvent(makeEvent('KeyU', { shift: true }));
    expect(shifted).to.include('actionShift');
    expect(shifted).to.not.include('actionBase');
  });

  it('falls back to shift-agnostic bindings without an exact match', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: 'KeyU'
      }
    });
    const shifted = registry.getActionsForEvent(makeEvent('KeyU', { shift: true }));
    expect(shifted).to.include('actionBase');
  });

  it('ignores ctrl/alt/meta shortcuts unless explicitly bound', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: 'KeyU'
      }
    });
    const ctrl = registry.getActionsForEvent(makeEvent('KeyU', { ctrl: true }));
    expect(ctrl).to.have.length(0);
  });

  it('normalizes single-character key tokens', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: 'a'
      }
    });
    const actions = registry.getActionsForEvent(makeEvent('KeyA'));
    expect(actions).to.include('actionBase');
  });

  it('matches modifier key events directly', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        boost: 'ShiftLeft'
      }
    });
    const actions = registry.getActionsForEvent(makeEvent('ShiftLeft', { shift: true }));
    expect(actions).to.include('boost');
  });
});
