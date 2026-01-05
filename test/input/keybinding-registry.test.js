import { expect } from 'chai';
import { KeybindingRegistry, mergeKeybindingConfig } from '../../js/input/KeybindingRegistry.js';

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

  it('returns empty bindings when an action is missing', () => {
    const registry = new KeybindingRegistry({ bindings: {} });
    expect(registry.getBindingsForAction('nope')).to.eql([]);
  });

  it('normalizes invalid binding overrides to empty objects', () => {
    const base = { version: 1, bindings: { action: 'KeyA' } };
    const merged = mergeKeybindingConfig(base, { bindings: [] });
    expect(merged.bindings).to.eql(base.bindings);
  });

  it('normalizes digit key tokens', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: '1'
      }
    });
    const actions = registry.getActionsForEvent(makeEvent('Digit1'));
    expect(actions).to.include('actionBase');
  });

  it('ignores non-string binding entries', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: 5
      }
    });
    expect(registry.getBindingsForAction('actionBase')).to.eql([]);
  });

  it('skips invalid chords and missing event codes', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: '+'
      }
    });
    expect(registry.getActionsForEvent({})).to.eql([]);
    expect(registry.getActionsForEvent({ code: 'KeyF24' })).to.eql([]);
  });

  it('keeps single-character tokens that are not alphanumeric', () => {
    const registry = new KeybindingRegistry({
      bindings: {
        actionBase: '.'
      }
    });
    expect(registry.getActionsForEvent(makeEvent('.'))).to.include('actionBase');
  });
});
