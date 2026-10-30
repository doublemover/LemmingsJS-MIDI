import { expect } from 'chai';
import { runLongSessionReplayProbe } from '../scripts/LongSessionReplayProbe.js';
import { evaluateLongSessionWork } from '../scripts/LongSessionWorkGates.js';
import { pauseGame, resumeGame, seekGame } from '../js/app/e2e/E2EGameControls.js';
import { TimeTravelController } from '../js/game/TimeTravelController.js';

const setup = (initiallyRunning = true) => {
  let running = initiallyRunning, resumeCalls = 0, historyEnd = 99;
  const deltas = Array.from({ length: 100 }, (_, tick) => ({ tick, dx: 1 }));
  const timer = { tickIndex: 100, isRunning: () => running, suspend() { running = false; }, continue() { resumeCalls++; running = true; } };
  const history = { getDelta: tick => deltas[tick], getKeyframeAtOrBefore: () => ({ tickIndex: 0, x: 0 }),
    applyKeyframe(game, keyframe) { game.x = keyframe.x; }, applyDeltaForward(game, delta) { game.x += delta.dx; } };
  const game = { x: 100, getGameTimer: () => timer, render() {} }; game.timeTravel = new TimeTravelController(game, history); const view = { game };
  const api = { pause: () => pauseGame(view), resume: () => resumeGame(view), seek: tick => seekGame(view, tick), getDelta: history.getDelta,
    getState: () => ({ game: { timer: { tickIndex: timer.tickIndex, running }, history: { minTick: 0, maxTick: historyEnd, deltaCount: historyEnd + 1 }, lemmings: [{ id: 1, x: game.x }] } }) };
  return { api, timer, game, history, get resumeCalls() { return resumeCalls; }, advance(count) {
    for (let i = 0; i < count; i++) { if (!running) throw new Error('Forward timer is paused.'); deltas[timer.tickIndex] = { tick: timer.tickIndex, dx: 1 }; historyEnd = timer.tickIndex++; game.x++; }
  } };
};
const samples = (ticks = [100, 160, 220]) => ticks.map((tickIndex, i) => ({ validTelemetry: true, clockMs: i * 1000, running: true, tickIndex,
  historyDeltaCount: tickIndex, coldBlocksCreated: 0, coldBlocksThawed: 0, coldBlocksRetired: 0 }));
const checks = [{ status: 'complete', checked: true, hashMatch: true, transportRestored: true, wasRunning: true, startedAtMs: 400, endedAtMs: 500 }];
const thresholds = { durationMs: 2000, minimumObservedFraction: 0.85, minimumActiveFraction: 0.85, minimumProgressFraction: 0.8, maximumStalledMs: 3000,
  minimumForwardTicks: 100, minimumReplayChecks: 1, minimumColdBlocksCreated: 0, minimumColdBlocksRetired: 0 };

describe('classic benchmark replay transport transaction (#1257, deferred)', () => {
  it('uses the actual E2E seek/controller owners and continues forward work after every successful probe', () => {
    const fixture = setup();
    for (let i = 0; i < 3; i++) {
      const before = fixture.timer.tickIndex, result = runLongSessionReplayProbe({}, fixture.api);
      expect(result).to.include({ status: 'complete', checked: true, transportRestored: true, wasRunning: true, currentTick: before });
      expect(fixture.timer.tickIndex).to.equal(before); expect(fixture.game.x).to.equal(before); fixture.advance(10);
      expect(fixture.timer.tickIndex).to.equal(before + 10); expect(fixture.game.x).to.equal(before + 10);
    }
    expect(fixture.resumeCalls).to.equal(3);
  });
  it('preserves originally paused state and waits for meaningful history without a seek', () => {
    const paused = setup(false), result = runLongSessionReplayProbe({}, paused.api); expect(result).to.include({ status: 'complete', wasRunning: false, transportRestored: true });
    expect(paused.api.getState().game.timer.running).to.equal(false); expect(paused.resumeCalls).to.equal(0);
    const warming = setup(), warm = runLongSessionReplayProbe({ minimumHistoryTicks: 200 }, warming.api);
    expect(warm).to.include({ status: 'warming-history', checked: false, hashMatch: null }); expect(warming.api.getState().game.timer.running).to.equal(true); expect(warming.resumeCalls).to.equal(0);
  });
  it('fails closed on incomplete target seek, wrong restored state and failed resume', () => {
    const partial = setup(); partial.history.getDelta = tick => tick === 20 ? null : { tick, dx: 1 };
    const failed = runLongSessionReplayProbe({}, partial.api); expect(failed).to.include({ status: 'failed', stage: 'seek-target', transportRestored: false }); expect(partial.resumeCalls).to.equal(0);
    const wrong = setup(), seek = wrong.api.seek; wrong.api.seek = tick => { const result = seek(tick); if (tick === 100) wrong.game.x++; return result; };
    expect(runLongSessionReplayProbe({}, wrong.api)).to.include({ status: 'failed', stage: 'seek-return' }); expect(wrong.resumeCalls).to.equal(0);
    const resume = setup(); resume.api.resume = () => false; expect(runLongSessionReplayProbe({}, resume.api)).to.include({ status: 'failed', stage: 'resume' }); expect(resume.api.getState().game.timer.running).to.equal(false);
  });
  it('admits sustained work and excludes explicit replay time from sampled forward time', () => {
    const result = evaluateLongSessionWork({ samples: samples(), replayChecks: checks, thresholds }); expect(result.failures).to.deep.equal([]);
    expect(result.metrics).to.include({ completedPhysicalTicks: 120, sampledForwardMs: 1900, replayMs: 100, sampledPausedMs: 0 });
  });
  it('rejects tiny initial progress followed by a stalled window, missing transport and unverified probes', () => {
    const stalled = samples([100, 101, 101]); stalled.forEach((sample, i) => { sample.clockMs = i * 150000; });
    const result = evaluateLongSessionWork({ samples: stalled, replayChecks: checks, thresholds: { ...thresholds, durationMs: 300000, minimumForwardTicks: 12000 } });
    expect(result.failures).to.include('completed_physical_work_below_minimum'); expect(result.failures).to.include('physical_work_stalled_during_window');
    const missing = samples(); delete missing[1].running; expect(evaluateLongSessionWork({ samples: missing, replayChecks: checks, thresholds }).failures).to.include('active_work_evidence_missing');
    expect(evaluateLongSessionWork({ samples: samples(), replayChecks: [{ ...checks[0], transportRestored: false }], thresholds }).failures).to.include('replay_transaction_evidence_incomplete');
    expect(evaluateLongSessionWork({ samples: samples(), replayChecks: checks, thresholds: { ...thresholds, minimumColdBlocksCreated: 1 } }).failures).to.include('history_turnover_below_minimum');
  });
});
