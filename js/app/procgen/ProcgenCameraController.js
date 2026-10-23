const PROCGEN_MIN_SCALE = 1 / 256;
const PROCGEN_MAX_SCALE = 6;
const FOLLOW_TAU_MS = 130;
const MAX_FOLLOW_DELTA_MS = 50;

const createProcgenCameraController = renderer => {
  const { canvas, window: windowRef, world } = renderer;
  const listeners = [];
  const listen = (event, handler, options) => { canvas.addEventListener(event, handler, options); listeners.push([event, handler, options]); };
  const dimensions = () => {
    const dpr = Math.min(2, windowRef.devicePixelRatio || 1);
    const width = canvas.clientWidth > 0 ? canvas.clientWidth : canvas.width / dpr;
    const fullHeight = canvas.clientHeight > 0 ? canvas.clientHeight : canvas.height / dpr;
    const bandHeight = Math.max(0, Math.min(fullHeight - 1, renderer.overviewActive ? Number(renderer.overviewBandHeight) || 0 : 0));
    return { width, height: Math.max(1, fullHeight - bandHeight), fullHeight, bandHeight };
  };
  const fitScale = reserved => {
    const size = dimensions();
    return Math.max(PROCGEN_MIN_SCALE, (reserved ? size.height : size.fullHeight) / Math.max(1, world.height));
  };
  const minimumScale = () => renderer.workstationLayout ? 1 : fitScale(true);
  const boundedScale = scale => {
    const minimum = minimumScale();
    return Math.max(minimum, Math.min(Math.max(PROCGEN_MAX_SCALE, minimum), Number(scale) || 3));
  };
  const viewport = () => {
    const size = dimensions();
    if (renderer.workstationLayout) return { width: size.width / renderer.scale, height: renderer.workstationLayout.count * renderer.laneHeight,
      fullHeight: renderer.workstationLayout.count * renderer.laneHeight, bandHeight: 0 };
    return { width: size.width / renderer.scale, height: size.height / renderer.scale,
      fullHeight: size.fullHeight / renderer.scale, bandHeight: size.bandHeight / renderer.scale };
  };
  const clamp = () => {
    renderer.scale = renderer.overviewActive && !renderer.workstationLayout ? minimumScale() : boundedScale(renderer.scale);
    renderer.cameraX = Math.max(0, renderer.cameraX);
    renderer.cameraY = Math.max(0, Math.min(Math.max(0, world.height - viewport().height), renderer.cameraY));
  };
  const pan = (dx, dy) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1) return false;
    renderer.follow = false; lastFollowMs = null; renderer.cameraX += dx / renderer.scale; renderer.cameraY += dy / renderer.scale;
    clamp(); renderer.render(false); return true;
  };
  const setZoom = scale => {
    const previous = viewport(), pinnedX = renderer.cameraX === 0, pinnedY = renderer.cameraY === 0;
    const centerX = renderer.cameraX + previous.width / 2, centerY = renderer.cameraY + previous.height / 2;
    renderer.overviewActive = Number(scale) <= (renderer.overviewActive ? minimumScale() : fitScale(false)) + 1e-10;
    renderer.scale = boundedScale(scale);
    const next = viewport();
    renderer.cameraX = pinnedX ? 0 : centerX - next.width / 2;
    renderer.cameraY = pinnedY ? 0 : centerY - next.height / 2;
    clamp(); renderer.render(false);
  };
  let cachedLeader = null, leaderTick = -1, leaderGeneration = -1, leaderActors = null, leaderCount = -1, leaderWindow = '', lastFollowMs = null;
  const followFrontier = () => { renderer.follow = true; update(true); renderer.render(false); };
  const update = (immediate = false, reuseLeader = false, presentationMs = windowRef.performance?.now?.() ?? Date.now()) => {
    clamp();
    if (!renderer.follow) { lastFollowMs = null; return; }
    const projection = renderer.workstationLayout, selected = Number.isInteger(renderer.followLaneIndex) ? renderer.followLaneIndex : null;
    const firstLane = projection ? selected ?? projection.firstLane : 0, lastLane = projection ? selected == null ? firstLane + projection.count : selected + 1 : world.laneCount ?? Infinity;
    const visibleWindow = `${firstLane}:${lastLane}`;
    if (!reuseLeader || cachedLeader?.failureReason || cachedLeader?.removed || leaderTick !== world.tickIndex || leaderGeneration !== world.generation || leaderActors !== world.actors || leaderCount !== world.actors.length || leaderWindow !== visibleWindow) {
      cachedLeader = null;
      for (const actor of world.actors) {
        const lane = Math.floor(actor.y / (renderer.laneHeight || world.laneHeight || 96));
        if (!actor.failureReason && !actor.removed && Number.isFinite(actor.x) && Number.isFinite(actor.y) && lane >= firstLane && lane < lastLane && (!cachedLeader || actor.x > cachedLeader.x)) cachedLeader = actor;
      }
      leaderTick = world.tickIndex; leaderGeneration = world.generation; leaderActors = world.actors; leaderCount = world.actors.length;
      leaderWindow = visibleWindow;
    }
    const leader = cachedLeader;
    if (!leader) { lastFollowMs = null; return; }
    const view = viewport(), targetX = Math.max(0, leader.x - view.width * 0.4);
    const deltaMs = lastFollowMs == null || !Number.isFinite(presentationMs) ? 0 : Math.max(0, Math.min(MAX_FOLLOW_DELTA_MS, presentationMs - lastFollowMs));
    lastFollowMs = Number.isFinite(presentationMs) ? presentationMs : null;
    const alpha = immediate || renderer.reducedMotion?.matches ? 1 : 1 - Math.exp(-deltaMs / FOLLOW_TAU_MS);
    const distance = targetX - renderer.cameraX;
    renderer.cameraX = Math.abs(distance) < Math.max(0.01, (renderer.rasterStep || 1) / 4) ? targetX : renderer.cameraX + distance * alpha;
    if (leader && (leader.y < renderer.cameraY + 16 || leader.y > renderer.cameraY + view.height - 16)) {
      renderer.cameraY = Math.max(0, leader.y - view.height * 0.4);
    }
    clamp();
  };
  listen('wheel', event => {
    event.preventDefault();
    if (event.shiftKey || Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0)) pan(event.deltaX || 0, event.deltaY || 0);
    else if (event.deltaY) setZoom(renderer.scale * (event.deltaY > 0 ? 1 / 1.1 : 1.1));
  }, { passive: false });
  let drag = null;
  listen('pointerdown', event => { if (event.button && event.button !== 1) return; canvas.focus?.(); drag = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }; canvas.setPointerCapture?.(event.pointerId); });
  listen('pointermove', event => {
    if (!drag || !drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    if (pan(drag.x - event.clientX, drag.y - event.clientY)) { drag.x = event.clientX; drag.y = event.clientY; drag.moved = true; }
  });
  listen('pointerup', () => { drag = null; }); listen('pointercancel', () => { drag = null; });
  listen('dblclick', followFrontier);
  const getState = () => ({ cameraX: renderer.cameraX, cameraY: renderer.cameraY, scale: renderer.scale, follow: renderer.follow });
  const applyState = state => {
    if (!state || typeof state !== 'object') return;
    renderer.overviewActive = Number(state.scale) <= fitScale(false) + 1e-10;
    renderer.scale = boundedScale(Number(state.scale) || renderer.scale);
    renderer.cameraX = Math.max(0, Number(state.cameraX) || 0); renderer.cameraY = Math.max(0, Number(state.cameraY) || 0);
    renderer.follow = state.follow !== false; lastFollowMs = null; clamp();
  };
  return { pan, setZoom, followFrontier, update, getState, applyState, viewport, minimumScale,
    dispose() { for (const [event, handler, options] of listeners) canvas.removeEventListener(event, handler, options);
      listeners.length = 0; cachedLeader = null; leaderActors = null; lastFollowMs = null; } };
};
export { createProcgenCameraController, PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE };
