import { expect } from 'chai';
import { buildLemmingSummary } from '../mcp/lemmingSummary.js';

describe('buildLemmingSummary', function () {
  it('computes counts and bounded top-k in a single pass', function () {
    const state = {
      stage: {
        viewRect: { x: 0, y: 0, width: 12, height: 12 }
      },
      game: {
        timer: { tickIndex: 42 },
        lemmingManager: { selectedIndex: 0 },
        lemmings: [
          { id: 0, x: 5, y: 5, actionType: 10, state: 1, canClimb: true },
          { id: 1, x: 9, y: 4, actionType: 11, state: 2, countdownActive: true },
          { id: 2, x: 7, y: 6, actionType: 11, state: 2, removed: true, hasExploded: true },
          { id: 3, x: 20, y: 3, actionType: 12, state: 3, disabled: true },
          { id: 4, x: 11, y: 7, actionType: 13, state: 4, hasParachute: true }
        ]
      }
    };

    const summary = buildLemmingSummary(state, { inViewOnly: true, topK: 2 });
    expect(summary.tickIndex).to.equal(42);
    expect(summary.totalCount).to.equal(4);
    expect(summary.activeCount).to.equal(3);
    expect(summary.removedCount).to.equal(1);
    expect(summary.disabledCount).to.equal(0);
    expect(summary.byActionType).to.deep.equal({ 10: 1, 11: 1, 13: 1 });
    expect(summary.byState).to.deep.equal({ 1: 1, 2: 1, 4: 1 });
    expect(summary.climbers).to.equal(1);
    expect(summary.floaters).to.equal(1);
    expect(summary.countingDown).to.equal(1);
    expect(summary.exploded).to.equal(0);
    expect(summary.selectedLemmingId).to.equal(0);
    expect(summary.top.map((lem) => lem.id)).to.deep.equal([0, 1]);
  });

  it('supports top-k without forced selected inclusion and preserves topK=0 behavior', function () {
    const state = {
      game: {
        timer: { tickIndex: 7 },
        lemmingManager: { selectedIndex: 0 },
        lemmings: [
          { id: 0, x: 2, y: 1 },
          { id: 1, x: 6, y: 1, countdownActive: true }
        ]
      }
    };

    const withoutSelected = buildLemmingSummary(state, {
      topK: 1,
      includeSelected: false
    });
    expect(withoutSelected.selected).to.equal(null);
    expect(withoutSelected.top.map((lem) => lem.id)).to.deep.equal([1]);

    const withZeroTop = buildLemmingSummary(state, { topK: 0 });
    expect(withZeroTop.top).to.deep.equal([]);
  });

  it('only fully sorts candidates when explicitly requested', function () {
    const lemmings = [];
    for (let i = 0; i < 60; i += 1) {
      lemmings.push({
        id: i,
        x: (i * 17) % 31,
        y: i % 7,
        countdownActive: i % 9 === 0
      });
    }
    const state = {
      game: {
        lemmingManager: { selectedIndex: -1 },
        lemmings
      }
    };

    const bounded = buildLemmingSummary(state, { topK: 8 });
    const sorted = buildLemmingSummary(state, { topK: 8, sortAllCandidates: true });
    expect(bounded.top.map((lem) => lem.id)).to.deep.equal(sorted.top.map((lem) => lem.id));
  });

  it('returns snapshot copies for selected and top entries', function () {
    const selected = { id: 1, x: 4, y: 2, countdownActive: true };
    const other = { id: 2, x: 3, y: 1 };
    const state = {
      game: {
        timer: { tickIndex: 3 },
        lemmingManager: { selectedIndex: 0 },
        lemmings: [selected, other]
      }
    };

    const summary = buildLemmingSummary(state, { topK: 2 });
    expect(summary.selected).to.not.equal(selected);
    expect(summary.top[0]).to.not.equal(selected);

    summary.selected.x = 999;
    summary.top[0].x = 777;
    expect(selected.x).to.equal(4);
  });
});
