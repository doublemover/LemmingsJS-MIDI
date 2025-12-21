import { expect } from 'chai';
import { Lemmings } from './helpers/lemmings.js';
import { Range } from '../js/util/Range.js';
import { Rectangle } from '../js/util/Rectangle.js';
import { Position2D } from '../js/util/Position2D.js';

globalThis.lemmings = Lemmings;

describe('Geometry classes', function() {
  it('constructs Range with default values', function() {
    const r = new Range();
    expect(r.x).to.equal(0);
    expect(r.y).to.equal(0);
    expect(r.width).to.equal(0);
    expect(r.height).to.equal(0);
    expect(r.direction).to.equal(0);
  });

  it('assigns Rectangle constructor parameters', function() {
    const rect = new Rectangle(1, 2, 3, 4);
    expect(rect.x1).to.equal(1);
    expect(rect.y1).to.equal(2);
    expect(rect.x2).to.equal(3);
    expect(rect.y2).to.equal(4);
  });

  it('assigns Position2D constructor parameters', function() {
    const pos = new Position2D(5, 6);
    expect(pos.x).to.equal(5);
    expect(pos.y).to.equal(6);
  });
});
