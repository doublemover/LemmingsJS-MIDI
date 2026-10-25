import { ParticleTable } from '../../render/ParticleTable.js';
import { ProcgenLaneWorld, DEFAULT_LANE_HEIGHT } from './ProcgenLaneWorld.js';
import { ProcgenLaneRenderer } from './ProcgenLaneRenderer.js';
import { createProcgenRetirementScope } from './ProcgenRetirement.js';

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

const createProcgenLaneRuntime = ({ canvas, resources, resourceLease = null, renderBudget, sprites, masks, assets, laneCount, seed, terrain, laneHeight = DEFAULT_LANE_HEIGHT, previousDistances = [], workerLimits, populationPolicy, onMetrics, onActiveCount, speed = 3, workstation = false, hazardSpacing = 160, initialWorld = null, windowRef = window }) => {
  const retirement = createProcgenRetirementScope();
  let world = null, renderer = null, constructionFrame = null, constructionVisibility = null;
  try {
    world = initialWorld || new ProcgenLaneWorld({ laneCount, laneHeight, seed, sprites, masks, speed, cohorts: true, populationPolicy,
      terrain, previousDistances, workerLimits, workstation, hazardSpacing,
      particleTable: new ParticleTable(assets.groundPieces[0].image.palette) });
    renderer = new ProcgenLaneRenderer({ canvas, world, assets, windowRef, renderBudget });
    let paused = false;
    let clockDriven = false, clockTime = null;
    let running = true, frame = null, lastTime = null, elapsed = 0, previewRouter = null, lastMetrics = null, lastMetricTick = 0;
    let displayedActiveCount = -1;
    const reportActiveCount = () => {
      const count = world.activeCount ?? world.stall.lanes.reduce((sum, lane) => sum + lane.alive, 0);
      if (count !== displayedActiveCount) { displayedActiveCount = count; onActiveCount?.(count); }
    };
    world.onRestart = () => previewRouter?.resetClock?.();
    world.onLaneTransfer = (id, from, to, count) => previewRouter?.transferActorLane?.(id, from, to, count);
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
      if (!clockDriven && lastTime != null && !paused && !windowRef.document.hidden) {
        elapsed = advanceProcgenClock(elapsed, time - lastTime, world.timer.speedFactor,
          () => world.step(time), () => windowRef.performance?.now?.() ?? Date.now());
      }
      lastTime = time;
      if (!windowRef.document.hidden) {
        try { renderer.render(false); } catch (error) { renderer._failDisplay(error); }
      }
      reportActiveCount();
      if (lastMetrics == null) { lastMetrics = time; lastMetricTick = world.tickIndex; }
      if (time - lastMetrics >= 1000) {
        world.timer.achievedTicksPerSecond = (world.tickIndex - lastMetricTick) * 1000 / (time - lastMetrics);
        lastMetrics = time; lastMetricTick = world.tickIndex; onMetrics?.(world.getDebugState());
      }
      frame = windowRef.requestAnimationFrame(update);
    };
    const visibilityChanged = () => {
      lastTime = null; clockTime = null; elapsed = 0; renderer.camera.resetPresentationClock(); renderer.actorEffects?.setVisible(!windowRef.document.hidden);
      if (windowRef.document.hidden) { paused = true; previewRouter?.resetClock?.({ preserveGamePhrases: true }); }
    };
    constructionVisibility = visibilityChanged;
    windowRef.document.addEventListener?.('visibilitychange', visibilityChanged);
    frame = windowRef.requestAnimationFrame(update); constructionFrame = frame;
    const getDebugState = () => ({ ...world.getDebugState(), selectedTheme: terrain?.recipe.family || assets.styleName,
      renderer: { visibleActors: renderer.renderedActors, frameMs: renderer.lastFrameMs, cameraX: renderer.cameraX, cameraY: renderer.cameraY, scale: renderer.scale, rasterWidth: renderer.buffer.width, rasterHeight: renderer.buffer.height, terrainRebuilds: renderer.terrainRebuilds, terrainCacheHits: renderer.terrainCacheHits, frameCacheHits: renderer.frameCacheHits, actorCandidates: renderer.actorVisibility.candidates.length, actorIndexRebuilds: renderer.actorVisibility.rebuilds || 0, display: renderer.getDisplayState() } });
    return { view, game: world, world, renderer, getDebugState,
      setClockDriven(value) { clockDriven = !!value; clockTime = null; elapsed = 0; },
      pump(time) {
        if (!clockDriven || !running) return;
        if (windowRef.document.hidden) { clockTime = null; elapsed = 0; return; }
        if (!paused && clockTime != null) elapsed = advanceProcgenClock(elapsed, Math.max(0, time - clockTime), world.timer.speedFactor,
          () => world.step(time), () => windowRef.performance?.now?.() ?? Date.now());
        clockTime = time; reportActiveCount();
      },
      pause() { paused = true; previewRouter?.resetClock?.({ preserveGamePhrases: true }); },
      resume() { paused = false; lastTime = null; clockTime = null; },
      step(count = 1) {
        const now = windowRef.performance?.now?.() ?? world.eventTimeMs;
        for (let i = 0; i < Math.max(1, Math.min(10000, Math.trunc(count))); i++) world.step(now);
        renderer.render(); reportActiveCount(); onMetrics?.(world.getDebugState());
        lastMetrics = null;
      },
      stop() {
        if (!running) return retirement.retire();
        running = false;
        const pendingFrame = frame; frame = null;
        return retirement.retire([
          { name: 'visibility-listener', run: () => windowRef.document.removeEventListener?.('visibilitychange', visibilityChanged) },
          { name: 'animation-frame', run: () => { if (pendingFrame != null) windowRef.cancelAnimationFrame(pendingFrame); } },
          { name: 'preview-router', run: () => view.setMidiPreviewRouter(null) },
          { name: 'preview-reference', run: () => { previewRouter = null; view.midiPreviewRouter = null; } },
          { name: 'world', run: () => world.dispose() },
          { name: 'renderer', run: () => renderer.dispose() },
          { name: 'terrain-assets', run: () => terrain?.dispose?.() },
          { name: 'display-assets', run: () => assets?.dispose?.() },
          { name: 'asset-provider-lease', run: () => resourceLease?.release() }
        ]);
      },
      resize() { renderer.resize(); } };
  } catch (error) {
    retirement.retire([
      { name: 'visibility-listener', run: () => { if (constructionVisibility) windowRef.document.removeEventListener?.('visibilitychange', constructionVisibility); } },
      { name: 'animation-frame', run: () => { if (constructionFrame != null) windowRef.cancelAnimationFrame(constructionFrame); } },
      { name: 'renderer', run: () => renderer?.dispose() },
      { name: 'world', run: () => world?.dispose() },
      { name: 'terrain-assets', run: () => terrain?.dispose?.() },
      { name: 'display-assets', run: () => assets?.dispose?.() },
      { name: 'asset-provider-lease', run: () => resourceLease?.release() }
    ]);
    throw error;
  }
};
export { createProcgenLaneRuntime, advanceProcgenClock };
