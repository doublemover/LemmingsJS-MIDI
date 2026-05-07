import { expect } from 'chai';
import {
  SolverReplaySchema,
  SolverRouteSchema,
  SolverSnapshotSchema
} from '../mcp/schemas.js';
import { createSolverToolHandlers } from '../mcp/solverTools.js';
import { createFlatWalkFixture } from '../js/solver/SolverFixtures.js';
import { SOLVER_RESULT_TYPES } from '../js/solver/SolverTypes.js';

describe('mcp solver tools', function() {
  const handlers = createSolverToolHandlers({
    schemas: {
      SolverSnapshotSchema,
      SolverRouteSchema,
      SolverReplaySchema
    }
  });

  it('returns compact snapshot hashes without terrain masks', async function() {
    const payload = await handlers.solverSnapshotTool({
      source: createFlatWalkFixture()
    });

    expect(payload.ok).to.equal(true);
    expect(payload.snapshot).to.include({
      kind: 'solver-state',
      id: 'flat-walk'
    });
    expect(payload.snapshot.terrain?.mask).to.equal(undefined);
    expect(payload.snapshot.counts.entrances).to.equal(1);
  });

  it('routes and replays through compact solver MCP payloads', async function() {
    const route = await handlers.solverRouteTool({
      source: createFlatWalkFixture(),
      options: { maxNodes: 50 }
    });
    expect(route.ok).to.equal(true);
    expect(route.resultType).to.equal(SOLVER_RESULT_TYPES.UNKNOWN);
    expect(route.routeSkeleton).to.not.equal(null);

    const replay = await handlers.solverReplayTool({
      source: createFlatWalkFixture(),
      actions: [],
      options: { maxTicks: 140, targetSaveCount: 1 }
    });
    expect(replay.ok).to.equal(true);
    expect(replay.result.resultType).to.equal(SOLVER_RESULT_TYPES.SOLVED);
    expect(replay.result.replaySummary.savedCount).to.equal(1);
  });
});
