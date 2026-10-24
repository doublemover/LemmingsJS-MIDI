import { createProcgenActorEffectInspector } from './ProcgenActorEffectInspector.js';
import { getProcgenPresentationEntity } from '../ProcgenPresentationSnapshot.js';

const PAGE_SIZE = 32;
const actionName = actor => actor?.actionName || actor?.action?.actionName || actor?.action?.getActionName?.() || 'Moving';

// Owns presentation selection only. Musical and terrain edits remain engine commands.
export function createProcgenWorldInspector({ renderer, document, window, parent, getLaneInfo = () => null, onRevealLane = () => {} }) {
  const host = renderer?.presentation, canvas = renderer?.canvas;
  if (!host || !parent || !document?.createElement || !canvas?.addEventListener) return null;
  const listeners = [], node = (tag, text, className) => {
    const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element;
  };
  const on = (element, type, handler, options) => { element.addEventListener(type, handler, options); listeners.push(() => element.removeEventListener?.(type, handler, options)); };
  const button = (text, action) => { const element = node('button', text); element.type = 'button'; on(element, 'click', action); return element; };
  const section = node('section', null, 'studio-world-inspector'), title = node('h2', 'World inspection');
  section.setAttribute('aria-label', 'World inspection');
  const summary = node('p', 'Select a visible actor or support contact.', 'studio-world-selection'); summary.setAttribute('aria-live', 'polite');
  const role = node('p', '', 'studio-world-role'), capability = node('p', 'Inspection only. Terrain, field and gate editing is unavailable here.', 'studio-world-capability');
  const actions = node('div', null, 'studio-world-actions'), revealButton = button('Reveal selected', () => reveal()), clearButton = button('Clear selection', () => clear()), nearestButton = button('Select nearest survivor', () => select(nearestId));
  actions.append(revealButton, clearButton, nearestButton);
  const listTitle = node('h3', 'Visible entities'), list = node('div', null, 'studio-world-entities'); list.setAttribute('aria-label', 'Visible world entities');
  const paging = node('div', null, 'studio-world-paging'), previous = button('Previous entities', () => changePage(-1)), next = button('Next entities', () => changePage(1)), count = node('span', '');
  paging.append(previous, count, next); section.append(title, summary, role, capability, actions, listTitle, list, paging); parent.append(section);
  let disposed = false, selection = null, snapshot = null, draft = null, page = 0, listKey = '', nearestId = null, cycleState = null;
  const buttons = new Map();
  const effectInspector = createProcgenActorEffectInspector({ renderer, document, parent: section });
  const cancel = () => { draft?.lease.release(); draft = null; };
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const activeActor = () => selection?.actorId == null || !renderer.actorVisibility?.world ? null : renderer.actorVisibility?.actorById(selection.actorId);
  const select = id => {
    if (disposed) return false;
    const current = host.getSnapshot(), entity = current && getProcgenPresentationEntity(current, id);
    if (!entity) return false;
    selection = Object.freeze({ generation: current.generation, worldId: current.worldId, entityId: entity.id, actorId: entity.actorId, kind: entity.kind,
      lane: entity.lane, label: entity.label, action: entity.action, cause: entity.cause, x: entity.bounds.x + entity.bounds.width / 2, y: entity.bounds.y + entity.bounds.height / 2, finalReason: null });
    renderer.setWorldSelection(entity.id); refresh(host.getSnapshot()); return true;
  };
  const clear = () => { cancel(); selection = null; cycleState = null; renderer.setWorldSelection(null); refresh(host.getSnapshot()); return true; };
  const reveal = () => {
    if (disposed || !selection || !renderer.world || selection.generation !== renderer.world.generation) return false;
    const actor = activeActor();
    if (selection.actorId != null && !actor) return false;
    const x = actor?.x ?? selection.x, y = actor?.y ?? selection.y, lane = Math.max(0, Math.floor(y / renderer.laneHeight));
    renderer.camera.applyState({ ...renderer.camera.getState(), follow: false, cameraX: Math.max(0, x - renderer.camera.viewport().width * 0.4), cameraY: Math.max(0, y - renderer.camera.viewport().height * 0.4) });
    renderer.inspectionRowAnchor = { lane, worldY: y }; onRevealLane(lane); renderer.lastFrameKey = null; renderer.render(false); return true;
  };
  const changePage = delta => { page = Math.max(0, Math.min(Math.max(0, Math.ceil((snapshot?.entities.length || 0) / PAGE_SIZE) - 1), page + delta)); listKey = ''; renderList(); };
  const renderList = () => {
    const entities = snapshot?.entities || [], pages = Math.max(1, Math.ceil(entities.length / PAGE_SIZE)); page = Math.min(page, pages - 1);
    const visible = entities.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), key = `${page}:${visible.map(entity => `${entity.id}:${entity.label}`).join('|')}`;
    if (key !== listKey) {
      listKey = key; for (const element of buttons.values()) { for (const release of element.inspectorListeners || []) release(); }
      buttons.clear(); while (list.firstChild) list.removeChild(list.firstChild);
      for (const entity of visible) {
        const element = node('button', entity.label); element.type = 'button'; element.dataset.entityId = entity.id;
        const pick = () => select(entity.id); element.addEventListener('click', pick); element.inspectorListeners = [() => element.removeEventListener?.('click', pick)];
        list.append(element); buttons.set(entity.id, element);
      }
    }
    for (const [id, element] of buttons) element.setAttribute('aria-pressed', String(selection?.entityId === id));
    previous.disabled = page === 0 || !entities.length; next.disabled = page + 1 >= pages || !entities.length;
    setText(count, entities.length ? `${page * PAGE_SIZE + 1}–${Math.min(entities.length, (page + 1) * PAGE_SIZE)} of ${entities.length}${snapshot.truncated ? ' (display limit)' : ''}` : 'No visible entities');
  };
  const refresh = (current = host.getSnapshot(), reason = host.getStatus().reason) => {
    if (disposed) return;
    snapshot = current;
    if (draft && !host.accepts(draft.lease)) cancel();
    if (selection && renderer.world && (selection.generation !== renderer.world.generation || selection.worldId !== renderer.world.worldId)) {
      selection = null; cycleState = null; renderer.inspectionRowAnchor = null; renderer.setWorldSelection(null, { render: false });
      setText(summary, 'World reset. Select an entity in the new generation.');
    }
    nearestId = null;
    if (selection) {
      const entity = current && getProcgenPresentationEntity(current, selection.entityId), actor = activeActor();
      if (actor && Number.isFinite(actor.x) && Number.isFinite(actor.y)) selection = Object.freeze({ ...selection, lane: actor.laneIndex, x: actor.x, y: actor.y, action: actionName(actor) });
      const removed = selection.actorId != null && !actor && renderer.lifecycleState === 'ready';
      setText(summary, `${selection.label} · ${removed ? `Finished: ${selection.finalReason || 'actor no longer active'}` : !entity ? 'Offscreen · use Reveal' : selection.action || selection.cause || 'Visible'}`);
      const lane = getLaneInfo(selection.lane);
      setText(role, lane ? [lane.name || `Lane ${selection.lane + 1}`, lane.role, lane.family, lane.mode].filter(Boolean).join(' · ') : `Lane ${selection.lane + 1}`);
      if (removed && current) {
        let distance = Infinity;
        for (const candidate of current.entities) if (candidate.kind === 'actor') {
          const d = (candidate.bounds.x + candidate.bounds.width / 2 - selection.x) ** 2 + (candidate.bounds.y + candidate.bounds.height / 2 - selection.y) ** 2;
          if (d < distance) { distance = d; nearestId = candidate.id; }
        }
      }
      revealButton.disabled = removed || renderer.lifecycleState !== 'ready'; clearButton.disabled = false;
    } else {
      if (!summary.textContent.startsWith('World reset.')) setText(summary, current ? 'Select an actor, source object or marked support contact.' : reason || 'Wait for the world display.');
      setText(role, 'Selection stays pinned without enabling camera follow.'); revealButton.disabled = clearButton.disabled = true;
    }
    nearestButton.hidden = !nearestId; nearestButton.disabled = !nearestId;
    if (!current) { revealButton.disabled = true; setText(capability, `${reason || 'World inspection is waiting for a presented frame.'} Inspection only; editing is unavailable.`); }
    else setText(capability, 'Inspection only. Terrain, field and gate editing is unavailable here.');
    renderList(); effectInspector?.refresh(selection);
  };
  const cycle = (clientX, clientY, lease = null) => {
    const hits = host.pick(clientX, clientY, lease), signature = hits.map(entity => entity.id).join('|');
    const repeat = cycleState && signature === cycleState.signature && Math.hypot(clientX - cycleState.x, clientY - cycleState.y) < 6;
    const index = repeat ? (cycleState.index + 1) % Math.max(1, hits.length) : 0;
    cycleState = { signature, x: clientX, y: clientY, index };
    if (!hits.length) { clear(); return false; }
    const entity = hits[index], accepted = lease?.snapshot || host.getSnapshot();
    if (!accepted) return false;
    // A frozen inspection gesture selects its captured identity, even if it moved offscreen.
    selection = Object.freeze({ generation: accepted.generation, worldId: accepted.worldId, entityId: entity.id, actorId: entity.actorId, kind: entity.kind, lane: entity.lane,
      label: entity.label, action: entity.action, cause: entity.cause, x: entity.bounds.x + entity.bounds.width / 2, y: entity.bounds.y + entity.bounds.height / 2, finalReason: null });
    renderer.setWorldSelection(entity.id); refresh(host.getSnapshot()); return true;
  };
  on(canvas, 'pointerdown', event => {
    if (draft || event.button !== 0) return;
    const lease = host.acquire('world-inspector'); if (!lease) return;
    draft = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, lease };
  }, true);
  on(canvas, 'pointermove', event => { if (draft?.pointerId === event.pointerId && Math.hypot(event.clientX - draft.x, event.clientY - draft.y) >= 4) cancel(); }, true);
  on(canvas, 'pointerup', event => {
    if (!draft || draft.pointerId !== event.pointerId) return;
    const current = draft; draft = null;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4 && host.accepts(current.lease)) cycle(current.x, current.y, current.lease);
    current.lease.release();
  });
  const cancelPointer = event => { if (draft?.pointerId === event.pointerId) cancel(); };
  on(canvas, 'pointercancel', cancelPointer); on(canvas, 'lostpointercapture', cancelPointer);
  on(canvas, 'dblclick', event => { if (host.pick(event.clientX, event.clientY).length) { event.preventDefault(); event.stopImmediatePropagation?.(); } }, true);
  if (window?.addEventListener) on(window, 'blur', cancel);
  on(canvas, 'keydown', event => { if (event.key === 'Escape') { cancel(); clear(); } });
  const terminal = batch => {
    if (!selection || batch.generation !== selection.generation || batch.worldId !== selection.worldId) return;
    const fact = batch.facts.find(value => value.kind === 'ActorTerminated' && value.actorId === selection.actorId);
    if (fact) selection = Object.freeze({ ...selection, finalReason: String(fact.terminationReason || 'actor lifecycle ended').slice(0, 160) });
  };
  renderer.world.soundEvents?.onBatch?.on(terminal);
  const release = host.subscribe(refresh); renderer.render(false); refresh();
  return { select, clear, reveal, cycle, refresh: () => refresh(), getState: () => Object.freeze({ selection, available: !!snapshot, draft: !!draft, visibleEntities: snapshot?.entities.length || 0, page, nearestId }),
    dispose() {
      if (disposed) return; disposed = true; effectInspector?.dispose(); cancel(); renderer.world?.soundEvents?.onBatch?.off(terminal); release();
      for (const stop of listeners) stop(); listeners.length = 0;
      for (const element of buttons.values()) for (const stop of element.inspectorListeners || []) stop(); buttons.clear();
      renderer.setWorldSelection(null, { render: false }); renderer.inspectionRowAnchor = null; selection = snapshot = cycleState = null;
      section.remove?.(); if (section.parentNode) section.parentNode.removeChild(section); else section.parent?.removeChild(section);
    } };
}
