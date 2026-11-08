import { getPointerGestureArbiter } from '../controls/PointerGestureArbiter.js';
import { readProcgenCanvasRect } from './ProcgenPresentationSnapshot.js';

const PROCGEN_MIN_SCALE = 1 / 256;
const PROCGEN_MAX_SCALE = 6;
const FOLLOW_TAU_MS = 130;
const MAX_FOLLOW_DELTA_MS = 50;

const createProcgenCameraController = (renderer, { deferBinding = false } = {}) => {
  let inputActive = !deferBinding;
  let { canvas, window: windowRef, world } = renderer;
  const listeners = [], pointerArbiter = getPointerGestureArbiter(canvas.ownerDocument || windowRef.document || canvas);
  const listen = (event, handler, options) => { if (inputActive) canvas.addEventListener(event, handler, options); listeners.push([event, handler, options]); };
  const dimensions = () => {
    if (!canvas) return { width: 0, height: 0, fullHeight: 0, bandHeight: 0 };
    const dpr = Math.min(2, windowRef.devicePixelRatio || 1);
    const width = canvas.clientWidth > 0 ? canvas.clientWidth : (renderer.surfaceWidth || canvas.width) / dpr;
    const fullHeight = canvas.clientHeight > 0 ? canvas.clientHeight : (renderer.surfaceHeight || canvas.height) / dpr;
    const bandHeight = Math.max(0, Math.min(fullHeight - 1, renderer.overviewActive ? Number(renderer.overviewBandHeight) || 0 : 0));
    return { width, height: Math.max(1, fullHeight - bandHeight), fullHeight, bandHeight };
  };
  const fitScale = reserved => {
    if (!world) return PROCGEN_MIN_SCALE;
    const size = dimensions();
    return Math.max(PROCGEN_MIN_SCALE, (reserved ? size.height : size.fullHeight) / Math.max(1, world.height));
  };
  const minimumScale = () => renderer.workstationLayout ? 1 : fitScale(true);
  const boundedScale = scale => {
    const minimum = minimumScale();
    return Math.max(minimum, Math.min(Math.max(PROCGEN_MAX_SCALE, minimum), Number(scale) || 3));
  };
  const viewport = () => {
    if (!world) return { width: 0, height: 0, fullHeight: 0, bandHeight: 0 };
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
  const pointerDelta = (dx, dy) => {
    const rect = readProcgenCanvasRect(canvas, windowRef), size = dimensions();
    return rect ? { x: dx * size.width / rect.width, y: dy * size.fullHeight / rect.height } : null;
  };
  const pan = (dx, dy) => {
    if (disposed) return false;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1) return false;
    renderer.inspectionRowAnchor = null; renderer.follow = false; lastFollowMs = null; renderer.cameraX += dx / renderer.scale; renderer.cameraY += dy / renderer.scale;
    clamp(); renderer.render(false); return true;
  };
  const setZoom = scale => {
    if (disposed) return false;
    renderer.inspectionRowAnchor = null;
    const previous = viewport(), pinnedX = renderer.cameraX === 0, pinnedY = renderer.cameraY === 0;
    const centerX = renderer.cameraX + previous.width / 2, centerY = renderer.cameraY + previous.height / 2;
    renderer.overviewActive = Number(scale) <= (renderer.overviewActive ? minimumScale() : fitScale(false)) + 1e-10;
    renderer.scale = boundedScale(scale);
    const next = viewport();
    renderer.cameraX = pinnedX ? 0 : centerX - next.width / 2;
    renderer.cameraY = pinnedY ? 0 : centerY - next.height / 2;
    clamp(); pointerArbiter.revalidate(); renderer.render(false);
  };
  let cachedLeader = null, leaderTick = -1, leaderGeneration = -1, leaderActors = null, leaderCount = -1, leaderWindow = '', lastFollowMs = null, disposed = false;
  const followFrontier = () => { renderer.inspectionRowAnchor = null; renderer.follow = true; update(true); renderer.render(false); };
  const update = (immediate = false, reuseLeader = false, presentationMs = windowRef.performance?.now?.() ?? Date.now()) => {
    if (disposed) return;
    pointerArbiter.revalidate();
    if (world._stepping && world._musicCompletedTick !== world.tickIndex) return;
    clamp();
    if (!renderer.follow || !immediate && renderer.motionPolicy?.automaticCamera === false) { lastFollowMs = null; return; }
    const projection = renderer.workstationLayout, selected = Number.isInteger(renderer.followLaneIndex) ? renderer.followLaneIndex : null;
    const firstLane = projection ? selected ?? projection.firstLane : 0, lastLane = projection ? selected == null ? firstLane + projection.count : selected + 1 : world.laneCount ?? Infinity;
    const visibleLanes = projection?.mapped ? selected == null ? projection.laneIndices : [selected] : null;
    const visibleWindow = visibleLanes ? visibleLanes.join(',') : `${firstLane}:${lastLane}`;
    if (!reuseLeader || cachedLeader?.failureReason || cachedLeader?.removed || leaderTick !== world.tickIndex || leaderGeneration !== world.generation || leaderActors !== world.actors || leaderCount !== world.actors.length || leaderWindow !== visibleWindow) {
      if (renderer.actorVisibility?.physicalLeader) {
        if (!visibleLanes) cachedLeader = renderer.actorVisibility.physicalLeader(firstLane, lastLane, immediate);
        else {
          cachedLeader = null;
          for (const lane of visibleLanes) { const actor = renderer.actorVisibility.physicalLeader(lane, lane + 1, immediate); if (actor && (!cachedLeader || actor.x > cachedLeader.x || actor.x === cachedLeader.x && actor.id < cachedLeader.id)) cachedLeader = actor; }
        }
      }
      else {
        cachedLeader = null;
        for (const actor of world.actors) {
          const lane = Math.floor(actor.y / (renderer.laneHeight || world.laneHeight || 96));
          if (!actor.failureReason && !actor.removed && Number.isFinite(actor.x) && Number.isFinite(actor.y) && (visibleLanes ? visibleLanes.includes(lane) : lane >= firstLane && lane < lastLane) &&
              (!cachedLeader || actor.x > cachedLeader.x || actor.x === cachedLeader.x && actor.id < cachedLeader.id)) cachedLeader = actor;
        }
      }
      leaderTick = world.tickIndex; leaderGeneration = world.generation; leaderActors = world.actors; leaderCount = world.actors.length;
      leaderWindow = visibleWindow;
    }
    const leader = cachedLeader;
    if (!leader) { lastFollowMs = null; return; }
    const view = viewport(), targetX = Math.max(0, leader.x - view.width * 0.4);
    const deltaMs = lastFollowMs == null || !Number.isFinite(presentationMs) ? 0 : Math.max(0, Math.min(MAX_FOLLOW_DELTA_MS, presentationMs - lastFollowMs));
    lastFollowMs = Number.isFinite(presentationMs) ? Math.max(lastFollowMs ?? presentationMs, presentationMs) : null;
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
    if (event.shiftKey || Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0)) { const delta = pointerDelta(event.deltaX || 0, event.deltaY || 0); if (delta) pan(delta.x, delta.y); }
    else if (event.deltaY) setZoom(renderer.scale * (event.deltaY > 0 ? 1 / 1.1 : 1.1));
  }, { passive: false });
  let drag = null;
  listen('pointerdown', event => {
    if (event.button && event.button !== 1) return;
    const generation = world.generation, identity = world, delta = pointerDelta(1, 1), scale = renderer.scale;
    const lease = pointerArbiter.acquire({ pointerId: event.pointerId, targetKey: 'camera-pan', identity, captureTarget: canvas,
      getIdentity: () => !disposed && world === identity && renderer.world === identity && world.generation === generation && renderer.scale === scale ? identity : null, onCancel: () => { drag = null; } });
    if (!lease || !delta) { lease?.cancel('projection-unavailable'); return; }
    canvas.focus?.(); drag = { lease, delta, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    try { canvas.setPointerCapture?.(event.pointerId); } catch { lease.cancel('capture-unavailable'); }
  });
  listen('pointermove', event => {
    if (!drag?.lease.owns(event) || !drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    const delta = { x: (drag.x - event.clientX) * drag.delta.x, y: (drag.y - event.clientY) * drag.delta.y };
    if (delta && pan(delta.x, delta.y)) { drag.x = event.clientX; drag.y = event.clientY; drag.moved = true; }
  });
  const finish = event => { if (drag?.lease.finish(event)) drag = null; };
  listen('pointerup', finish);
  for (const type of ['pointercancel', 'lostpointercapture']) listen(type, event => { if (drag?.lease.owns(event)) drag.lease.cancel(type); });
  listen('blur', () => drag?.lease.cancel('blur'));
  listen('keydown', event => { if (event.key === 'Escape') drag?.lease.cancel('escape'); });
  listen('dblclick', followFrontier);
  const getState = () => ({ cameraX: renderer.cameraX, cameraY: renderer.cameraY, scale: renderer.scale, follow: renderer.follow });
  const applyState = state => {
    if (!state || typeof state !== 'object') return;
    renderer.overviewActive = Number(state.scale) <= fitScale(false) + 1e-10;
    renderer.scale = boundedScale(Number(state.scale) || renderer.scale);
    renderer.cameraX = Math.max(0, Number(state.cameraX) || 0); renderer.cameraY = Math.max(0, Number(state.cameraY) || 0);
    renderer.follow = state.follow !== false; lastFollowMs = null; clamp(); pointerArbiter.revalidate();
  };
  return { pan: (...args) => !disposed && pan(...args), setZoom: (...args) => !disposed && setZoom(...args), followFrontier: () => !disposed && followFrontier(), update, getState, applyState: state => !disposed && applyState(state), viewport, minimumScale,
    activate() { if (disposed || inputActive) return !disposed; for (const [event, handler, options] of listeners) canvas.addEventListener(event, handler, options); inputActive = true; return true; },
    resetPresentationClock() { lastFollowMs = null; },
    dispose() { drag?.lease.cancel('disposed'); for (const [event, handler, options] of listeners) canvas.removeEventListener(event, handler, options);
      listeners.length = 0; disposed = true; drag = null; cachedLeader = null; leaderActors = null; lastFollowMs = null; world = canvas = windowRef = null; } };
};
export { createProcgenCameraController, PROCGEN_MIN_SCALE, PROCGEN_MAX_SCALE };
