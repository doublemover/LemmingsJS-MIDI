import { expect } from 'chai';
import { ViewPoint } from '../../js/render/ViewPoint.js';

describe('ViewPoint', function() {
  it('clamps positions and transforms coordinates', function() {
    const vp = new ViewPoint(5, 10, 2);
    vp.setX(20, [0, 12]);
    vp.setY(-5, [0, 8]);

    expect(vp.x).to.equal(12);
    expect(vp.y).to.equal(0);

    vp.setX(3);
    vp.setY(4);
    expect(vp.getSceneX(5)).to.equal(Math.trunc(5 / 2) + 3);
    expect(vp.getSceneY(7)).to.equal(Math.trunc(7 / 2) + 4);
  });
});
