import { expect } from 'chai';
import { createProcgenCameraController } from '../js/app/procgen/ProcgenCameraController.js';

const fixture = () => {
  const renderer = { scale: 3, cameraX: 0, cameraY: 0, follow: true,
    canvas: { width: 900, height: 600, addEventListener() {}, removeEventListener() {} },
    world: { height: 1024 * 96, actors: [{ id: 1, x: 600, y: 64 }] }, window: { devicePixelRatio: 1 }, render() {} };
  return { renderer, camera: createProcgenCameraController(renderer) };
};

describe('monotonic ProcGen camera presentation time', () => {
  it('chooses an automatic leader only from the mapped physical rows', () => {
    const f = fixture(), calls = []; f.renderer.workstationLayout = { firstLane: 7, count: 2, mapped: true, laneIndices: [7, 1] };
    f.renderer.actorVisibility = { physicalLeader(first, last) { calls.push([first, last]); return { id: first, x: first === 7 ? 600 : 700, y: first * 96 + 64 }; } };
    f.camera.update(true); expect(calls).to.deep.equal([[7, 8], [1, 2]]); expect(f.renderer.cameraX).to.be.greaterThan(0); f.camera.dispose();
  });
  it('does not count a backward timestamp again in a later camera update', () => {
    const reference = fixture(), reordered = fixture();
    for (const timestamp of [100, 150, 160]) reference.camera.update(false, true, timestamp);
    for (const timestamp of [100, 150, 140, 160]) reordered.camera.update(false, true, timestamp);
    expect(reordered.renderer.cameraX).to.be.closeTo(reference.renderer.cameraX, 1e-10);
    reference.camera.dispose(); reordered.camera.dispose();
  });
  it('discards hidden presentation time, resumes settling on the next delta and saves logical state only', () => {
    const { renderer, camera } = fixture();
    camera.update(false, true, 0); camera.update(false, true, 16); const position = renderer.cameraX;
    camera.resetPresentationClock(); camera.update(false, true, 10000); expect(renderer.cameraX).to.equal(position);
    camera.update(false, true, 10016); expect(renderer.cameraX).to.be.greaterThan(position);
    expect(Object.keys(camera.getState())).to.deep.equal(['cameraX', 'cameraY', 'scale', 'follow']);
    camera.dispose(); expect(() => camera.update(false, true, 10032)).not.to.throw(); expect(camera.pan(10, 10)).to.equal(false);
  });
  it('defers follow targets until the current physical tick is complete', () => {
    const { renderer, camera } = fixture(); renderer.world.tickIndex = 1; camera.update(true, true, 0);
    const completedX = renderer.cameraX;
    renderer.world._stepping = true; renderer.world._musicCompletedTick = 1; renderer.world.tickIndex = 2; renderer.world.actors[0].x = 1600;
    camera.update(true, true, 16); expect(renderer.cameraX).to.equal(completedX);
    renderer.world._musicCompletedTick = 2; camera.update(true, true, 32); expect(renderer.cameraX).to.equal(1480); camera.dispose();
  });
});

