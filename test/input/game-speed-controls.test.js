import { expect } from 'chai';
import { GAME_SPEED_DETENTS, nextGameSpeed } from '../../js/game/GameSpeed.js';
import { KeyboardShortcuts } from '../../js/input/KeyboardShortcuts.js';
import { createMidiInstrumentWorkbench } from '../../js/app/midi-ui/midiInstrumentWorkbench.js';
import { createMidiProject } from '../../js/midi/project/MidiProject.js';
import { createMidiEditHistory } from '../../js/app/midi-ui/midiEditHistory.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';

const shortcutHarness = () => {
  const listeners = new Map();
  const doc = { activeElement: null };
  const timer = { speedFactor: 10 };
  let help = 0;
  const shortcuts = new KeyboardShortcuts({ game: { getGameTimer: () => timer }, shortcutOverlay: { toggle: () => { help += 1; } } }, {
    window: { document: doc, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) }
  });
  shortcuts.keybindings.setConfig({ bindings: { toggleShortcutOverlay: ['KeyH'] } });
  const key = (code, target) => {
    let prevented = false;
    shortcuts._onKeyDown({ code, target, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  return { shortcuts, timer, doc, listeners, key, help: () => help };
};

describe('game speed controls', function() {
  it('uses tenths, integers and tens across boundaries and arbitrary effective slowdown', function() {
    expect(GAME_SPEED_DETENTS).to.have.length(30);
    for (const [speed, up, down] of [[0.9, 1, 0.8], [1, 2, 0.9], [10, 20, 9], [20, 30, 10], [15.4, 20, 10], [0.55, 0.6, 0.5], [120, 120, 110]]) {
      expect(nextGameSpeed(speed, 1)).to.equal(up);
      expect(nextGameSpeed(speed, -1)).to.equal(down);
    }
  });

  it('routes Help and speed keys from a range while keeping native range navigation and text editing', function() {
    const h = shortcutHarness();
    try {
      const range = { tagName: 'INPUT', type: 'range' };
      expect(h.key('Equal', range)).to.equal(true); expect(h.timer.speedFactor).to.equal(20);
      expect(h.key('Minus', range)).to.equal(true); expect(h.timer.speedFactor).to.equal(10);
      expect(h.key('KeyH', range)).to.equal(true); expect(h.help()).to.equal(1);
      for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab']) expect(h.key(code, range)).to.equal(false);
      expect(h.shortcuts.pan).to.include({ left: false, right: false, up: false, down: false });
      for (const target of [{ tagName: 'INPUT', type: 'number' }, { tagName: 'TEXTAREA' }, { isContentEditable: true }]) {
        expect(h.key('Equal', target)).to.equal(false); expect(h.key('KeyH', target)).to.equal(false);
      }
      expect(h.timer.speedFactor).to.equal(10); expect(h.help()).to.equal(1);
    } finally { h.shortcuts.dispose(); }
  });

  it('releases only range focus on a canvas click and removes the listener on disposal', function() {
    const h = shortcutHarness(); let blurred = 0;
    h.doc.activeElement = { tagName: 'INPUT', type: 'range', blur: () => { blurred += 1; } };
    h.listeners.get('pointerdown')({ target: { tagName: 'CANVAS' } }); expect(blurred).to.equal(1);
    h.doc.activeElement.type = 'text';
    h.listeners.get('pointerdown')({ target: { tagName: 'CANVAS' } }); expect(blurred).to.equal(1);
    h.shortcuts.dispose(); expect(h.listeners.has('pointerdown')).to.equal(false);
  });

  it('maps slider positions to detents and reflects effective slowdown even while the range is focused', function() {
    const doc = new TestDocument(); doc.body = doc.createElement('body');
    const win = createTestWindow(), handlers = new Map(), project = createMidiProject();
    const range = registerElement(doc, 'input', 'midiGameSpeed'); range.type = 'range';
    const number = registerElement(doc, 'input', 'midiGameSpeedValue'); number.type = 'number';
    const timer = { speedFactor: 1, frameTime: 60 };
    const view = { game: { getGameTimer: () => timer }, selectSpeedFactor: speed => { timer.speedFactor = speed; } };
    const workbench = createMidiInstrumentWorkbench({ document: doc, window: win, getLemmings: () => view,
      getProject: () => project, getSource: () => project.sources[0], history: createMidiEditHistory(), bind: (id, type, fn) => handlers.set(id + ':' + type, fn) });
    try {
      workbench.initialize(); workbench.setVisible(true); range.focus();
      handlers.get('midiGameSpeed:input')({ target: { value: '19' } }); expect(timer.speedFactor).to.equal(20);
      expect(range.getAttribute('aria-valuetext')).to.equal('20 times game speed');
      timer.speedFactor = 0.5; timer.frameTime = 120; workbench.refreshClock();
      expect(range.value).to.equal('4'); expect(number.value).to.equal('0.5');
      number.focus(); number.value = '3.4'; workbench.refreshClock(); expect(number.value).to.equal('3.4');
      handlers.get('midiGameSpeedValue:change')({ target: number }); expect(timer.speedFactor).to.equal(3.4);
    } finally { workbench.dispose(); }
  });
});
