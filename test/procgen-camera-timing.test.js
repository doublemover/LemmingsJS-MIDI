import { expect } from 'chai';
import { createProcgenCameraController } from '../js/app/procgen/ProcgenCameraController.js';

const fixture = () => {
  const renderer = { scale: 3, cameraX: 0, cameraY: 0, follow: true,
    canvas: { width: 900, height: 600, addEventListener() {}, removeEventListener() {} },
    world: { height: 1024 * 96, actors: [{ id: 1, x: 600, y: 64 }] }, window: { devicePixelRatio: 1 }, render() {} };
  return { renderer, camera: createProcgenCameraController(renderer) };
};

describe('monotonic ProcGen camera presentation time', () => {
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
