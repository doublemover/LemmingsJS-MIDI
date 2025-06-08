import { expect } from 'chai';
import { GameView } from '../js/GameView.js';

describe('GameView frame stepping and speed', function() {
  it('nextFrame ticks forward then renders', function() {
    const view = new GameView();
    const calls = [];
    const timer = { tick(v) { calls.push(['tick', v]); }, speedFactor: 1 };
    const game = { getGameTimer() { return timer; }, render() { calls.push(['render']); } };
    view.game = game;
    view.nextFrame();
    expect(calls).to.deep.equal([[ 'tick', 1 ], [ 'render' ]]);
  });

  it('prevFrame ticks backward then renders', function() {
    const view = new GameView();
    const calls = [];
    const timer = { tick(v) { calls.push(['tick', v]); }, speedFactor: 1 };
    const game = { getGameTimer() { return timer; }, render() { calls.push(['render']); } };
    view.game = game;
    view.prevFrame();
    expect(calls).to.deep.equal([[ 'tick', -1 ], [ 'render' ]]);
  });

  it('selectSpeedFactor updates timer speed', function() {
    const view = new GameView();
    const timer = { tick() {}, speedFactor: 1 };
    view.game = { getGameTimer() { return timer; } };
    view.selectSpeedFactor(5);
    expect(view.gameSpeedFactor).to.equal(5);
    expect(timer.speedFactor).to.equal(5);
  });
});
