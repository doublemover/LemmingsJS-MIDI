import { expect } from 'chai';
import { Lemmings, useGlobalLemmings } from './helpers/lemmings.js';
import { Rectangle } from '../js/util/Rectangle.js';

useGlobalLemmings(Lemmings);

describe('Rectangle', function() {
  it('assigns constructor parameters', function() {
    const rect = new Rectangle(1, 2, 3, 4);
    expect(rect.x1).to.equal(1);
    expect(rect.y1).to.equal(2);
    expect(rect.x2).to.equal(3);
    expect(rect.y2).to.equal(4);
  });
});
