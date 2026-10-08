import { ParticleTable } from '../../render/ParticleTable.js';
import { ProcgenLaneWorld } from './ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from './ProcgenLaneRenderer.js';

// Accumulate real time rather than speed-scaled time: even extreme finite
// multipliers cannot poison the backlog, and slow ticks can span many frames.
const advanceProcgenClock = (elapsed, deltaMs, speed, step, now) => {
  const tickDuration = 60 / speed;
  elapsed = Math.min(Math.max(250, tickDuration), elapsed + Math.min(250, Math.max(0, deltaMs)));
  const started = now();
  while (elapsed >= tickDuration) {
    step(); elapsed -= tickDuration;
    // Bound main-thread occupancy without capping the requested multiplier.
    if (now() - started >= 8) break;
  }
  return elapsed;
};

const createProcgenLaneRuntime = ({ canvas, resources, sprites, masks, assets, laneCount, seed, terrain, previousDistances = [], workerLimits, onMetrics, onActiveCount, speed = 3, windowRef = window }) => {
  const world = new ProcgenLaneWorld({ laneCount, seed, sprites, masks, speed, cohorts: true, spawnSpreadTicks: 12,
    terrain, previousDistances, workerLimits,
    particleTable: new ParticleTable(assets.groundPieces[0].image.palette) });
  const renderer = new ProcgenLaneRenderer({ canvas, world, assets, windowRef });
  let paused = false;
  let running = true, frame = null, lastTime = null, elapsed = 0, previewRouter = null, lastMetrics = null, lastMetricTick = 0;
  let displayedActiveCount = -1;
  const reportActiveCount = () => {
    const count = world.activeCount ?? world.stall.lanes.reduce((sum, lane) => sum + lane.alive, 0);
    if (count !== displayedActiveCount) { displayedActiveCount = count; onActiveCount?.(count); }
  };
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
      elapsed = advanceProcgenClock(elapsed, time - lastTime, world.timer.speedFactor,
        () => world.step(time), () => windowRef.performance?.now?.() ?? Date.now());
    }
    lastTime = time;
    renderer.render(false); reportActiveCount();
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
      renderer.render(); reportActiveCount();
    },
    stop() { running = false; windowRef.document.removeEventListener?.('visibilitychange', visibilityChanged); if (frame != null) windowRef.cancelAnimationFrame(frame); view.setMidiPreviewRouter(null); world.dispose(); renderer.dispose(); },
    resize() { renderer.resize(); } };
};
export { createProcgenLaneRuntime, advanceProcgenClock };
