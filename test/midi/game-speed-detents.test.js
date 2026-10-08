import { expect } from 'chai';
import { GAME_SPEED_DETENTS, gameSpeedDetentIndex, gameSpeedFromDetent } from '../../js/app/midi-ui/gameSpeedDetents.js';
import { createMidiInstrumentWorkbench } from '../../js/app/midi-ui/midiInstrumentWorkbench.js';
import { createMidiProjectFromMidiConfig } from '../../js/midi/project/MidiProject.js';
import { createMidiEditHistory } from '../../js/app/midi-ui/midiEditHistory.js';
import { gameGuiInputMethods } from '../../js/game/game-gui/GameGuiInput.js';
import { TestDocument, createTestWindow } from '../helpers/test-dom.js';
import { registerElement } from '../support/dom-fixtures.js';

const fixture = () => {
  const document = new TestDocument(); document.body = document.createElement('body');
  const window = createTestWindow(), timer = { speedFactor: 3, frameTime: 20, tickIndex: 0, isRunning: () => true };
  const range = registerElement(document, 'input', 'midiGameSpeed'); range.type = 'range';
  const number = registerElement(document, 'input', 'midiGameSpeedValue'); number.type = 'number';
  const project = createMidiProjectFromMidiConfig({ enabled: false, sfx: {}, triggers: {} });
  let speedWrites = 0;
  const view = { gameSpeedFactor: 60, game: { getGameTimer: () => timer }, selectSpeedFactor(speed) { speedWrites++; timer.speedFactor = speed; timer.frameTime = 60 / speed; } };
  const workbench = createMidiInstrumentWorkbench({ document, window, getLemmings: () => view, getProject: () => project, getSource: () => null,
    updateMapping() {}, updateSource() {}, commitProject() {}, chooseView() {}, panic() {}, setStatus() {}, history: createMidiEditHistory(),
    bind: (id, event, handler) => document.getElementById(id)?.addEventListener(event, handler) });
  workbench.initialize(); workbench.setVisible(true);
  return { document, timer, range, number, view, workbench, get speedWrites() { return speedWrites; } };
};

describe('game-speed detents and effective range feedback', () => {
  it('uses tenths below1, integer speeds1–10 and tens above10, matching the main panel transitions', () => {
    expect(GAME_SPEED_DETENTS.slice(0, 10)).to.deep.equal([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(GAME_SPEED_DETENTS.slice(10, 19)).to.deep.equal([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(GAME_SPEED_DETENTS.slice(19)).to.deep.equal([20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    for (const [before, after, up] of [[0.2, 0.3, true], [0.5, 0.6, true], [1, 2, true], [9, 10, true], [10, 20, true], [20, 10, false], [10, 9, false], [1, 0.9, false]]) {
      const timer = { speedFactor: before }, panel = { gameTimer: timer, game: {}, drawSpeedChange() {} };
      gameGuiInputMethods.handleSkillMouseDown.call(panel, { x: up ? 170 : 161, y: 34 });
      expect(timer.speedFactor).to.equal(after);
      expect(gameSpeedFromDetent(gameSpeedDetentIndex(before) + (up ? 1 : -1))).to.equal(after);
    }
  });
  it('maps native range arrow input to detent speeds without changing sound history', () => {
    const f = fixture();
    expect(f.range.min).to.equal('0'); expect(f.range.max).to.equal('29'); expect(f.range.step).to.equal('1');
    f.range.value = String(gameSpeedDetentIndex(10) + 1); f.range.dispatchEvent({ type: 'input', target: f.range });
    expect(f.timer.speedFactor).to.equal(20); expect(f.number.value).to.equal('20');
    expect(f.range.getAttribute('aria-valuetext')).to.equal('20 times game speed'); f.workbench.dispose();
  });
  it('shows effective slowdown even with range focus and never writes speed during refresh', () => {
    const f = fixture(); f.document.activeElement = f.range;
    f.timer.speedFactor = 0.4; f.timer.frameTime = 150; f.workbench.refreshClock();
    expect(f.range.value).to.equal(String(gameSpeedDetentIndex(0.4))); expect(f.number.value).to.equal('0.4');
    expect(f.range.getAttribute('aria-valuetext')).to.equal('0.4 times game speed'); expect(f.speedWrites).to.equal(0);
    f.timer.speedFactor = 3.5; f.workbench.refreshClock();
    expect(f.number.value).to.equal('3.5'); expect(f.range.getAttribute('title')).to.equal('Effective game speed: 3.5×');
    expect(f.view.gameSpeedFactor).to.equal(60); expect(f.speedWrites).to.equal(0); f.workbench.dispose();
  });
  it('preserves in-progress numeric typing, then normalizes committed values to actual timer speed', () => {
    const f = fixture(); f.document.activeElement = f.number; f.number.value = '42.';
    f.timer.speedFactor = 2; f.workbench.refreshClock(); expect(f.number.value).to.equal('42.'); expect(f.speedWrites).to.equal(0);
    f.number.value = '200'; f.number.dispatchEvent({ type: 'change', target: f.number });
    expect(f.number.value).to.equal('120'); expect(f.timer.speedFactor).to.equal(120); f.workbench.dispose();
  });
});
