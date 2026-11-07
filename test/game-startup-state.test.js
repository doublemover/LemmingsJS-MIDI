import { expect } from 'chai';
import FakeTimers from '@sinonjs/fake-timers';
import { GameView } from '../js/game/GameView.js';
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function candidate(load = Promise.resolve()) {
  const timer = { continued: 0, suspend() {}, continue() { this.continued++; } };
  return { level: { entrances: [] }, loaded: [], starts: 0, stops: 0, onGameEnd: { on() {} }, async loadLevel(...selection) { this.loaded.push(selection); await load; },
    setGameDisplay() {}, setGuiDisplay() {}, getGameTimer: () => timer, start() { this.starts++; }, stop() { this.stops++; } };
}
function viewFor(factory) {
  const view = Object.create(GameView.prototype);
  return Object.assign(view, { game: null, gameType: 1, levelGroupIndex: 0, levelIndex: 1, gameSpeedFactor: 1, gameResources: { getLevelGroups: () => [] },
    gameFactory: { getGame: factory }, stage: { getGameDisplay: () => ({}), getGuiDisplay: () => ({}), setCursorSprite() {}, dispose() {} },
    applyLevelViewport() {}, _registerMidiFlagTriggers() {}, _applyHistoryRetentionPolicy() {}, _attachMidiPreview() {}, _detachMidiPreview() {}, _disposeMidiPreview() {},
    changeHtmlText() {}, log: { log() {}, debug() {} }, _getSavedLevelEntries: () => [], _isSavedGroupIndex: () => false });
}
describe('classic game startup ownership (#1274)', () => {
  for (const custom of [false, true]) it('retires the superseded ' + (custom ? 'custom' : 'ordinary') + ' start before publication', async () => {
    const firstGate = gate(), old = candidate(), fresh = candidate(); let calls = 0;
    const view = viewFor(() => ++calls === 1 ? firstGate.promise : Promise.resolve(fresh));
    const start = () => custom ? view._startWithLevel({}) : view.start();
    const first = start(), second = start(); await second; firstGate.resolve(old); await first;
    expect(view.game).to.equal(fresh); expect(fresh.starts).to.equal(1); expect(old.starts).to.equal(0); expect(old.stops).to.equal(1); view.dispose(); expect(fresh.stops).to.equal(1);
  });
  for (const boundary of ['factory', 'level']) it('retires pending startup on dispose during ' + boundary, async () => {
    const pending = gate(), game = candidate(boundary === 'level' ? pending.promise : Promise.resolve()), view = viewFor(() => boundary === 'factory' ? pending.promise : Promise.resolve(game));
    const start = view.start(); await turn(); view.dispose(); pending.resolve(boundary === 'factory' ? game : undefined); await start;
    expect(view.game).to.equal(null); expect(game.starts).to.equal(0); expect(game.stops).to.be.greaterThan(0); expect(view.stage).to.equal(null);
  });
  it('captures selection before awaiting the factory and permits a failed-candidate retry', async () => {
    const pending = gate(), bad = candidate(), good = candidate(); bad.loadLevel = async () => { throw new Error('refused'); }; let calls = 0;
    const view = viewFor(() => ++calls === 1 ? Promise.resolve(bad) : pending.promise); await view.start(); expect(bad.stops).to.equal(1); expect(view.game).to.equal(null);
    const start = view.start(); view.levelIndex = 9; pending.resolve(good); await start; expect(good.loaded).to.deep.equal([[0, 1]]); expect(view.game).to.equal(good); view.dispose();
  });
  it('drops old level responses before rendering or starting another selected level', async () => {
    const pending = [], rendered = [], view = viewFor(() => Promise.resolve(candidate()));
    view.gameResources.getLevel = (group, index) => new Promise(resolve => pending.push({ index, resolve }));
    view.stage = null; view.start = async () => rendered.push(view.levelIndex); view.updateQuery = () => {};
    const first = view.loadLevel(); view.levelIndex = 2; const second = view.loadLevel(); pending[1].resolve({ name: 'new' }); await second; pending[0].resolve({ name: 'old' }); await first;
    expect(rendered).to.deep.equal([2]); view.dispose();
  });
  it('revokes a deferred resume on explicit Pause and never resumes a replacement game', () => {
    const timers = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const view = viewFor(() => {}), old = candidate(), fresh = candidate(); view.game = old;
      view.suspendWithColor('black'); view.suspend(); timers.tick(2000); expect(old.getGameTimer().continued).to.equal(0);
      view.suspendWithColor('black'); view.game = fresh; timers.tick(2000); expect(fresh.getGameTimer().continued).to.equal(0); view.dispose();
    } finally { timers.uninstall(); }
  });
});
