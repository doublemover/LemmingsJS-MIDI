import { expect } from 'chai';
import {
  createBarrierFixture,
  createFlatWalkFixture,
  createSmallGapFixture,
  createSyntheticSolverFixture
} from '../js/solver/SolverFixtures.js';
import {
  extractSolverState,
  stableHash
} from '../js/solver/SolverState.js';
import { analyzeSolverGeometry } from '../js/solver/SolverGeometry.js';
import { Level } from '../js/level/Level.js';
import { Trigger } from '../js/level/Trigger.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
import { SkillTypes } from '../js/game/SkillTypes.js';
import { Range } from '../js/util/Range.js';

const setGroundRow = (level, y, x1, x2) => {
  for (let x = x1; x <= x2; x += 1) {
    level.groundMask.setGroundAt(x, y);
  }
};

describe('solver state and geometry foundations', function() {
  it('extracts deterministic snapshots and stable hashes from synthetic fixtures', function() {
    const first = extractSolverState(createFlatWalkFixture());
    const second = extractSolverState(createFlatWalkFixture());

    expect(first.snapshotHash).to.equal(second.snapshotHash);
    expect(first.terrainHash).to.equal(second.terrainHash);
    expect(first.terrainMutationHash).to.equal(second.terrainMutationHash);
    expect(stableHash({ b: 2, a: 1 })).to.equal(stableHash({ a: 1, b: 2 }));

    const mutated = createFlatWalkFixture();
    mutated.baseGroundMask = new Uint8Array(mutated.groundMask);
    mutated.groundMask[52 * mutated.width] = 0;
    const changed = extractSolverState(mutated);

    expect(changed.terrainHash).to.equal(first.terrainHash);
    expect(changed.terrainMutationHash).to.not.equal(first.terrainMutationHash);
  });

  it('normalizes terrain, steel, one-way, hazards, lemmings, skills, timer, and victory fields', function() {
    const fixture = createSyntheticSolverFixture({
      id: 'state-fields',
      width: 80,
      height: 48,
      ground: [{ x: 0, y: 40, width: 80, height: 4 }],
      steel: [{ x: 10, y: 38, width: 3, height: 2 }],
      oneWay: [{ x: 20, y: 36, width: 8, height: 4, direction: 'right' }],
      hazards: [{ x: 34, y: 38, width: 6, height: 4, kind: 'water' }],
      entrances: [{ x: 4, y: 39 }],
      exits: [{ x: 72, y: 39 }],
      lemmings: [{ id: 3, x: 5, y: 39, lookRight: false, action: 'walking', canClimb: true }],
      skills: { builder: 2, digger: 1 },
      timer: { tick: 42, timeLimit: 120 },
      needCount: 2,
      releaseCount: 5
    });

    const snapshot = extractSolverState(fixture);

    expect(snapshot.id).to.equal('state-fields');
    expect(snapshot.terrain.solidCount).to.equal(320);
    expect(snapshot.steel.solidCount).to.equal(6);
    expect(snapshot.steel.constraints[0]).to.include({ x: 10, y: 38, width: 3, height: 2 });
    expect(snapshot.oneWay[0]).to.include({ x: 20, y: 36, width: 8, height: 4, direction: 'right' });
    expect(snapshot.hazards[0]).to.include({ x: 34, y: 38, width: 6, height: 4, kind: 'water' });
    expect(snapshot.entrances[0]).to.include({ x: 4, y: 39, width: 1, height: 1 });
    expect(snapshot.exits[0]).to.include({ x: 72, y: 39, width: 1, height: 1 });
    expect(snapshot.lemmings[0]).to.include({ id: 3, x: 5, y: 39, direction: 'left', canClimb: true });
    expect(snapshot.skills.counts).to.include({ builder: 2, digger: 1 });
    expect(snapshot.timer).to.include({ tick: 42, timeLimit: 120 });
    expect(snapshot.victory).to.include({ needCount: 2, releaseCount: 5 });
  });

  it('extracts constraints and triggers from Level-like objects', function() {
    const level = new Level(96, 64);
    level.id = 'level-like-state';
    setGroundRow(level, 52, 0, 95);
    level.steelMask.setMaskAt(12, 52);
    level.setSteelAreas([Object.assign(new Range(), { x: 12, y: 50, width: 4, height: 3 })]);
    level.setArrowAreas([Object.assign(new Range(), { x: 24, y: 48, width: 8, height: 4, direction: 1 })]);
    level.entrances.push({ x: 6, y: 51 });
    level.triggers.push(new Trigger(TriggerTypes.EXIT_LEVEL, 82, 47, 90, 54));
    level.triggers.push(new Trigger(TriggerTypes.DROWN, 44, 50, 48, 56));
    level.skills[SkillTypes.BUILDER] = 4;
    level.releaseCount = 10;
    level.needCount = 7;
    level.timeLimit = 5;

    const snapshot = extractSolverState(level);

    expect(snapshot.sourceKind).to.equal('level');
    expect(snapshot.steel.constraints[0]).to.include({ x: 12, y: 50, width: 4, height: 3 });
    expect(snapshot.oneWay[0]).to.include({ x: 24, y: 48, width: 8, height: 4, direction: 'right' });
    expect(snapshot.exits[0]).to.include({ x: 82, y: 47, width: 8, height: 7, kind: 'exit' });
    expect(snapshot.hazards[0]).to.include({ x: 44, y: 50, width: 4, height: 6, kind: 'drown' });
    expect(snapshot.skills.counts.builder).to.equal(4);
    expect(snapshot.victory).to.include({ needCount: 7, releaseCount: 10 });
  });

  it('finds walkable surfaces and continuous routes on flat fixtures', function() {
    const geometry = analyzeSolverGeometry(createFlatWalkFixture());

    expect(geometry.surfaces).to.have.length(1);
    expect(geometry.surfaces[0]).to.include({ x: 0, y: 51, width: 120 });
    expect(geometry.landingZones[0]).to.include({ surfaceId: 0, safe: true });
    expect(geometry.routeContinuity.continuous).to.equal(true);
    expect(geometry.routeContinuity.blocked).to.equal(false);
  });

  it('detects small gaps and preserves bridgeable route continuity', function() {
    const geometry = analyzeSolverGeometry(createSmallGapFixture());
    const gap = geometry.gaps.find(item => item.width === 10);

    expect(gap).to.include({
      x: 48,
      y: 57,
      width: 10,
      isSmall: true,
      bridgeable: true
    });
    expect(geometry.routeContinuity.continuous).to.equal(true);
  });

  it('detects barriers and blocks direct route continuity', function() {
    const geometry = analyzeSolverGeometry(createBarrierFixture());

    expect(geometry.barriers).to.have.length(1);
    expect(geometry.barriers[0]).to.include({ x: 62, y: 48, width: 8, height: 10 });
    expect(geometry.routeContinuity.continuous).to.equal(false);
    expect(geometry.routeContinuity.reachableSurfaceIds).to.include(0);
  });

  it('computes cliff fall distances and landing zones', function() {
    const fixture = createSyntheticSolverFixture({
      id: 'safe-fall',
      width: 96,
      height: 64,
      ground: [
        { x: 0, y: 31, width: 21, height: 3 },
        { x: 21, y: 45, width: 70, height: 3 }
      ],
      entrances: [{ x: 6, y: 30 }],
      exits: [{ x: 70, y: 44 }]
    });

    const geometry = analyzeSolverGeometry(fixture);
    const cliff = geometry.cliffs.find(item => item.surfaceId === 0 && item.side === 'right');

    expect(cliff).to.include({ x: 21, y: 30, fallDistance: 14, safe: true });
    expect(cliff.landing).to.include({ x: 21, y: 44, surfaceId: 1 });
    expect(geometry.landingZones[1].incomingFalls[0]).to.include({ fromSurfaceId: 0, fallDistance: 14 });
    expect(geometry.routeContinuity.continuous).to.equal(true);
  });

  it('marks large gap routes as discontinuous', function() {
    const fixture = createSyntheticSolverFixture({
      id: 'large-gap',
      width: 128,
      height: 64,
      ground: [
        { x: 0, y: 52, width: 32, height: 4 },
        { x: 82, y: 52, width: 46, height: 4 }
      ],
      entrances: [{ x: 8, y: 51 }],
      exits: [{ x: 100, y: 51 }]
    });

    const geometry = analyzeSolverGeometry(fixture);
    const gap = geometry.gaps.find(item => item.width === 50);

    expect(gap).to.include({ isSmall: false, bridgeable: false });
    expect(geometry.routeContinuity.continuous).to.equal(false);
    expect(geometry.routeContinuity.blocked).to.equal(true);
  });
});
