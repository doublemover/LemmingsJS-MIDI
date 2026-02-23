import { expect } from 'chai';
import { createStateToolHandlers } from '../mcp/stateTools.js';

const createFixture = ({
  currentTick = 0,
  deltas = [],
  state = null,
  resourcePut = () => null
} = {}) => {
  const session = {
    id: 's1',
    resources: { put: (...args) => resourcePut(...args) },
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
      return state;
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

  it('caps state.get ids mode payload size for large id lists', async function () {
    const total = 6005;
    const fixture = createFixture({
      currentTick: 12,
      state: {
        version: 1,
        mode: 'play',
        ready: true,
        game: {
          timer: { tickIndex: 12, running: true, speedFactor: 1 },
          lemmingManager: { selectedIndex: 0, activeCount: total, totalCount: total },
          lemmings: Array.from({ length: total }, (_, id) => ({ id, x: id, y: 0 }))
        }
      }
    });

    const result = await fixture.handlers.getStateTool({
      sessionId: 's1',
      lemmings: {
        mode: 'ids',
        ids: Array.from({ length: total }, (_, id) => id)
      }
    });

    expect(result.ok).to.equal(true);
    expect(result.snapshot.game.lemmingsIds).to.have.lengthOf(5000);
    expect(result.snapshot.game.lemmings).to.have.lengthOf(5000);
  });

  it('caps state.get all mode max to protect snapshot size', async function () {
    const total = 6005;
    const fixture = createFixture({
      currentTick: 12,
      state: {
        version: 1,
        mode: 'play',
        ready: true,
        game: {
          timer: { tickIndex: 12, running: true, speedFactor: 1 },
          lemmingManager: { selectedIndex: 0, activeCount: total, totalCount: total },
          lemmings: Array.from({ length: total }, (_, id) => ({ id, x: id, y: 0 }))
        }
      }
    });

    const result = await fixture.handlers.getStateTool({
      sessionId: 's1',
      lemmings: {
        mode: 'all',
        max: 999999
      }
    });

    expect(result.ok).to.equal(true);
    expect(result.snapshot.game.lemmings).to.have.lengthOf(5000);
  });

  it('caps maxTicks to avoid oversized delta fetches', async function () {
    const fixture = createFixture({ currentTick: 10000, deltas: [] });

    await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: 0,
      toTick: 10000,
      maxTicks: 999999
    });

    expect(fixture.getCaptured()).to.have.lengthOf(1);
    expect(fixture.getCaptured()[0]).to.include({
      method: 'getDeltas',
      startTick: 8001,
      endTick: 10000,
      limit: 2000
    });
  });

  it('caps maxChanges and truncates oversized lemming delta arrays', async function () {
    const totalChanges = 6005;
    const fixture = createFixture({
      currentTick: 12,
      deltas: [{
        tick: 12,
        lemChanges: {
          ids: Array.from({ length: totalChanges }, (_, index) => index),
          fields: Array.from({ length: totalChanges }, () => 4),
          next: Array.from({ length: totalChanges }, (_, index) => index)
        }
      }]
    });

    const result = await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: 11,
      lemmings: {
        fields: [4],
        maxChanges: 999999
      }
    });

    expect(result.ok).to.equal(true);
    expect(result.deltas).to.have.lengthOf(1);
    expect(result.deltas[0].lemChanges.ids).to.have.lengthOf(5000);
    expect(result.deltas[0].lemChanges.fields).to.have.lengthOf(5000);
    expect(result.deltas[0].lemChanges.next).to.have.lengthOf(5000);
  });

  it('returns resource_store_failed when getState resource delivery cannot persist', async function () {
    const fixture = createFixture({
      currentTick: 11,
      state: {
        version: 1,
        mode: 'play',
        ready: true,
        game: {
          timer: { tickIndex: 11, running: true, speedFactor: 1 },
          lemmingManager: { selectedIndex: 0, activeCount: 0, totalCount: 0 },
          lemmings: []
        }
      },
      resourcePut: () => null
    });

    const result = await fixture.handlers.getStateTool({
      sessionId: 's1',
      format: { delivery: 'resource' }
    });

    expect(result).to.deep.equal({
      ok: false,
      reason: 'resource_store_failed'
    });
  });

  it('returns resource_store_failed when getStateDelta resource delivery cannot persist', async function () {
    const fixture = createFixture({
      currentTick: 12,
      deltas: [],
      resourcePut: () => null
    });

    const result = await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: 10,
      format: { delivery: 'resource' }
    });

    expect(result).to.deep.equal({
      ok: false,
      reason: 'resource_store_failed'
    });
  });

  it('returns snapshot_serialize_failed when state snapshots cannot be serialized', async function () {
    const fixture = createFixture({
      currentTick: 12,
      state: {
        version: 1n,
        mode: 'play',
        ready: true,
        game: {
          timer: { tickIndex: 12, running: true, speedFactor: 1 },
          lemmingManager: { selectedIndex: 0, activeCount: 0, totalCount: 0 },
          lemmings: []
        }
      },
      resourcePut: () => {
        throw new Error('resourcePut should not be reached for unserializable payloads');
      }
    });

    const result = await fixture.handlers.getStateTool({
      sessionId: 's1',
      format: { delivery: 'resource' }
    });

    expect(result).to.deep.equal({
      ok: false,
      reason: 'snapshot_serialize_failed'
    });
  });

  it('returns delta_serialize_failed when delta payloads cannot be serialized', async function () {
    const fixture = createFixture({
      currentTick: 12,
      deltas: [{
        tick: 12,
        lemChanges: {
          ids: [1],
          fields: [4],
          next: [1n]
        }
      }],
      resourcePut: () => {
        throw new Error('resourcePut should not be reached for unserializable payloads');
      }
    });

    const result = await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: 11,
      lemmings: { fields: [4] },
      format: { delivery: 'resource' }
    });

    expect(result).to.deep.equal({
      ok: false,
      reason: 'delta_serialize_failed'
    });
  });

  it('omits prev arrays when includePrev is requested but source deltas do not provide prev values', async function () {
    const fixture = createFixture({
      currentTick: 12,
      deltas: [{
        tick: 12,
        lemChanges: {
          ids: [1],
          fields: [4],
          next: [9]
        }
      }]
    });

    const result = await fixture.handlers.getStateDeltaTool({
      sessionId: 's1',
      afterTick: 11,
      lemmings: { includePrev: true, fields: [4] }
    });

    expect(result.ok).to.equal(true);
    expect(result.deltas).to.have.lengthOf(1);
    expect(result.deltas[0].lemChanges).to.deep.equal({
      ids: [1],
      fields: [4],
      next: [9]
    });
  });
});