// These traces use a fixed physical target schedule; extra paints never step it.
describe('ProcGen camera refresh-cadence qualification', () => {
  const trace = (hz, irregular = false) => {
    const { renderer, camera } = fixture(), output = [], times = new Set([0, 200, 400, 600, 800]);
    if (irregular) { let time = 0, index = 0; const deltas = [7, 23, 11, 41, 19, 37]; while ((time += deltas[index++ % deltas.length]) < 800) times.add(time); }
    else for (let frame = 1; frame / hz * 1000 < 800; frame++) times.add(frame / hz * 1000);
    for (const time of [...times].sort((a, b) => a - b)) {
      // At a target transition first consume the completed interval with the old target.
      camera.update(false, true, time);
      if ([200, 400, 600].includes(time)) { renderer.world.actors[0].x += 120; renderer.world.tickIndex = (renderer.world.tickIndex || 0) + 1; camera.update(false, true, time); }
      if ([200, 400, 600, 800].includes(time)) output.push(renderer.cameraX);
    }
    const physical = JSON.stringify(renderer.world); camera.dispose(); return { output, physical };
  };
  it('matches 30/60/90/144 Hz and irregular updates at shared timestamps within 1e-8 world pixel', () => {
    const reference = trace(60);
    for (const candidate of [trace(30), trace(90), trace(144), trace(60, true)]) {
      candidate.output.forEach((value, index) => expect(value).to.be.closeTo(reference.output[index], 1e-8));
      expect(candidate.physical).to.equal(reference.physical);
    }
  });
  it('caps a one-second stall at one 50ms presentation interval and lets paused follow settle', () => {
    const delayed = fixture(), reference = fixture();
    delayed.camera.update(false, true, 0); delayed.camera.update(false, true, 1000);
    reference.camera.update(false, true, 0); reference.camera.update(false, true, 50);
    expect(delayed.renderer.cameraX).to.equal(reference.renderer.cameraX);
    const physical = JSON.stringify(delayed.renderer.world);
    for (let frame = 1; frame <= 180; frame++) delayed.camera.update(false, true, 1000 + frame * 16);
    expect(delayed.renderer.cameraX).to.equal(480); expect(JSON.stringify(delayed.renderer.world)).to.equal(physical);
    delayed.camera.dispose(); reference.camera.dispose();
  });
  it('does not accrue missing-target time or stale targets across lane changes and transfers', () => {
    const { renderer, camera } = fixture(); renderer.world.laneCount = 2; renderer.world.laneHeight = 96;
    renderer.workstationLayout = { firstLane: 0, count: 1 }; renderer.world.actors[0].y = 64;
    camera.update(true, true, 0); expect(renderer.cameraX).to.equal(480);
    renderer.workstationLayout.firstLane = 1; camera.update(false, true, 1000); expect(renderer.cameraX).to.equal(480);
    renderer.world.actors[0].x = 900; renderer.world.actors[0].y = 160; renderer.world.tickIndex = 1;
    camera.update(false, true, 2000); expect(renderer.cameraX).to.equal(480);
    camera.update(false, true, 2016); expect(renderer.cameraX).to.be.greaterThan(480);
    renderer.followLaneIndex = 0; camera.update(false, true, 2032); const previous = renderer.cameraX;
    renderer.followLaneIndex = 1; camera.update(false, true, 2048); expect(renderer.cameraX).to.equal(previous); camera.dispose();
  });
  it('keeps pan and zoom immediate, handles resized DPR, and snaps reduced-motion Follow without touching physics', () => {
    const { renderer, camera } = fixture(), physical = JSON.stringify(renderer.world);
    camera.pan(30, 0); expect(renderer.cameraX).to.equal(10); expect(renderer.follow).to.equal(false);
    camera.setZoom(4); expect(renderer.scale).to.equal(4);
    const saved = camera.getState(); renderer.window.devicePixelRatio = 2; renderer.canvas.width = 1800; renderer.canvas.height = 1200; camera.applyState(saved);
    expect(camera.getState()).to.deep.equal(saved); renderer.reducedMotion = { matches: true }; camera.followFrontier();
    expect(renderer.cameraX).to.equal(510); expect(JSON.stringify(renderer.world)).to.equal(physical); camera.dispose();
  });
});

it('maps pointer deltas through the actual CSS content scale and preserves pointer ownership', () => {
  const events = new Map(), renderer = { scale: 3, cameraX: 100, cameraY: 0, follow: false,
    canvas: { width: 900, height: 600, clientWidth: 900, clientHeight: 600, getBoundingClientRect: () => ({ left: 10, top: 20, width: 450, height: 300 }),
      addEventListener: (name, handler) => events.set(name, handler), removeEventListener: name => events.delete(name), focus() {}, setPointerCapture() {} },
    world: { height: 1024 * 96, laneCount: 1, actors: [] }, window: { devicePixelRatio: 1 }, render() {} };
  const camera = createProcgenCameraController(renderer);
  events.get('pointerdown')({ pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  events.get('pointermove')({ pointerId: 2, clientX: 50, clientY: 100 }); expect(renderer.cameraX).to.equal(100);
  events.get('pointermove')({ pointerId: 1, clientX: 50, clientY: 100 }); expect(renderer.cameraX).to.be.closeTo(100 + 100 / 3, 1e-10);
  events.get('pointerup')({ pointerId: 2 }); events.get('pointermove')({ pointerId: 1, clientX: 25, clientY: 100 }); expect(renderer.cameraX).to.be.closeTo(150, 1e-10);
  events.get('pointerup')({ pointerId: 1 }); events.get('pointermove')({ pointerId: 1, clientX: 0, clientY: 100 }); expect(renderer.cameraX).to.be.closeTo(150, 1e-10); camera.dispose();
});
