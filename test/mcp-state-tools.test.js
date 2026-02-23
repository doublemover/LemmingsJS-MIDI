import { expect } from 'chai';
import { createStateToolHandlers } from '../mcp/stateTools.js';

const createFixture = ({ currentTick = 0, deltas = [] } = {}) => {
  const session = {
    id: 's1',
    resources: { put() { return null; } },
    lastStateTick: null
  };
  const captured = [];
  const handlers = createStateToolHandlers({
    schemas: {
      StateGetSchema: {
        parse(args = {}) {
          return { sessionId: 's1', ...args };
        }
      },
      StateDeltaSchema: {
        parse(args = {}) {
          return { sessionId: 's1', ...args };
        }
      },
      LemmingsSummarySchema: {
        parse(args = {}) {
          return { sessionId: 's1', ...args };
        }
      }
    },
    attachEvents(_session, payload) {
      return payload;
    },
    getSession() {
      return session;
    },
    async callE2E(_session, method, startTick, endTick, limit) {
      captured.push({ method, startTick, endTick, limit });
      return { ok: true, value: deltas };
    },
    async getState() {
      return null;
    },
    async getTickIndex() {
      return currentTick;
    },
    nudgeWatchPolling() {},
    helpers: {
      filterStateSnapshot(state) {
        return state;
      },
      buildSkillInfo() {
        return null;
      },
      buildLemmingPrunePolicy() {
        return null;
      },
      buildLemmingSummary() {
        return {};
      },
      buildLemmingSummaryCompact() {
        return {};
      },
      pruneLemming(lemming) {
        return lemming;
      }
    },
    defaultLemDeltaFields: [0, 1]
  });

  return {
    handlers,
    session,
    getCaptured() {
      return captured;
    }
  };
};

describe('state tools', function () {
  it('clamps toTick to the current tick before requesting deltas', async function () {
    const fixture = createFixture({ currentTick: 12, deltas: [] });

    const result = await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: 8,
      toTick: 99,
      maxTicks: 50
    });

    expect(fixture.getCaptured()).to.have.lengthOf(1);
    expect(fixture.getCaptured()[0]).to.include({
      method: 'getDeltas',
      startTick: 9,
      endTick: 12,
      limit: 50
    });
    expect(result.cursor).to.equal(12);
    expect(result.toTick).to.equal(12);
  });

  it('preserves the provided cursor when afterTick is ahead of current tick', async function () {
    const fixture = createFixture({ currentTick: 10, deltas: [] });

    const result = await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: 20
    });

    expect(fixture.getCaptured()).to.have.lengthOf(0);
    expect(result).to.include({
      ok: true,
      cursor: 20,
      afterTick: 20,
      toTick: 10
    });
    expect(result.deltas).to.deep.equal([]);
  });

  it('normalizes negative ranges to start at tick zero', async function () {
    const fixture = createFixture({ currentTick: 7, deltas: [] });

    await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: -12,
      toTick: 2,
      maxTicks: 20
    });

    expect(fixture.getCaptured()).to.have.lengthOf(1);
    expect(fixture.getCaptured()[0]).to.include({
      method: 'getDeltas',
      startTick: 0,
      endTick: 2,
      limit: 20
    });
  });

  it('uses integer session lastStateTick when afterTick is omitted', async function () {
    const fixture = createFixture({ currentTick: 11, deltas: [] });
    fixture.session.lastStateTick = 5.9;

    await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      maxTicks: 20
    });

    expect(fixture.getCaptured()).to.have.lengthOf(1);
    expect(fixture.getCaptured()[0].startTick).to.equal(6);
    expect(fixture.getCaptured()[0].endTick).to.equal(11);
  });
});
