import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import { Rectangle } from '../js/Rectangle.js';

globalThis.lemmings = Lemmings;

describe('Rectangle', function() {
  it('assigns constructor parameters', function() {
    const rect = new Rectangle(1, 2, 3, 4);
    expect(rect.x1).to.equal(1);
    expect(rect.y1).to.equal(2);
    expect(rect.x2).to.equal(3);
    expect(rect.y2).to.equal(4);
  });
});
