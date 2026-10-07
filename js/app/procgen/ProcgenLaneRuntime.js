import { ParticleTable } from '../../render/ParticleTable.js';
import { ProcgenLaneWorld } from './ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from './ProcgenLaneRenderer.js';

const createProcgenLaneRuntime = ({ canvas, resources, sprites, masks, assets, laneCount, seed, terrain, previousDistances = [], onMetrics, speed = 3, windowRef = window }) => {
  const world = new ProcgenLaneWorld({ laneCount, seed, sprites, masks, speed, cohorts: true, spawnSpreadTicks: 12,
    terrain, previousDistances,
    particleTable: new ParticleTable(assets.groundPieces[0].image.palette) });
  const renderer = new ProcgenLaneRenderer({ canvas, world, assets, windowRef });
  let paused = false;
  let running = true, frame = null, lastTime = null, elapsed = 0, previewRouter = null, lastMetrics = null, lastMetricTick = 0, previousSpeed = speed;
  world.onRestart = () => previewRouter?.resetClock?.();
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
      const speedFactor = world.timer.speedFactor;
      if (speedFactor !== previousSpeed) {
        elapsed = Math.min(250, elapsed / Math.max(0.001, previousSpeed)) * speedFactor;
        previousSpeed = speedFactor;
      }
      elapsed = Math.min(250 * speedFactor, elapsed + Math.min(250, Math.max(0, time - lastTime)) * speedFactor);
      const now = () => windowRef.performance?.now?.() ?? Date.now(), started = now();
      while (elapsed >= 60) {
        world.step(time); elapsed -= 60;
        // Bound main-thread occupancy, not the user's speed multiplier or a
        // fixed tick count. A costly tick is never partially simulated.
        if (now() - started >= 8) break;
      }
    }
    lastTime = time;
    renderer.render(false);
    if (lastMetrics == null) { lastMetrics = time; lastMetricTick = world.tickIndex; }
    if (time - lastMetrics >= 1000) {
      world.timer.achievedTicksPerSecond = (world.tickIndex - lastMetricTick) * 1000 / (time - lastMetrics);
      lastMetrics = time; lastMetricTick = world.tickIndex; onMetrics?.(world.getDebugState());
    }
    frame = windowRef.requestAnimationFrame(update);
  };
  const visibilityChanged = () => {
    lastTime = null;
    if (windowRef.document.hidden) previewRouter?.resetClock?.({ preserveGamePhrases: true });
  };
  windowRef.document.addEventListener?.('visibilitychange', visibilityChanged);
  frame = windowRef.requestAnimationFrame(update);
  const getDebugState = () => ({ ...world.getDebugState(), selectedTheme: terrain?.recipe.family || assets.styleName,
    renderer: { visibleActors: renderer.renderedActors, frameMs: renderer.lastFrameMs, cameraX: renderer.cameraX, cameraY: renderer.cameraY, scale: renderer.scale, rasterWidth: renderer.buffer.width, rasterHeight: renderer.buffer.height, terrainRebuilds: renderer.terrainRebuilds, terrainCacheHits: renderer.terrainCacheHits, frameCacheHits: renderer.frameCacheHits } });
  return { view, game: world, world, renderer, getDebugState,
    pause() { paused = true; previewRouter?.resetClock?.({ preserveGamePhrases: true }); },
    resume() { paused = false; lastTime = null; },
    step(count = 1) {
      const now = windowRef.performance?.now?.() ?? world.eventTimeMs;
      for (let i = 0; i < Math.max(1, Math.min(10000, Math.trunc(count))); i++) world.step(now);
      renderer.render();
    },
    stop() { running = false; windowRef.document.removeEventListener?.('visibilitychange', visibilityChanged); if (frame != null) windowRef.cancelAnimationFrame(frame); view.setMidiPreviewRouter(null); world.dispose(); renderer.dispose(); },
    resize() { renderer.resize(); } };
};
export { createProcgenLaneRuntime };
