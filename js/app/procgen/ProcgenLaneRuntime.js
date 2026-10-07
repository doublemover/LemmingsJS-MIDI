import { ParticleTable } from '../../render/ParticleTable.js';
import { ProcgenLaneWorld } from './ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from './ProcgenLaneRenderer.js';

const createProcgenLaneRuntime = ({ canvas, resources, sprites, masks, assets, laneCount, seed, terrain, previousDistances = [], onMetrics, speed = 3, windowRef = window }) => {
  const world = new ProcgenLaneWorld({ laneCount, seed, sprites, masks, speed, cohorts: true, spawnSpreadTicks: 12,
    terrain, previousDistances,
    particleTable: new ParticleTable(assets.groundPieces[0].image.palette) });
  const renderer = new ProcgenLaneRenderer({ canvas, world, assets, windowRef });
  let paused = false;
  let running = true, frame = null, lastTime = null, elapsed = 0, previewRouter = null, lastMetrics = 0;
  const view = {
    game: world, gameResources: resources, midiEnabled: false, midiAvailable: true,
    midiPreviewRouter: null,
    setMidiPreviewRouter(router) {
      previewRouter?.detach?.(); previewRouter?.scheduler?.allNotesOff?.();
      previewRouter = router; this.midiPreviewRouter = router;
      router?.attach(world.soundEvents, { game: world });
    }
  };
  world.gameResources = resources;
  world.render = () => renderer.render();
  const update = time => {
    if (!running) return;
    if (lastTime != null && !paused && !windowRef.document.hidden) {
      elapsed = Math.min(1920, elapsed + Math.min(250, Math.max(0, time - lastTime)) * world.timer.speedFactor);
      let steps = 0;
      while (elapsed >= 60 && steps < 32) { world.step(); elapsed -= 60; steps++; }
    }
    lastTime = time;
    renderer.render();
    if (time - lastMetrics > 1000) { lastMetrics = time; onMetrics?.(world.getDebugState()); }
    frame = windowRef.requestAnimationFrame(update);
  };
  frame = windowRef.requestAnimationFrame(update);
  const getDebugState = () => ({ ...world.getDebugState(), selectedTheme: terrain?.recipe.family || assets.styleName,
    renderer: { visibleActors: renderer.renderedActors, frameMs: renderer.lastFrameMs, cameraX: renderer.cameraX, cameraY: renderer.cameraY, scale: renderer.scale } });
  return { view, game: world, world, renderer, getDebugState,
    pause() { paused = true; previewRouter?.scheduler?.allNotesOff?.(); },
    resume() { paused = false; lastTime = null; },
    step(count = 1) { for (let i = 0; i < Math.max(1, Math.min(10000, Math.trunc(count))); i++) world.step(); renderer.render(); },
    stop() { running = false; if (frame != null) windowRef.cancelAnimationFrame(frame); view.setMidiPreviewRouter(null); world.dispose(); renderer.dispose(); },
    resize() { renderer.resize(); } };
};
export { createProcgenLaneRuntime };
