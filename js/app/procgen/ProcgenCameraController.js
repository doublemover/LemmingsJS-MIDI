const PROCGEN_MIN_SCALE = 1 / 256;
const PROCGEN_MAX_SCALE = 6;

const createProcgenCameraController = renderer => {
  const { canvas, window: windowRef, world } = renderer;
  const listeners = [];
  const listen = (event, handler, options) => { canvas.addEventListener(event, handler, options); listeners.push([event, handler, options]); };
  const viewport = () => {
    const dpr = Math.min(2, windowRef.devicePixelRatio || 1);
    return { width: canvas.width / (renderer.scale * dpr), height: canvas.height / (renderer.scale * dpr) };
  };
  const clamp = () => {
    renderer.cameraX = Math.max(0, renderer.cameraX);
    renderer.cameraY = Math.max(0, Math.min(Math.max(0, world.height - viewport().height), renderer.cameraY));
  };
  const pan = (dx, dy) => {
    renderer.follow = false; renderer.cameraX += dx / renderer.scale; renderer.cameraY += dy / renderer.scale;
    clamp(); renderer.render();
  };
  const setZoom = scale => {
    const previous = viewport(), pinnedX = renderer.cameraX === 0, pinnedY = renderer.cameraY === 0;
    const centerX = renderer.cameraX + previous.width / 2, centerY = renderer.cameraY + previous.height / 2;
    renderer.scale = Math.max(PROCGEN_MIN_SCALE, Math.min(PROCGEN_MAX_SCALE, Number(scale) || 3));
    const next = viewport();
    renderer.cameraX = pinnedX ? 0 : centerX - next.width / 2;
    renderer.cameraY = pinnedY ? 0 : centerY - next.height / 2;
    renderer.follow = false; clamp(); renderer.render();
  };
  const followFrontier = () => { renderer.follow = true; update(true); renderer.render(); };
  const update = (immediate = false) => {
    clamp();
    if (!renderer.follow) return;
    let leader = null;
    for (const actor of world.actors) if (!actor.failureReason && !actor.removed && Number.isFinite(actor.x) && (!leader || actor.x > leader.x)) leader = actor;
    const view = viewport(), targetX = Math.max(0, (leader?.x || 36) - view.width * 0.4);
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
  listen('pointerdown', event => { if (event.button && event.button !== 1) return; drag = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture?.(event.pointerId); });
  listen('pointermove', event => { if (!drag) return; pan(drag.x - event.clientX, drag.y - event.clientY); drag = { x: event.clientX, y: event.clientY }; });
  listen('pointerup', () => { drag = null; }); listen('pointercancel', () => { drag = null; });
  listen('dblclick', followFrontier);
  const getState = () => ({ cameraX: renderer.cameraX, cameraY: renderer.cameraY, scale: renderer.scale, follow: renderer.follow });
  const applyState = state => {
    renderer.scale = Math.max(PROCGEN_MIN_SCALE, Math.min(PROCGEN_MAX_SCALE, Number(state.scale) || renderer.scale));
    renderer.cameraX = Math.max(0, Number(state.cameraX) || 0); renderer.cameraY = Math.max(0, Number(state.cameraY) || 0);
    renderer.follow = state.follow !== false; clamp();
  };
  return { pan, setZoom, followFrontier, update, getState, applyState, viewport,
    dispose() { for (const [event, handler, options] of listeners) canvas.removeEventListener(event, handler, options); } };
};
export { createProcgenCameraController, PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE };
