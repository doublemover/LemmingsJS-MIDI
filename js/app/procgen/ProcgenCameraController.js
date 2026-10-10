const PROCGEN_MIN_SCALE = 1 / 256;
const PROCGEN_MAX_SCALE = 6;

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
  const minimumScale = () => fitScale(true);
  const boundedScale = scale => {
    const minimum = minimumScale();
    return Math.max(minimum, Math.min(Math.max(PROCGEN_MAX_SCALE, minimum), Number(scale) || 3));
  };
  const viewport = () => {
    const size = dimensions();
    return { width: size.width / renderer.scale, height: size.height / renderer.scale,
      fullHeight: size.fullHeight / renderer.scale, bandHeight: size.bandHeight / renderer.scale };
  };
  const clamp = () => {
    renderer.scale = renderer.overviewActive ? minimumScale() : boundedScale(renderer.scale);
    renderer.cameraX = Math.max(0, renderer.cameraX);
    renderer.cameraY = Math.max(0, Math.min(Math.max(0, world.height - viewport().height), renderer.cameraY));
  };
  const pan = (dx, dy) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1) return false;
    renderer.follow = false; renderer.cameraX += dx / renderer.scale; renderer.cameraY += dy / renderer.scale;
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
  let cachedLeader = null, leaderTick = -1, leaderGeneration = -1, leaderActors = null, leaderCount = -1;
  const followFrontier = () => { renderer.follow = true; update(true); renderer.render(false); };
  const update = (immediate = false, reuseLeader = false) => {
    clamp();
    if (!renderer.follow) return;
    if (!reuseLeader || cachedLeader?.failureReason || cachedLeader?.removed || leaderTick !== world.tickIndex || leaderGeneration !== world.generation || leaderActors !== world.actors || leaderCount !== world.actors.length) {
      cachedLeader = null;
      for (const actor of world.actors) if (!actor.failureReason && !actor.removed && Number.isFinite(actor.x) && Number.isFinite(actor.y) && (!cachedLeader || actor.x > cachedLeader.x)) cachedLeader = actor;
      leaderTick = world.tickIndex; leaderGeneration = world.generation; leaderActors = world.actors; leaderCount = world.actors.length;
    }
    const leader = cachedLeader;
    if (!leader) return;
    const view = viewport(), targetX = Math.max(0, leader.x - view.width * 0.4);
    renderer.cameraX += (targetX - renderer.cameraX) * (immediate ? 1 : 0.12);
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
    renderer.overviewActive = Number(state.scale) <= fitScale(false) + 1e-10;
    renderer.scale = boundedScale(Number(state.scale) || renderer.scale);
    renderer.cameraX = Math.max(0, Number(state.cameraX) || 0); renderer.cameraY = Math.max(0, Number(state.cameraY) || 0);
    renderer.follow = state.follow !== false; clamp();
  };
  return { pan, setZoom, followFrontier, update, getState, applyState, viewport, minimumScale,
    dispose() { for (const [event, handler, options] of listeners) canvas.removeEventListener(event, handler, options);
      listeners.length = 0; cachedLeader = null; leaderActors = null; } };
};
export { createProcgenCameraController, PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE };
