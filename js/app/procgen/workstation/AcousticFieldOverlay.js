import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { procgenWorldToScreen } from '../ProcgenPresentationSnapshot.js';

let nextOverlay = 0;
export function createAcousticFieldOverlay({ document, window, stage, actions, getMap, getState, displayScheduler, resourceBudget } = {}) {
  const owner = ++nextOverlay, storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'acoustic-overlay-' + owner, kind: 'bounded-acoustic-world-svg', category: 'graphics', bytes: 4096 }), layer = document.createElement('div'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), controls = document.createElement('span');
  layer.setAttribute('aria-hidden', 'true'); layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:22'; svg.style.cssText = 'width:100%;height:100%;overflow:hidden'; layer.append(svg); stage.append(layer);
  const node = (tag, attributes = {}) => { const value = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, item] of Object.entries(attributes)) value.setAttribute(key, String(item)); return value; };
  const listener = document.createElement('input'); listener.type = 'checkbox'; listener.checked = true; const label = document.createElement('label'); label.append(listener, document.createTextNode(' Listener')); controls.append(label);
  const field = document.createElement('select'); field.setAttribute('aria-label', 'World acoustic field boundary'); controls.append(field); actions.append(controls);
  let renderer = null, stop = null, disposed = false, mapReference = null;
  const draw = () => {
    if (disposed) return; const map = getMap(), projection = renderer?.presentation?.getSnapshot?.();
    if (map !== mapReference) { storage.resize(map ? 262144 : 4096); const selected = field.value; field.replaceChildren(); const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Acoustic boundary: hidden'; field.append(empty); for (const zone of map?.zones || []) { const option = document.createElement('option'); option.value = zone.zoneId; option.textContent = '◌ ' + zone.zoneId; field.append(option); } if (map?.zones.some(zone => zone.zoneId === selected)) field.value = selected; mapReference = map; }
    controls.hidden = !map; layer.hidden = !map || !projection || !renderer.presentation.valid(projection); if (layer.hidden) { svg.replaceChildren(); return; }
    const rect = stage.getBoundingClientRect(); svg.style.clipPath = 'inset(' + Math.max(0, projection.rect.top - rect.top) + 'px ' + Math.max(0, rect.right - projection.rect.left - projection.rect.width) + 'px ' + Math.max(0, rect.bottom - projection.rect.top - projection.rect.height) + 'px ' + Math.max(0, projection.rect.left - rect.left) + 'px)'; svg.setAttribute('viewBox', '0 0 ' + rect.width + ' ' + rect.height); svg.replaceChildren();
    const point = (x, y, lane = null, clip = true) => { const result = procgenWorldToScreen(projection, x, y, lane, { clip }); return result ? { x: result.x - rect.left, y: result.y - rect.top } : null; }, zone = map.zones.find(zone => zone.zoneId === field.value);
    const state = getState(), observed = state?.worldId === projection.worldId && state?.generation === projection.generation && state.committedObservation && state.listenerTick <= projection.physicalTick, pending = !observed || state.mapId !== map.id || state.revision !== map.revision;
    if (zone) {
      const vertices = zone.worldRegion.kind === 'polygon' ? zone.worldRegion.points : [{ x: zone.worldRegion.bounds.x1, y: zone.worldRegion.bounds.y1 }, { x: zone.worldRegion.bounds.x2, y: zone.worldRegion.bounds.y1 }, { x: zone.worldRegion.bounds.x2, y: zone.worldRegion.bounds.y2 }, { x: zone.worldRegion.bounds.x1, y: zone.worldRegion.bounds.y2 }], width = map.controls.borderPixels ?? zone.transitionDistancePixels;
      const definitions = node('defs'); svg.append(definitions);
      for (const row of projection.rows.slice(0, 9)) {
        const top = point(projection.originX, row.sourceY, row.lane, false), bottom = point(projection.originX + projection.viewWidth, row.sourceY + row.sourceHeight, row.lane, false); if (!top || !bottom) continue;
        const clipId = 'acoustic-overlay-' + owner + '-row-' + row.lane, clip = node('clipPath', { id: clipId }); clip.append(node('rect', { x: top.x, y: top.y, width: bottom.x - top.x, height: bottom.y - top.y })); definitions.append(clip);
        const group = node('g', { 'clip-path': 'url(#' + clipId + ')' }), projected = vertices.map(value => point(value.x, value.y, row.lane, false)); svg.append(group);
        const path = projected.map(value => value.x + ',' + value.y).join(' '), highContrast = window.matchMedia?.('(prefers-contrast: more)').matches;
        if (!highContrast) group.append(node('polygon', { points: path, fill: '#68d6e6', opacity: 0.06 }));
        group.append(node('polygon', { points: path, fill: 'none', stroke: '#d7fcff', 'stroke-width': 2.5, 'stroke-dasharray': pending || !zone.enabled ? '8 5' : 'none' }));
        const center = { x: vertices.reduce((sum, point) => sum + point.x, 0) / vertices.length, y: vertices.reduce((sum, point) => sum + point.y, 0) / vertices.length }, caption = point(center.x, center.y, row.lane, false), text = node('text', { x: caption.x, y: caption.y, fill: '#fff', stroke: '#172331', 'stroke-width': 3, 'paint-order': 'stroke', 'text-anchor': 'middle', 'font-size': 13 }); text.textContent = '◌ ' + zone.zoneId + ' · ' + width + 'px edge' + (pending ? ' · requested' : '') + (zone.enabled ? '' : ' · disabled'); group.append(text);
      }
    }
    if (listener.checked && observed && state.listener) {
      const mark = point(state.listener.x, state.listener.y); if (mark) {
        const group = node('g', { fill: 'none', stroke: '#fff', 'stroke-width': 2 }); group.append(node('circle', { cx: mark.x, cy: mark.y, r: 7 }), node('path', { d: 'M' + (mark.x - 12) + ',' + mark.y + 'h24M' + mark.x + ',' + (mark.y - 12) + 'v24' })); svg.append(group);
        const text = node('text', { x: mark.x + 14, y: mark.y - 10, fill: '#fff', stroke: '#172331', 'stroke-width': 3, 'paint-order': 'stroke', 'font-size': 12 }); text.textContent = 'Listener · ' + state.listenerMode; svg.append(text);
        const lane = Math.floor(state.listener.y / projection.laneHeight), left = point(state.listener.x - (state.panWidthPixels ?? map.listener.panWidthPixels), state.listener.y, lane, false), right = point(state.listener.x + map.listener.panWidthPixels, state.listener.y, lane, false);
        if (left && right) svg.append(node('line', { x1: left.x, y1: mark.y + 14, x2: right.x, y2: mark.y + 14, stroke: '#fff', 'stroke-width': 1, 'stroke-dasharray': '5 5' }));
      }
    }
  };
  const surface = displayScheduler.register({ id: 'world-acoustic-overlay-' + owner, element: stage, intervalMs: 250, read: () => ({ projection: renderer?.presentation?.getSnapshot?.()?.revision, map: getMap(), listener: listener.checked, field: field.value, state: getState() }), write: draw });
  const change = () => surface.invalidate(); listener.addEventListener('change', change); field.addEventListener('change', change);
  return Object.freeze({ bind(value) { if (disposed || renderer === value) return; stop?.(); stop = null; renderer = value; if (renderer?.presentation) stop = renderer.presentation.subscribe(change, { entities: false }); surface.invalidate(); },
    refresh: change, dispose() { if (disposed) return; disposed = true; stop?.(); stop = null; surface.dispose(); listener.removeEventListener('change', change); field.removeEventListener('change', change); svg.replaceChildren(); layer.remove(); controls.remove(); storage.release(); } });
}
