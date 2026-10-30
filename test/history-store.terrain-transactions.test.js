import { expect } from 'chai';
import { HistoryStore } from '../js/game/HistoryStore.js';
import { Level } from '../js/level/Level.js';
import { ColorPalette } from '../js/render/ColorPalette.js';
import { ActionBuildSystem } from '../js/actions/ActionBuildSystem.js';
import { ActionDiggSystem } from '../js/actions/ActionDiggSystem.js';
import { TimeTravelController } from '../js/game/TimeTravelController.js';
import { createHistoryFixture, recordTick } from './support/history-fixtures.js';

const snapshot = level => ({ mask: new Uint8Array(level.groundMask.mask), image: new Uint8ClampedArray(level.groundImage) });
const setup = ({ nonempty = false, cold = false } = {}) => {
  const fixture = createHistoryFixture(); fixture.history.detach();
  const level = new Level(32, 16); level.groundImage = new Uint8ClampedArray(32 * 16 * 4); level.colorPalette = new ColorPalette();
  level.colorPalette.setColorRGB(7, 20, 40, 60); level.colorPalette.setColorRGB(9, 80, 90, 100);
  if (nonempty) for (let x = 3; x < 14; x++) level.setGroundAt(x, 5, 9);
  fixture.game.level = level;
  const history = new HistoryStore({ keyframeInterval: 5, enableColdBlockCompression: cold, deltaBlockSizeTicks: 4, coldBlockAgeTicks: 1, coldCompactionIntervalTicks: 1, coldCompactionMaxBlocksPerSweep: 64 });
  level.runtime = { history }; history.attach(fixture.game, { captureBaseline: true });
  const build = x => new ActionBuildSystem().process(level, { id: x, x, y: 6, lookRight: true, frameIndex: 8, state: 0 });
  const dig = x => new ActionDiggSystem().digRow(level, { id: 100 + x, x, y: 6, frameIndex: 0 }, 5);
  return { ...fixture, history, level, build, dig };
};
const cases = [
  { name: 'one builder control', mutate: ({ build }) => build(4) },
  { name: 'disjoint builders control', mutate: ({ build }) => { build(4); build(18); } },
  { name: 'overlapping identical builders and same-value writes', mutate: ({ build }) => { build(4); build(4); } },
  { name: 'partially overlapping builder spans', mutate: ({ build }) => { build(4); build(7); } },
  { name: 'builder followed by actual digger row', mutate: ({ build, dig }) => { build(4); dig(6); } },
  { name: 'original solid pixels with changed colors', nonempty: true, mutate: ({ build, dig }) => { build(4); build(7); dig(8); } },
  { name: 'interleaved repeated indices and partially overlapping spans', mutate: ({ level }) => {
    for (const [x, palette] of [[4, 7], [5, 7], [9, 9], [4, 9], [6, 7], [7, 7], [5, 9], [6, 9], [4, 7]]) level.setGroundAt(x, 5, palette);
  } }
];

describe('terrain write transaction reversal (#1264; execution deferred)', () => {
  for (const storage of ['warm', 'cold-decode', 'thawed']) for (const scenario of cases) {
    it('restores complete authoritative mask/RGB for ' + scenario.name + ' through ' + storage, () => {
      const fixture = setup({ nonempty: scenario.nonempty, cold: storage !== 'warm' }), { history, timer, game, level } = fixture;
      const initial = snapshot(level); recordTick(history, timer, 0, () => scenario.mutate(fixture)); const final = snapshot(level);
      if (storage !== 'warm') {
        for (let tick = 1; tick < 10; tick++) recordTick(history, timer, tick);
        expect(history.deltas[0]).to.equal(1); expect(history.getHistoryStats().coldBlockCount).to.be.greaterThan(0);
        if (storage === 'thawed') history._thawDeltaBlock(0);
      }
      const delta = history.getDelta(0); expect(delta.groundChanges.prevMask.length).to.be.greaterThan(0);
      for (let cycle = 0; cycle < 3; cycle++) {
        history.applyDeltaBackward(game, delta); expect(snapshot(level)).to.deep.equal(initial);
        history.applyDeltaForward(game, delta); expect(snapshot(level)).to.deep.equal(final);
      }
      history.detach();
    });
  }
  it('also reverses uncompressed index logs in exact write order', () => {
    const { history, level } = setup(), initial = snapshot(level);
    history.beginTick(0); level.setGroundAt(4, 5, 7); level.setGroundAt(5, 5, 9); level.setGroundAt(4, 5, 9); level.clearGroundAt(5, 5);
    const changes = history._currentDelta.groundChanges, final = snapshot(level); expect(changes.spans).to.equal(null);
    history._applyGroundChanges(level, changes, false); expect(snapshot(level)).to.deep.equal(initial);
    history._applyGroundChanges(level, changes, true); expect(snapshot(level)).to.deep.equal(final); history.pause(); history.detach();
  });
  for (const cold of [false, true]) it('restores and branches actual terrain through TimeTravelController with cold=' + cold, () => {
    const { history, timer, game, level, build, dig } = setup({ cold }), initial = snapshot(level);
    recordTick(history, timer, 0, () => { build(4); build(4); dig(6); }); const originalFinal = snapshot(level);
    if (cold) for (let tick = 1; tick < 10; tick++) recordTick(history, timer, tick);
    const controller = new TimeTravelController(game, history); controller.seekToTick(1); expect(snapshot(level)).to.deep.equal(originalFinal);
    controller.stepBackward(1); expect(timer.tickIndex).to.equal(0); expect(snapshot(level)).to.deep.equal(initial); expect(level.hasGroundAt(4, 5)).to.equal(false);
    controller.seekToTick(1); expect(snapshot(level)).to.deep.equal(originalFinal); controller.stepBackward(1);
    history.truncateAfter(timer.tickIndex); history.resume(); recordTick(history, timer, 0, () => { build(20); build(20); }); const branched = snapshot(level);
    expect(level.hasGroundAt(4, 5)).to.equal(false); expect(level.hasGroundAt(20, 5)).to.equal(true);
    controller.stepBackward(1); expect(snapshot(level)).to.deep.equal(initial); controller.seekToTick(1); expect(snapshot(level)).to.deep.equal(branched); history.detach();
  });
});
