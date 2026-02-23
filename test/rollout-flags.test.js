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
        historyCodec: false,
        midiExpressiveUi: false
      }
    });

    expect(resolved.historyCodec).to.equal(false);
    expect(resolved.midiExpressiveUi).to.equal(false);
    expect(resolved.mcpSurfaceSplit).to.equal(true);
  });

  it('applies query rollout and rollback toggles', function () {
    const resolved = resolveRuntimeRolloutFlags({
      search: '?rolloutRenderPresent=true&rollbackMidiUi=1'
    });

    expect(resolved.renderPresentPath).to.equal(true);
    expect(resolved.midiExpressiveUi).to.equal(false);
  });

  it('supports rollbackAll emergency toggle', function () {
    const resolved = resolveRuntimeRolloutFlags({
      search: '?rollbackAll=1',
      runtimeFlags: {
        mcpSurfaceSplit: true,
        historyCodec: true,
        renderPresentPath: true,
        midiExpressiveUi: true
      }
    });

    expect(resolved).to.deep.equal({
      mcpSurfaceSplit: false,
      historyCodec: false,
      renderPresentPath: false,
      midiExpressiveUi: false
    });
  });

  it('accepts explicit query objects and ignores unknown values', function () {
    const query = new URLSearchParams('rolloutMidiUi=bogus&rollbackRenderPresent=1');
    const resolved = resolveRuntimeRolloutFlags({
      query,
      runtimeFlags: { midiExpressiveUi: true, renderPresentPath: true }
    });
    expect(resolved.midiExpressiveUi).to.equal(true);
    expect(resolved.renderPresentPath).to.equal(false);
  });

  it('respects caller-provided defaults for runtime rollout baselines', function () {
    const resolved = resolveRuntimeRolloutFlags({
      defaults: { historyCodec: false, midiExpressiveUi: false },
      runtimeFlags: { mcpSurfaceSplit: true }
    });

    expect(resolved.historyCodec).to.equal(false);
    expect(resolved.midiExpressiveUi).to.equal(false);
    expect(resolved.mcpSurfaceSplit).to.equal(true);
  });

  it('prefers first matching query alias for each rollout key', function () {
    const query = new URLSearchParams('rolloutRenderPresent=false&rrp=true');
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
