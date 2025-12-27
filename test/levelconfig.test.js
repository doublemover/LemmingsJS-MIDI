import { expect } from 'chai';
import { LevelConfig } from '../js/level/LevelConfig.js';

describe('LevelConfig', function() {
  it('returns group lengths and handles out-of-range indices', function() {
    const config = new LevelConfig();
    config.order = [[1, 2], [3]];
    expect(config.getGroupLength(0)).to.equal(2);
    expect(config.getGroupLength(1)).to.equal(1);
    expect(config.getGroupLength(-1)).to.equal(0);
    expect(config.getGroupLength(2)).to.equal(0);
  });
});
