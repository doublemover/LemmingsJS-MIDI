import { expect } from 'chai';
import { ProcgenController } from '../js/app/procgenController.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import {
  SOLVER_EXPLANATION_CODES,
  SOLVER_RESULT_TYPES,
  createSolverResult
} from '../js/solver/SolverTypes.js';

const walkAction = { getActionName: () => 'walk' };
const actionNamed = name => ({ getActionName: () => name });

const makeLemming = (id, x, {
  y = 60,
  lookRight = true,
  actionName = 'walk',
  removed = false,
  disabled = false,
  state = 0,
  hasParachute = false
} = {}) => ({
  id,
  x,
  y,
  lookRight,
  removed,
  disabled,
  state,
  hasParachute,
  action: actionNamed(actionName)
});

const createFrontierFixture = (lemmings, options = {}) => {
  let tick = 0;
  const manager = {
    lemmings,
    activeLemmings: lemmings,
    selectedIndex: -1,
    getLemming(id) {
      return this.lemmings.find(lem => lem?.id === id) || null;
    }
  };
  const controller = new ProcgenController({
    game: {
      getLemmingManager: () => manager,
      getGameTimer: () => ({ tickIndex: tick })
    },
    level: {
      width: 1000,
      height: 160,
      entrances: [{ x: 64, y: 80 }]
    },
    options
  });
  return {
    controller,
    manager,
    advance(delta = 1) {
      tick += delta;
      return tick;
    }
  };
};

