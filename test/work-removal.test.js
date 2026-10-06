import { expect } from 'chai';
import { createSmallGapFixture } from '../js/solver/SolverFixtures.js';
import { planSolverRoute } from '../js/solver/RoutePlanner.js';
import { buildReachabilityGraph } from '../js/solver/ReachabilityGraph.js';
import { analyzeSolverCrowd } from '../js/solver/SolverCrowd.js';
import { displayBlitMethods } from '../js/render/display/DisplayBlit.js';
import { createHistoryFixture } from './support/history-fixtures.js';

describe('bounded work removal', function() {
  it('extracts one route snapshot and does no extraction for supplied graph and crowd', function() {
    const input = createSmallGapFixture();
    let extractions = 0;
    input.getGroundMaskLayer = () => { extractions += 1; return input.groundMask; };
    const route = planSolverRoute(input);
    expect(extractions).to.equal(1);
    const graph = buildReachabilityGraph(input);
    const crowd = analyzeSolverCrowd(input);
    extractions = 0;
    expect(planSolverRoute(input, { graph, crowd })).to.deep.equal(route);
    expect(extractions).to.equal(0);
  });

  it('keeps exact object pixels across overwrite, clipping, offsets, spans and vertical flips', function() {
    for (const spans of [false, true]) {
      const frame = {
        width: 3, height: 2, offsetX: 1, offsetY: -1,
        getBuffer: () => Uint32Array.from([11, 12, 13, 14, 15, 16]),
        getMask: () => Uint8Array.from([1, 0, 1, 1, 1, 0]),
        ...(spans ? { getSpanCache: () => ({ rows: [[0, 1, 2, 3], [0, 2]], bounds: { minY: 0, maxY: 1 } }) } : {})
      };
      for (const [onlyOverwrite, noOverwrite] of [[false, false], [true, false], [false, true], [true, true]]) {
        for (const isUpsideDown of [false, true]) {
          for (const [x, y] of [[0, 1], [-2, 0], [2, 3]]) {
            const makeDisplay = () => ({
              ...displayBlitMethods, imgData: { width: 4, height: 3 }, buffer32: new Uint32Array(12),
              markDirtyRect() {}, groundQueries: 0,
              groundMask: { hasGroundAt: (gx, gy) => { display.groundQueries += 1; return (gx + gy) % 2 === 0; } }
            });
            let display = makeDisplay();
            display.drawFrameFlags(frame, x, y, { onlyOverwrite, noOverwrite, isUpsideDown });
            const actual = Array.from(display.buffer32);
            const actualQueries = display.groundQueries;
            display = makeDisplay();
            display._blit(frame, x, y, { checkGround: true, onlyOverwrite, noOverwrite, upsideDown: isUpsideDown, groundMask: display.groundMask });
            expect(actual).to.deep.equal(Array.from(display.buffer32));
            expect(actualQueries).to.equal(onlyOverwrite || noOverwrite ? display.groundQueries : 0);
          }
        }
      }
    }
  });

  it('reuses unchanged scalars while keeping changed prev/next snapshots immutable and keyframe ticks separate', function() {
    const { history, game, timer, victory } = createHistoryFixture();
    const oldVictory = Object.freeze(history._victoryState);
    const oldTimer = Object.freeze(history._timerState);
    const oldGame = Object.freeze(history._gameState);
    timer.tickIndex = 1;
    const unchanged = {};
    history._diffScalarState(game, unchanged);
    expect(unchanged).to.deep.equal({});
    expect(history._victoryState).to.equal(oldVictory);
    expect(history._timerState).to.equal(oldTimer);
    expect(history._gameState).to.equal(oldGame);
    expect(history._readTimer(timer, { includeTickIndex: true }, oldTimer)).to.deep.equal({ speedFactor: 1, frameTime: 60, tickIndex: 1 });
    victory.survivorCount = 1;
    timer.speedFactor = 2;
    game.finalGameState = 3;
    const changed = {};
    history._diffScalarState(game, changed);
    expect(changed.victoryChanges.prev).to.equal(oldVictory);
    expect(changed.timerChanges.prev).to.equal(oldTimer);
    expect(changed.gameChanges.prev).to.equal(oldGame);
    expect(changed.victoryChanges.next.survivorCount).to.equal(1);
    expect(changed.timerChanges.next.speedFactor).to.equal(2);
    expect(changed.gameChanges.next.finalGameState).to.equal(3);
    victory.survivorCount = 2;
    timer.speedFactor = 4;
    game.finalGameState = 5;
    history._diffScalarState(game, {});
    expect(changed.victoryChanges.next.survivorCount).to.equal(1);
    expect(changed.timerChanges.next.speedFactor).to.equal(2);
    expect(changed.gameChanges.next.finalGameState).to.equal(3);
  });
});
