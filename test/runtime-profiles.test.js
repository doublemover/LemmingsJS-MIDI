import { expect } from 'chai';
import {
  DEFAULT_RUNTIME_PROFILE,
  getProfileHistoryRetention,
  getRuntimeProfileIds,
  getRuntimeProfilePreset,
  getSpecialHistoryRetention,
  normalizeRuntimeProfile
} from '../js/core/runtimeProfiles.js';

describe('runtimeProfiles', function () {
  it('normalizes aliases and falls back to default profiles', function () {
    expect(normalizeRuntimeProfile('gameplay')).to.equal('classic');
    expect(normalizeRuntimeProfile('MIDI')).to.equal('midi');
    expect(normalizeRuntimeProfile('missing-profile')).to.equal(DEFAULT_RUNTIME_PROFILE);
  });

  it('returns expected preset ids and default preset fallback', function () {
    const ids = getRuntimeProfileIds();
    expect(ids).to.include.members(['classic', 'midi', 'editor', 'e2e', 'perf']);
    expect(getRuntimeProfilePreset('does-not-exist').id).to.equal(DEFAULT_RUNTIME_PROFILE);
  });

  it('returns cloned history-retention values', function () {
    const retention = getProfileHistoryRetention('perf');
    expect(retention).to.deep.equal({
      enableHistoryCap: true,
      historyCapTicks: 12000,
      historyWarnTicks: 9000
    });
    retention.historyCapTicks = 1;
    expect(getProfileHistoryRetention('perf').historyCapTicks).to.equal(12000);
  });

  it('returns special history retention policies as clones', function () {
    const endless = getSpecialHistoryRetention('endless');
    expect(endless).to.deep.equal({
      enableHistoryCap: true,
      historyCapTicks: 24000,
      historyWarnTicks: 18000
    });
    endless.historyCapTicks = 1;
    expect(getSpecialHistoryRetention('endless').historyCapTicks).to.equal(24000);
    expect(getSpecialHistoryRetention('unknown')).to.equal(null);
  });
});
