import { expect } from 'chai';
import '../js/lemmings/LemmingStateType.js';
import { Lemming } from '../js/lemmings/Lemming.js';

describe('Lemming extra', function() {
  it('getClickDistance computes distance and detects outside', function() {
    const lem = new Lemming(10, 10);
    expect(lem.getClickDistance(10, 5)).to.equal(0);
    expect(lem.getClickDistance(0, 0)).to.equal(-1);
  });






});
