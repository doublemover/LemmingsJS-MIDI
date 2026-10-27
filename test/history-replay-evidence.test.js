import { expect } from 'chai';
import { installHistoryReplayEvidence } from '../scripts/HistoryReplayEvidence.js';

const fixture = (fault, { targets = [0, 8, 16, 24, 32], retentionTicks = null } = {}) => {
  let tick = 0, x = 0, tint = 0, maximumTick = 0, clock = 0, decodes = 0, hits = 0, paused = true;
  const states = new Map(), decoded = new Set();
  const scope = { performance: { now: () => ++clock }, __E2E__: {
    getState: () => ({ game: { timer: { tickIndex: tick, running: !paused }, lemmings: [{ id: 1, x, y: 3 }],
      lemmingManager: { spawnTotal: 1, releaseTickIndex: 0, mmTickCounter: tick, activeCount: 1, totalCount: 1, nukeTargets: [] },
      level: { name: 'fixture', width: 1, height: 1, releaseRate: 1, releaseCount: 1, entrances: [] },
      history: { minTick: retentionTicks == null ? 0 : Math.max(0, maximumTick - retentionTicks), maxTick: Math.max(0, maximumTick - 1), coldBlockDecodes: decodes, coldBlockCacheHits: hits, coldDecodedBytes: decodes * 8 } } }),
    getBuffer: name => ({ name, encoding: 'base64', width: 1, height: 1, byteLength: name === 'ground-image' ? 4 : 1,
      data: Buffer.alloc(name === 'ground-image' ? 4 : 1, tint).toString('base64') }),
    getDelta: () => { throw new Error('Oracle must not prewarm history.'); },
    pause: () => { paused = true; return true; },
    seek: target => {
      if (fault === 'noop') return false;
      const state = states.get(target); if (!state) return false;
      const block = Math.floor(target / 8);
      if (!decoded.has(block)) { decoded.add(block); decodes++; } else hits++;
      tick = target; x = state.x; tint = state.tint;
      if (fault === 'actor') x = -12345;
      if (fault === 'terrain') tint = 255;
      return true;
    }
  } };
  installHistoryReplayEvidence({ samples: 2 }, scope);
  for (const target of targets) {
    tick = target; maximumTick = target; x = target * 2; tint = target;
    states.set(tick, { x, tint }); scope.__LEMMINGS_HISTORY_REPLAY_EVIDENCE__.capture();
  }
  return { scope, getTick: () => tick, getDecodes: () => decodes, owner: scope.__LEMMINGS_HISTORY_REPLAY_EVIDENCE__ };
};

describe('independent forward replay benchmark evidence', () => {
  it('retains early independent checkpoints under a fixed capacity instead of probing only the recent warm suffix', () => {
    const f = fixture(undefined, { targets: Array.from({ length: 81 }, (_, index) => index) });
    const result = f.owner.probe(); expect(result.status).to.equal('complete');
    expect(result.oracleSampling).to.equal('time-distributed-live-forward-checkpoints');
    expect(result.checkpointTicks[0]).to.equal(0); expect(result.checkpointTicks.at(-1)).to.equal(80);
    expect(result.checkpointTicks.length).to.be.at.most(6);
    expect(result.observations[0].targetTick).to.equal(0);
    expect(result.retainedOracleBytes).to.be.at.most(result.maximumOracleBytes); f.owner.dispose();
  });
  it('retires checkpoints outside actual retained history while preserving bounded independent targets', () => {
    const f = fixture(undefined, { targets: Array.from({ length: 81 }, (_, index) => index), retentionTicks: 20 });
    const result = f.owner.probe(); expect(result.status).to.equal('complete');
    expect(result.checkpointTicks.every(tick => tick >= 60)).to.equal(true);
    expect(result.observations.every(row => row.targetTick >= 60)).to.equal(true); f.owner.dispose();
  });
  it('checks actual target state and terrain, separates cold/repeat work and restores state boundary 32 rather than delta 31', () => {
    const f = fixture(); expect(f.getDecodes()).to.equal(0);
    const probe = f.owner.probe();
    expect(probe).to.include({ status: 'complete', startTick: 32, maxTick: 31, restoredTick: 32, startRestored: true, hashMatch: true });
    expect(f.getTick()).to.equal(32);
    expect(probe.observations.some(row => row.phase === 'first-touch-cold' && row.coldDecodes > 0)).to.equal(true);
    expect(probe.observations.filter(row => row.phase === 'warm-repeat').every(row => row.coldDecodes === 0 && row.exactStateMatch)).to.equal(true);
    f.owner.dispose(); expect(f.scope.__LEMMINGS_HISTORY_REPLAY_EVIDENCE__).to.equal(undefined);
  });

  for (const fault of ['noop', 'actor', 'terrain']) it(`rejects an unchanged archive with ${fault} applied-state failure`, () => {
    const f = fixture(fault), probe = f.owner.probe();
    expect(probe).to.include({ status: 'failed', hashMatch: false, startRestored: false });
    expect(probe.observations[0].accepted && probe.observations[0].exactStateMatch).to.equal(false);
    f.owner.dispose();
  });

  it('refuses an oversized independent checkpoint instead of silently dropping its terrain', () => {
    const f = fixture(); f.owner.dispose();
    installHistoryReplayEvidence({ samples: 1, maximumBytes: 16 }, f.scope);
    expect(() => f.scope.__LEMMINGS_HISTORY_REPLAY_EVIDENCE__.capture()).to.throw('storage bound');
    f.scope.__LEMMINGS_HISTORY_REPLAY_EVIDENCE__.dispose();
  });
});