describe('ProcgenController', function () {
  it('finds nearest hazard trigger in both scan directions', function () {
    const level = {
      triggers: [
        { type: TriggerTypes.TRAP, x1: 22, x2: 26, y1: 0, y2: 12 },
        { type: TriggerTypes.FRYING, x1: 15, x2: 16, y1: 0, y2: 12 },
        { type: TriggerTypes.DROWN, x1: 7, x2: 9, y1: 0, y2: 12 },
        { type: TriggerTypes.EXIT_LEVEL, x1: 13, x2: 14, y1: 0, y2: 12 }
      ]
    };
    const controller = new ProcgenController({ level });
    controller._rebuildHazardIndex();

    const right = controller._findHazardAhead(12, 6, 20, 1);
    expect(right).to.deep.equal({ dx: 3, type: TriggerTypes.FRYING });

    const left = controller._findHazardAhead(12, 6, 20, -1);
    expect(left).to.deep.equal({ dx: 4, type: TriggerTypes.DROWN });
  });

  it('prunes stale tracking state and offscreen gap backlog', function () {
    const manager = {
      lemmings: [{ id: 1, removed: false, disabled: false }]
    };
    const controller = new ProcgenController({
      game: { getLemmingManager: () => manager },
      level: {}
    });
    controller.fallEventMemoryTicks = 40;
    controller._cameraX = 300;
    controller._seenFalls.set(1, 145);
    controller._seenFalls.set(2, 10);
    controller._aiLemmingCooldown.set(1, 170);
    controller._aiLemmingCooldown.set(2, 20);
    controller._aiStallState.set(2, { stallTicks: 99 });
    controller._gaps = [
      { x: 20, width: 6, assigned: false },
      { x: 180, width: 8, assigned: true }
    ];

    controller._pruneTrackingState(150);

    expect(controller._seenFalls.has(1)).to.equal(true);
    expect(controller._seenFalls.has(2)).to.equal(false);
    expect(controller._aiLemmingCooldown.has(1)).to.equal(true);
    expect(controller._aiLemmingCooldown.has(2)).to.equal(false);
    expect(controller._aiStallState.has(2)).to.equal(false);
    expect(controller._gaps).to.have.length(1);
    expect(controller._gaps[0].x).to.equal(180);
  });

  it('cleans up obsolete gaps even when no lemmings are present', function () {
    const manager = { lemmings: [] };
    const controller = new ProcgenController({
      game: { getLemmingManager: () => manager },
      level: {}
    });
    controller._cameraX = 260;
    controller._gaps = [
      { x: 8, width: 4, assigned: false },
      { x: 120, width: 12, assigned: false }
    ];

    controller._processGapBridges();

    expect(controller._gaps).to.have.length(1);
    expect(controller._gaps[0].x).to.equal(120);
  });

  it('uses injected rng streams for deterministic procgen decisions', function () {
    const sequence = [0.1, 0.9, 0.2, 0.75, 0.33];
    let index = 0;
    const controller = new ProcgenController({
      level: { width: 200, height: 80 },
      options: {
        rng: () => sequence[(index++) % sequence.length]
      }
    });
    index = 0;

    expect(controller._randInt(1, 10)).to.equal(2);
    const plan = controller._seedStructurePlan();
    expect(plan.type).to.equal('staircase');
    expect(plan.remaining).to.equal(5);
    expect(plan.step).to.equal(3);
    expect(plan.direction).to.equal(-1);
  });

  it('advances and compacts gap scan cursor for large backlogs', function () {
    const controller = new ProcgenController({ level: {} });
    controller._gaps = Array.from({ length: 600 }, (_, i) => ({
      x: i * 5,
      width: 3,
      assigned: false
    }));

    controller._pruneGapQueue(2200);

    expect(controller._gapScanStart).to.equal(0);
    expect(controller._gaps.length).to.be.lessThan(600);
    expect(controller._gaps[0].x).to.be.at.least(2000);
  });

  it('reuses scan-cache results inside a single AI decision window', function () {
    let gapDepthCalls = 0;
    let wallHeightCalls = 0;
    const ground = {
      getColumnGapDepth() {
        gapDepthCalls += 1;
        return 1;
      },
      getColumnWallHeight() {
        wallHeightCalls += 1;
        return 0;
      }
    };
    const controller = new ProcgenController({
      level: {
        height: 80,
        groundMask: ground,
        triggers: []
      }
    });
    const lemming = { x: 40, y: 50, lookRight: true };

    controller._beginScanCacheWindow(100);
    controller._scanAhead(lemming);
    const firstGapCalls = gapDepthCalls;
    const firstWallCalls = wallHeightCalls;

    controller._scanAhead(lemming);
    expect(gapDepthCalls).to.equal(firstGapCalls);
    expect(wallHeightCalls).to.equal(firstWallCalls);

    controller._beginScanCacheWindow(101);
    controller._scanAhead(lemming);
    expect(gapDepthCalls).to.be.greaterThan(firstGapCalls);
    expect(wallHeightCalls).to.be.greaterThan(firstWallCalls);
  });

  it('streams selected-theme pieces ahead of the live frontier', function () {
    const lemming = makeLemming(5, 60);
    const piece = {
      id: 'route-cap',
      styleName: 'crystal',
      width: 10,
      height: 4,
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 9,
        maxY: 3,
        width: 10,
        height: 4
      }
    };
    const stamps = [];
    const controller = new ProcgenController({
      game: {
        getLemmingManager: () => ({
          lemmings: [lemming],
          activeLemmings: [lemming]
        }),
        getGameTimer: () => ({ tickIndex: 10 })
      },
      level: {
        width: 400,
        height: 120,
        entrances: [{ x: 64, y: 80 }]
      },
      assets: {
        styleName: 'crystal',
        pickGroundPiece() {
          return piece;
        },
        pickDecorPiece() {
          return null;
        }
      },
      stamper: {
        stamp(stampedPiece, x, y) {
          stamps.push({ stampedPiece, x, y });
          return {
            x: x + stampedPiece.bounds.minX,
            y: y + stampedPiece.bounds.minY,
            width: stampedPiece.bounds.width,
            height: stampedPiece.bounds.height
          };
        }
      },
      options: {
        selectedTheme: 'crystal',
        rng: () => 0,
        groundHeight: 4,
        segmentMinWidth: 40,
        segmentMaxWidth: 40,
        lookAheadMin: 80,
        lookAheadMax: 80,
        gapChance: 0,
        decorChance: 0,
        recentChunkLimit: 4,
        recentPieceLimit: 16
      }
    });
    controller._groundEndX = 100;
    controller._groundTopY = 100;
    controller._sustainBaseY = 100;
    controller._sustainRemaining = 100;
    controller._terrainPlan = { mode: 'flat', remaining: 100 };

    controller._ensureGround(lemming.x);
    const debug = controller.getDebugState();

    expect(stamps.length).to.be.greaterThan(0);
    expect(debug.selectedTheme).to.equal('crystal');
    expect(debug.frontier.id).to.equal(5);
    expect(debug.generatedEndX - debug.frontier.x).to.be.greaterThan(debug.lookahead.distance);
    expect(debug.recentPieces).to.have.length.of.at.most(16);
    expect(debug.recentPieces.every(entry => entry.theme === 'crystal')).to.equal(true);
    expect(debug.recentChunks.every(entry => entry.theme === 'crystal')).to.equal(true);
  });

  it('records accepted procgen challenge certificates for generated gaps', function () {
    const controller = new ProcgenController({
      level: {
        width: 120,
        height: 80,
        entrances: [{ x: 8, y: 40 }],
        setGroundRect() {}
      },
      options: {
        rng: () => 0,
        groundHeight: 4,
        segmentMinWidth: 12,
        segmentMaxWidth: 12,
        lookAheadMin: 24,
        lookAheadMax: 24,
        gapChance: 1,
        gapMinWidth: 5,
        gapMaxWidth: 5
      }
    });
    controller._groundEndX = 10;
    controller._groundTopY = 60;
    controller._sustainBaseY = 60;
    controller._sustainRemaining = 100;
    controller._terrainPlan = { mode: 'flat', remaining: 100 };

    controller._ensureGround(0);
    const debug = controller.getDebugState();

    expect(debug.recentCertificates.some(entry => {
      return entry.challengeType === 'bridge-gap' && entry.decision === 'accept';
    })).to.equal(true);
    expect(debug.recentChunks.some(entry => {
      return entry.type === 'gap' && entry.certificateDecision === 'accept';
    })).to.equal(true);
  });

  it('simplifies generated gaps when certificate verification rejects builder budget', function () {
    const controller = new ProcgenController({
      level: {
        width: 160,
        height: 80,
        entrances: [{ x: 8, y: 40 }],
        setGroundRect() {}
      },
      options: {
        rng: () => 0,
        groundHeight: 4,
        segmentMinWidth: 12,
        segmentMaxWidth: 12,
        lookAheadMin: 24,
        lookAheadMax: 24,
        gapChance: 1,
        gapMinWidth: 20,
        gapMaxWidth: 20,
        procgenCertificateVerifier: () => createSolverResult({
          resultType: SOLVER_RESULT_TYPES.FAILED,
          summary: 'gap exceeds injected builder budget',
          explanations: [SOLVER_EXPLANATION_CODES.GAP_EXCEEDS_BUILDER_BUDGET]
        })
      }
    });
    controller._groundEndX = 10;
    controller._groundTopY = 60;
    controller._sustainBaseY = 60;
    controller._sustainRemaining = 100;
    controller._terrainPlan = { mode: 'flat', remaining: 100 };

    controller._ensureGround(0);
    const debug = controller.getDebugState();
    const simplified = debug.recentChunks.find(entry => entry.certificateDecision === 'simplify');

    expect(controller._gaps[0].width).to.equal(8);
    expect(simplified).to.include({
      type: 'gap',
      certificateDecision: 'simplify',
      certificateResultType: SOLVER_RESULT_TYPES.FAILED
    });
  });

  it('extends terrain instead of placing rejected no-route gaps', function () {
    const painted = [];
    const controller = new ProcgenController({
      level: {
        width: 160,
        height: 80,
        entrances: [{ x: 8, y: 40 }],
        setGroundRect(x, y, width, height) {
          painted.push({ x, y, width, height });
        }
      },
      options: {
        rng: () => 0,
        groundHeight: 4,
        segmentMinWidth: 12,
        segmentMaxWidth: 12,
        lookAheadMin: 24,
        lookAheadMax: 24,
        gapChance: 1,
        gapMinWidth: 6,
        gapMaxWidth: 6,
        procgenCertificateVerifier: () => createSolverResult({
          resultType: SOLVER_RESULT_TYPES.FAILED,
          summary: 'missing route after injected verification',
          explanations: [SOLVER_EXPLANATION_CODES.NO_ROUTE_TO_EXIT]
        })
      }
    });
    controller._groundEndX = 10;
    controller._groundTopY = 60;
    controller._sustainBaseY = 60;
    controller._sustainRemaining = 100;
    controller._terrainPlan = { mode: 'flat', remaining: 100 };

    controller._ensureGround(0);
    const debug = controller.getDebugState();
    const fallback = debug.recentChunks.find(entry => entry.type === 'solver-fallback');

    expect(painted.length).to.be.greaterThan(0);
    expect(controller._gaps).to.have.length(0);
    expect(fallback).to.include({
      originalType: 'gap',
      certificateDecision: 'extend',
      certificateResultType: SOLVER_RESULT_TYPES.FAILED
    });
  });

  it('tracks the rightmost viable frontier instead of the first lemming id', function () {
    const manager = {
      lemmings: [
        { id: 0, x: 100, y: 60, lookRight: false, action: walkAction },
        { id: 1, x: 95, y: 60, lookRight: true, action: walkAction },
        { id: 2, x: 40, y: 60, lookRight: true, removed: true, action: walkAction }
      ]
    };
    const controller = new ProcgenController({
      game: {
        getLemmingManager: () => manager,
        getGameTimer: () => ({ tickIndex: 12 })
      },
      level: { width: 200, height: 120 },
      assets: { styleName: 'dirt' },
      options: { rngSeed: 123 }
    });

    const debug = controller.getDebugState();

    expect(debug.selectedTheme).to.equal('dirt');
    expect(debug.seed).to.equal(123);
    expect(debug.frontier.id).to.equal(1);
    expect(debug.frontier.x).to.equal(95);
    expect(debug.frontier.viableCount).to.equal(2);
  });

  it('ignores selected lemming changes and falls back when the lead is removed', function () {
    const lems = [
      makeLemming(0, 120),
      makeLemming(1, 190),
      makeLemming(2, 250, { actionName: 'splatter' })
    ];
    const { controller, manager, advance } = createFrontierFixture(lems);

    manager.selectedIndex = 0;
    expect(controller._getFrontierLemming().id).to.equal(1);

    manager.selectedIndex = 1;
    advance();
    expect(controller._getFrontierLemming().id).to.equal(1);

    lems[1].removed = true;
    advance();
    expect(controller._getFrontierLemming().id).to.equal(0);
    expect(controller._getFrontierSummary().reason).to.equal('walk');
  });

  it('drops stuck turnaround leads but keeps moving turnaround leads viable', function () {
    const lead = makeLemming(7, 260, { lookRight: false });
    const follower = makeLemming(3, 240);
    const { controller, advance } = createFrontierFixture([lead, follower], {
      frontierStuckTicks: 2,
      frontierTurnaroundPenalty: 12
    });

    expect(controller._getFrontierState({ force: true }).id).to.equal(7);

    advance();
    follower.x += 1;
    controller._getFrontierState({ force: true });
    advance();
    follower.x += 1;
    const afterStall = controller._getFrontierState({ force: true });

    expect(afterStall.id).to.equal(3);
    expect(afterStall.reason).to.equal('walk');
  });

  it('keeps recoverable falling leads viable and skips lethal falls', function () {
    const fallingLead = makeLemming(8, 280, {
      actionName: 'falling',
      state: 12
    });
    const follower = makeLemming(2, 230);
    const { controller, advance } = createFrontierFixture([fallingLead, follower]);

    expect(controller._getFrontierState({ force: true }).id).to.equal(8);

    fallingLead.state = 100;
    advance();
    expect(controller._getFrontierState({ force: true }).id).to.equal(2);

    fallingLead.hasParachute = true;
    advance();
    expect(controller._getFrontierState({ force: true }).id).to.equal(8);
  });

  it('bounds frontier, assist, fall, and gap tracking growth', function () {
    const { controller } = createFrontierFixture([
      makeLemming(1, 100),
      makeLemming(2, 120)
    ], {
      frontierMaxTrackedLemmings: 3,
      gapTrackingLimit: 3
    });
    for (let id = 1; id <= 12; id += 1) {
      controller._frontierLemmingState.set(id, { lastSeenTick: id });
      controller._aiLemmingCooldown.set(id, id);
      controller._aiStallState.set(id, { lastSeenTick: id });
      controller._seenFalls.set(id, id);
    }
    controller._gaps = Array.from({ length: 10 }, (_, index) => ({
      x: index * 20,
      width: 4,
      assigned: false
    }));

    controller._pruneTrackingState(500);

    expect(controller._frontierLemmingState.size).to.be.at.most(3);
    expect(controller._aiLemmingCooldown.size).to.be.at.most(3);
    expect(controller._aiStallState.size).to.be.at.most(3);
    expect(controller._seenFalls.size).to.be.at.most(3);
    expect(controller._gaps.length).to.be.at.most(3);
    expect(controller._frontierLemmingState.has(1)).to.equal(true);
    expect(controller._frontierLemmingState.has(2)).to.equal(true);
  });

  it('records no-op decisions for traversable terrain', function () {
    const calls = [];
    const controller = new ProcgenController({
      game: {
        getLemmingManager: () => ({
          doLemmingAction(_lem, skill) {
            calls.push(skill);
            return true;
          }
        }),
        getGameTimer: () => ({ tickIndex: 20 })
      },
      level: { width: 200, height: 120 }
    });
    controller._initAiDirector();
    const lemming = { id: 1, x: 30, y: 60, lookRight: true, action: walkAction };

    const result = controller._decideAssist(lemming, {
      direction: 1,
      gap: null,
      wall: null,
      hazard: null
    }, 20);

    expect(result).to.equal(null);
    expect(calls).to.deep.equal([]);
    expect(controller.getDebugState().recentAssists.at(-1)).to.include({
      type: 'noop',
      reason: 'traversable',
      spent: false
    });
  });

  it('records safe drops without spending a skill', function () {
    const calls = [];
    const controller = new ProcgenController({
      game: {
        getLemmingManager: () => ({
          doLemmingAction(_lem, skill) {
            calls.push(skill);
            return true;
          }
        }),
        getGameTimer: () => ({ tickIndex: 30 })
      },
      level: { width: 200, height: 120 }
    });
    controller._initAiDirector();
    const lemming = { id: 1, x: 30, y: 60, lookRight: true, action: walkAction };

    const result = controller._decideAssist(lemming, {
      direction: 1,
      gap: { dx: 2, width: 1, drop: 4 },
      wall: null,
      hazard: null
    }, 30);

    expect(result).to.equal(null);
    expect(calls).to.deep.equal([]);
    expect(controller.getDebugState().recentAssists.at(-1)).to.include({
      type: 'noop',
      reason: 'safe-drop',
      spent: false
    });
  });

  it('uses minimal skills for small gaps and small barriers', function () {
    const calls = [];
    const controller = new ProcgenController({
      game: {
        getLemmingManager: () => ({
          doLemmingAction(_lem, skill) {
            calls.push(skill);
            return true;
          }
        }),
        getGameTimer: () => ({ tickIndex: 40 })
      },
      level: { width: 200, height: 120 }
    });
    controller._initAiDirector();
    const gapLemming = { id: 1, x: 30, y: 60, lookRight: true, action: walkAction };
    const barrierLemming = { id: 2, x: 50, y: 60, lookRight: true, action: walkAction };

    const gapResult = controller._decideAssist(gapLemming, {
      direction: 1,
      gap: { dx: 3, width: 4, drop: 2 },
      wall: null,
      hazard: null
    }, 40);
    const barrierResult = controller._decideAssist(barrierLemming, {
      direction: 1,
      gap: null,
      wall: { dx: 2, height: controller.maxStepUp + 2 },
      hazard: null
    }, 45);

    expect(gapResult).to.equal('builder');
    expect(barrierResult).to.equal('bash');
    expect(calls).to.deep.equal([SkillTypes.BUILDER, SkillTypes.BASHER]);
    const assists = controller.getDebugState().recentAssists;
    expect(assists.some(assist => assist.reason === 'small-gap' && assist.skillName === 'builder')).to.equal(true);
    expect(assists.some(assist => assist.reason === 'small-barrier' && assist.skillName === 'basher')).to.equal(true);
  });
});
