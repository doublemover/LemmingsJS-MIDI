import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/ViewPoint.js';

describe('ViewPoint coordinate translation', function() {
  it('clamps x within bounds', function() {
    const vp = new Lemmings.ViewPoint(0, 0, 1);
    vp.setX(15, [0, 10]);
    expect(vp.x).to.equal(10);
    vp.setX(-5, [0, 10]);
    expect(vp.x).to.equal(0);
  });

  it('clamps y within bounds', function() {
    const vp = new Lemmings.ViewPoint(0, 0, 1);
    vp.setY(15, [0, 10]);
    expect(vp.y).to.equal(10);
    vp.setY(-5, [0, 10]);
    expect(vp.y).to.equal(0);
  });

  it('translates screen coords using scale and offset', function() {
    const vp = new Lemmings.ViewPoint(5, 10, 2);
    const sx = vp.getSceneX(20);
    const sy = vp.getSceneY(6);
    expect(sx).to.equal(Math.trunc(20 / 2) + 5);
    expect(sy).to.equal(Math.trunc(6 / 2) + 10);
  });
});
