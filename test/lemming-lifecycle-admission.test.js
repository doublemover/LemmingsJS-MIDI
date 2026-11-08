import { expect } from 'chai';
import { makeManager } from './helpers/lemming-manager.js';
import { useGlobalLemmings, withGlobalLemmings } from './helpers/lemmings.js';
import { MiniMap } from '../js/render/MiniMap.js';
import { HistoryStore } from '../js/game/HistoryStore.js';
import { createStubTimer } from './support/history-fixtures.js';
import { LemmingStateType as State } from '../js/lemmings/LemmingStateType.js';

describe('finite birth admission and forward death ownership', () => {
  useGlobalLemmings({ extraLemmings: 0, game: { showDebug: true } });
  const entrances = count => Array.from({ length: count }, (_, i) => ({ x: i * 60, y: 20 }));
  for (const count of [1, 2, 4]) for (const budget of new Set([0, 1, count - 1, count, count + 1, 2 * count + 1])) {
    it(`admits exactly ${budget} finite actors through ${count} entrances`, () => {
      const { manager, gvc, level } = makeManager({ width: 300, height: 120, entrances: entrances(count), releaseCount: budget, releaseRate: 99 });
      const sounds = []; manager.runtime = { soundEvents: { emitSfx: (...event) => sounds.push(event) } };
      for (let batch = 0; batch <= Math.ceil(budget / count); batch++) {
        manager.releaseTickIndex = 103; manager.addNewLemmings();
        const admitted = Math.min(budget, (batch + 1) * count);
        expect(manager.spawnTotal).to.equal(admitted); expect(manager._nextLemmingId).to.equal(admitted);
        expect(gvc.getOutCount()).to.equal(admitted); expect(gvc.getLeftCount()).to.equal(budget - admitted);
        expect(manager.lemmings.map(lem => lem.x)).to.deep.equal(Array.from({ length: admitted }, (_, i) => (i % count) * 60 + 24));
        expect(level.entrances.map(entrance => !!entrance._opened)).to.deep.equal(Array.from({ length: count }, (_, i) => i < Math.min(count, budget)));
      }
      const soundCount = sounds.length; manager.addNewLemmings(); expect(sounds.length).to.equal(soundCount);
      for (const lem of [...manager.lemmings]) manager.removeOne(lem);
      expect(gvc.getOutCount()).to.equal(0); expect(gvc.getLeftCount()).to.equal(0);
      manager.dispose();
    });
  }
  it('retains deliberate endless, benchmark and extra-actor policies', () => {
    for (const mode of [{ endless: true }, { bench: true }, { bench2: true }, { benchReverse: true }, { extraLemmings: 2 }]) {
      withGlobalLemmings({ game: { showDebug: true }, ...mode }, () => {
        const { manager, gvc } = makeManager({ releaseCount: 1, entrances: entrances(2) });
        manager.releaseTickIndex = 103; manager.addNewLemmings();
        expect(manager.spawnTotal).to.equal(mode.extraLemmings ? 3 : 2);
        expect(gvc.getOutCount()).to.equal(mode.endless ? 2 : 1); manager.dispose();
      });
    }
  });
  for (const state of [State.DROWNING, State.OHNO, State.SPLATTING, State.FRYING, State.EXPLODING]) {
    for (const draws of [0, 1, 10]) for (const offscreen of [false, true]) {
      it(`records one final ${state} removal after ${draws} ${offscreen ? 'culled' : 'visible'} and replay draws`, () => {
        const { manager, level, gvc } = makeManager({ width: 300, height: 120, releaseCount: 1 });
        manager.addLemming(40, 40); gvc.releaseOne(); manager.particles = null;
        const timer = createStubTimer(), skills = { selectedSkill: 0, skills: [], cheatMode: false };
        const history = new HistoryStore({ keyframeInterval: 5 });
        const runtime = { history, isReplayApplying: false };
        const miniMap = new MiniMap({}, level, null, runtime); runtime.miniMap = miniMap;
        manager.setMiniMap(miniMap); manager.runtime = runtime;
        for (const action of manager.actions) action?.setRuntime?.(runtime);
        const game = { level, triggerManager: manager.triggerManager, finalGameState: 0,
          getLemmingManager: () => manager, getGameTimer: () => timer, getGameSkills: () => skills, getVictoryCondition: () => gvc };
        const lem = manager.getLemming(0); lem.setRuntime(runtime); manager.setLemmingState(lem, state);
        lem.frameIndex = 15; if (state === State.EXPLODING) lem.action.particleTable = { draw() {} };
        const display = { drawFrame() {}, stage: { getGameViewRect: () => ({ x: offscreen ? 200 : 0, y: 0, w: 100, h: 100 }) } };
        history.attach(game, { captureBaseline: true });
        for (let i = 0; i < draws; i++) manager.render(display);
        runtime.isReplayApplying = true; manager.render(display); runtime.isReplayApplying = false;
        expect(miniMap.deadCount).to.equal(0);
        history.beginTick(0); manager.removeOne(lem); manager.removeOne(lem); timer.tickIndex = 1; history.endTick();
        expect(miniMap.deadCount).to.equal(1); expect(gvc.getOutCount()).to.equal(0);
        const delta = history.getDelta(0); history.applyDeltaBackward(game, delta); expect(miniMap.deadCount).to.equal(0);
        const restored = manager.getLemming(0); expect(restored).to.exist;
        runtime.isReplayApplying = true; for (let i = 0; i < 3; i++) manager.render(display); runtime.isReplayApplying = false;
        expect(miniMap.deadCount).to.equal(0);
        history.applyDeltaForward(game, delta); expect(miniMap.deadCount).to.equal(1);
        manager.addLemming(50, 40); const reused = manager.getLemming(1); manager.removeOne(reused);
        expect(miniMap.deadCount).to.equal(2);
        manager.addLemming(60, 40); const exited = manager.getLemming(2); manager.setLemmingState(exited, State.EXITING); manager.removeOne(exited);
        expect(miniMap.deadCount).to.equal(2); history.detach(); manager.dispose();
      });
    }
  }
});
