import { expect } from 'chai';
import { KeyboardShortcuts } from '../../js/input/KeyboardShortcuts.js';
import fs from 'node:fs';

const fixture = () => {
  const timer = { speedFactor: 3, pauses: 0, toggle() { this.pauses++; } }, window = { addEventListener() {}, removeEventListener() {} };
  let helps = 0;
  const view = { game: { getGameTimer: () => timer, gameGui: {} }, shortcutOverlay: { toggle() { helps++; } } };
  const shortcuts = new KeyboardShortcuts(view, { window, navigator: { getGamepads: () => [] }, storage: null });
  shortcuts.keybindings.setConfig(JSON.parse(fs.readFileSync('keybindings.json', 'utf8')));
  const press = (code, target, modifiers = {}) => {
    let prevented = false;
    shortcuts._onKeyDown({ code, target, ...modifiers, preventDefault() { prevented = true; } });
    return prevented;
  };
  return { timer, view, shortcuts, press, get helps() { return helps; } };
};

describe('global shortcuts while a range is focused', () => {
  it('leaves native button, summary and link activation to the browser on both key edges', () => {
    const f = fixture();
    for (const tagName of ['BUTTON', 'SUMMARY', 'A']) for (const code of ['Space', 'Enter']) {
      const target = { tagName, hasAttribute: name => name === 'href' };
      expect(f.press(code, target)).to.equal(false);
      let prevented = false;
      f.shortcuts._onKeyUp({ code, target, preventDefault() { prevented = true; } });
      expect(prevented).to.equal(false);
    }
    expect(f.timer.pauses).to.equal(0);
    expect(f.press('F1', { tagName: 'BUTTON' })).to.equal(true); expect(f.helps).to.equal(1);
    f.shortcuts.dispose();
  });
  it('keeps Help and all speed aliases usable while leaving native arrow adjustments alone', () => {
    const f = fixture(), range = { tagName: 'INPUT', type: 'range' };
    expect(f.press('F1', range)).to.equal(true); expect(f.helps).to.equal(1);
    expect(f.press('Slash', range, { shiftKey: true })).to.equal(true); expect(f.helps).to.equal(2);
    expect(f.press('Equal', range)).to.equal(true); expect(f.timer.speedFactor).to.equal(4);
    expect(f.press('NumpadSubtract', range)).to.equal(true); expect(f.timer.speedFactor).to.equal(3);
    expect(f.press('Equal', range, { shiftKey: true })).to.equal(true); expect(f.timer.speedFactor).to.equal(8);
    expect(f.press('Equal', range, { altKey: true })).to.equal(true); expect(f.timer.speedFactor).to.equal(7);
    expect(f.press('ArrowRight', range)).to.equal(false); expect(f.shortcuts.pan.right).to.equal(false);
    expect(f.press('Space', range)).to.equal(true); expect(f.timer.pauses).to.equal(1);
    f.shortcuts.dispose();
  });
  it('preserves text, number, select and contenteditable input semantics', () => {
    const f = fixture();
    for (const target of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT', type: 'number' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(f.press('Equal', target)).to.equal(false); expect(f.press('Slash', target, { shiftKey: true })).to.equal(false);
    }
    expect(f.timer.speedFactor).to.equal(3); expect(f.helps).to.equal(0); f.shortcuts.dispose();
  });
  it('uses effective timer speed after benchmark slowdown rather than restoring stale nominal speed', () => {
    const f = fixture(); f.view.gameSpeedFactor = 60; f.timer.speedFactor = 2;
    f.press('Equal', { tagName: 'INPUT', type: 'range' });
    expect(f.timer.speedFactor).to.equal(3); expect(f.view.gameSpeedFactor).to.equal(3); f.shortcuts.dispose();
  });
});
