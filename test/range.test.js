import { expect } from 'chai';
import { Lemmings } from './helpers/lemmings.js';
import { Range } from '../js/util/Range.js';

globalThis.lemmings = Lemmings;

describe('Range', function() {
  it('initializes fields to zero', function() {
    const r = new Range();
    expect(r.x).to.equal(0);
    expect(r.y).to.equal(0);
    expect(r.width).to.equal(0);
    expect(r.height).to.equal(0);
    expect(r.direction).to.equal(0);
  });
});
