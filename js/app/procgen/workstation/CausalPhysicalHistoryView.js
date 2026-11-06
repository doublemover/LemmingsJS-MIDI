import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
let serial = 0;
export function createCausalPhysicalHistoryView({ document, resourceBudget = null, label = 'Paused historical collision overview' } = {}) {
  const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-history-view:' + (++serial), kind: 'paused-history-canvas-and-accessible-summary', category: 'checkpoint', bytes: 8 * 1048576 });
  const element = document.createElement('figure'), canvas = document.createElement('canvas'), caption = document.createElement('figcaption'), actors = document.createElement('ol');
  element.className = 'studio-physical-history-preview'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', label + ' with terrain and actor positions'); canvas.style.width = '100%'; canvas.style.height = 'auto'; canvas.style.imageRendering = 'pixelated';
  actors.setAttribute('aria-label', 'Historical actors in this viewport'); element.append(canvas, caption, actors);
  let context = null, image = null, key = null, disposed = false;
  try { context = canvas.getContext('2d'); if (!context) throw new Error('Physical history canvas is unavailable.'); }
  catch (error) { reservation.release(); throw error; }
  const render = projection => {
    if (disposed) throw new Error('The physical history view retired.');
    if (!projection) { element.hidden = true; key = null; actors.replaceChildren(); return; }
    const view = projection.viewport, nextKey = [projection.worldId, projection.generation, projection.tick, projection.terrainRevision, view.x, view.y, view.width, view.height, view.pixelWidth, view.pixelHeight].join(':');
    element.hidden = false; if (nextKey === key) return;
    if (!image || image.width !== view.pixelWidth || image.height !== view.pixelHeight) { canvas.width = view.pixelWidth; canvas.height = view.pixelHeight; image = context.createImageData(canvas.width, canvas.height); }
    const data = image.data;
    for (let index = 0; index < projection.cells.length; index++) { const cell = projection.cells[index], offset = index * 4, unknown = cell === 3 && ((index % view.pixelWidth + Math.floor(index / view.pixelWidth)) & 4);
      data[offset] = cell === 2 ? 234 : cell === 1 ? 93 : unknown ? 86 : 14; data[offset + 1] = cell === 2 ? 203 : cell === 1 ? 129 : unknown ? 70 : 17; data[offset + 2] = cell === 2 ? 134 : cell === 1 ? 145 : unknown ? 92 : 25; data[offset + 3] = 255; }
    context.putImageData(image, 0, 0); context.strokeStyle = '#566679'; context.lineWidth = 1;
    for (let lane = 1; lane < view.laneCount; lane++) { const y = lane * view.laneHeight / view.height * canvas.height; context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke(); }
    context.fillStyle = '#a8ecae';
    for (const actor of projection.actors) { const x = (actor.x - view.x) / view.width * canvas.width, y = (actor.y - view.y) / view.height * canvas.height, direction = actor.direction === 'right' ? 1 : -1;
      context.fillRect(x - 1, y - 4, 3, 5); context.beginPath(); context.moveTo(x, y - 5); context.lineTo(x + direction * 5, y - 3); context.lineTo(x, y - 1); context.fill(); }
    caption.textContent = label + ' · tick ' + projection.tick + ' · generation ' + projection.generation + ' · lanes ' + (view.firstLane + 1) + '–' + (view.firstLane + view.laneCount) + ' · x ' + view.x + '–' + (view.x + view.width) + ' · ' + projection.visibleActors + ' visible actors · ' + projection.unknownCells + ' unknown terrain samples' + (projection.omittedActors ? ' · ' + projection.omittedActors + ' actor marks omitted' : '') + '. Amber: steel. Hatched: unmaterialized/unknown. Output off.';
    canvas.setAttribute('aria-description', caption.textContent);
    actors.replaceChildren(...projection.actors.slice(0, 32).map(actor => { const item = document.createElement('li'); item.textContent = '#' + actor.actorId + ' · lane ' + (actor.laneId + 1) + ' · ' + (actor.action || 'unknown action') + ' · (' + actor.x + ', ' + actor.y + ') · ' + actor.direction; return item; }));
    if (projection.visibleActors > 32) { const item = document.createElement('li'); item.textContent = (projection.visibleActors - 32) + ' more actors in the viewport.'; actors.append(item); }
    key = nextKey;
  };
  return Object.freeze({ element, render, dispose() { if (disposed) return false; disposed = true; image = null; key = null; actors.replaceChildren(); canvas.width = 0; canvas.height = 0; element.remove(); return reservation.release(); } });
}
