import { expect } from 'chai';
import { GameView } from '../js/GameView.js';

describe('GameView without game', function() {
  it('nextFrame, prevFrame, and selectSpeedFactor no-op without game', function() {
    const view = new GameView();
    expect(() => {
      view.nextFrame();
      view.prevFrame();
      view.selectSpeedFactor(3);
    }).to.not.throw();
    expect(view.gameSpeedFactor).to.equal(1);
  });
});
