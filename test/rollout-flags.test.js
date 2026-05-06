import { expect } from 'chai';
import {
  DEFAULT_RUNTIME_ROLLOUT_FLAGS,
  resolveRuntimeRolloutFlags
} from '../js/core/rolloutFlags.js';

describe('rolloutFlags', function () {
  it('returns stable defaults', function () {
    expect(resolveRuntimeRolloutFlags({ search: '' })).to.deep.equal(DEFAULT_RUNTIME_ROLLOUT_FLAGS);
  });

  it('accepts runtime override objects', function () {
    const resolved = resolveRuntimeRolloutFlags({
      runtimeFlags: {
        historyCodec: false
      }
    });

    expect(resolved.historyCodec).to.equal(false);
  });

  it('applies query rollout and rollback toggles', function () {
    const resolved = resolveRuntimeRolloutFlags({
      search: '?rolloutRenderPresent=true&rollbackHistoryCodec=1'
    });

    expect(resolved.renderPresentPath).to.equal(true);
    expect(resolved.historyCodec).to.equal(false);
  });

  it('supports rollbackAll emergency toggle', function () {
    const resolved = resolveRuntimeRolloutFlags({
      search: '?rollbackAll=1',
      runtimeFlags: {
        historyCodec: true,
        renderPresentPath: true
      }
    });

    expect(resolved).to.deep.equal({
      historyCodec: false,
      renderPresentPath: false
    });
  });

  it('accepts explicit query objects and ignores unknown values', function () {
    const query = new URLSearchParams('rolloutHistoryCodec=bogus&rollbackRenderPresent=1');
    const resolved = resolveRuntimeRolloutFlags({
      query,
      runtimeFlags: { historyCodec: true, renderPresentPath: true }
    });
    expect(resolved.historyCodec).to.equal(true);
    expect(resolved.renderPresentPath).to.equal(false);
  });

  it('respects caller-provided defaults for runtime rollout baselines', function () {
    const resolved = resolveRuntimeRolloutFlags({
      defaults: { historyCodec: false },
      runtimeFlags: { renderPresentPath: true }
    });

    expect(resolved.historyCodec).to.equal(false);
    expect(resolved.renderPresentPath).to.equal(true);
  });

  it('uses canonical query names for rollout flags', function () {
    const query = new URLSearchParams('rolloutRenderPresent=false');
    const resolved = resolveRuntimeRolloutFlags({ query });
    expect(resolved.renderPresentPath).to.equal(false);
  });

  it('treats bare rollout query flags as enabled', function () {
    const resolved = resolveRuntimeRolloutFlags({
      search: '?rolloutRenderPresent'
    });
    expect(resolved.renderPresentPath).to.equal(true);
  });
});
