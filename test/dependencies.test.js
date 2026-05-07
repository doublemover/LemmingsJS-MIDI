import { expect } from 'chai';
import {
  setDependency,
  getDependency,
  clearDependency,
  resetDependencies,
  setRuntimeContext,
  clearRuntimeContext,
  getRuntimeDependency
} from '../js/core/dependencies.js';

describe('dependencies', function() {
  afterEach(function() {
    resetDependencies();
    clearRuntimeContext();
  });

  it('returns fallback when no override is set', function() {
    expect(getDependency('missing', 7)).to.equal(7);
  });

  it('ignores empty keys when setting or clearing', function() {
    setDependency('', 'value');
    clearDependency('');
    expect(getDependency('', 'fallback')).to.equal('fallback');
  });

  it('overrides and clears dependencies', function() {
    setDependency('Thing', 123);
    expect(getDependency('Thing', 0)).to.equal(123);
    clearDependency('Thing');
    expect(getDependency('Thing', 0)).to.equal(0);
  });

  it('reset clears all overrides', function() {
    setDependency('One', 1);
    setDependency('Two', 2);
    resetDependencies();
    expect(getDependency('One', null)).to.equal(null);
    expect(getDependency('Two', null)).to.equal(null);
  });

  it('prefers explicit runtime context over globals', function() {
    const originalWindow = globalThis.window;
    const globalWindow = { name: 'global' };
    const runtimeWindow = { name: 'runtime' };
    globalThis.window = globalWindow;
    try {
      setRuntimeContext({ window: runtimeWindow });
      expect(getRuntimeDependency('window')).to.equal(runtimeWindow);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
