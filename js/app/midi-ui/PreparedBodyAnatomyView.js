import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';

let ordinal = 0;
export function createPreparedBodyAnatomyView({ document, getPlayback, resourceBudget = null } = {}) {
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'prepared-anatomy-' + (++ordinal), kind: 'bounded-body-contact-slot-presentation', category: 'graphics', bytes: 262144 });
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const element = node('details'), summary = node('summary', 'Shared body anatomy'), status = node('p'), selector = node('select'), slots = node('dl'), contacts = node('ul'), sources = node('ul'), refreshButton = node('button', 'Refresh body owners');
  selector.setAttribute('aria-label', 'Exact prepared body revision'); status.setAttribute('role', 'status'); refreshButton.type = 'button'; contacts.setAttribute('aria-label', 'Observed preparation owners'); sources.setAttribute('aria-label', 'Owned finite strike sources');
  let disposed = false, selected = null;
  const row = (title, text) => { slots.append(node('dt', title), node('dd', text)); };
  const refresh = () => {
    if (disposed) return;
    const snapshot = getPlayback()?.preparedBodyAnatomy?.(), inventory = snapshot?.surfaces, bodies = inventory?.bodies || [], bindings = inventory?.bindings || [];
    if (bodies.length > 8 || bindings.length > 32) { status.textContent = 'The body inventory exceeds this bounded presentation. Inspect the owner diagnostics.'; slots.replaceChildren(); contacts.replaceChildren(); sources.replaceChildren(); return; }
    selected = selector.value || selected; selector.replaceChildren();
    for (const body of bodies) { const option = node('option', (body.quarantined ? 'Unavailable · ' : body.active ? 'Current · ' : 'Retained · ') + body.surfaceId + ' · ' + body.bodyInstanceId.slice(0, 12)); option.value = body.bodyInstanceId; selector.append(option); }
    if (!bodies.some(body => body.bodyInstanceId === selected)) selected = bodies.find(body => body.active)?.bodyInstanceId || bodies[0]?.bodyInstanceId || null; if (selected) selector.value = selected;
    slots.replaceChildren(); contacts.replaceChildren(); sources.replaceChildren(); const body = bodies.find(body => body.bodyInstanceId === selected);
    if (!body) { const network = snapshot?.sceneNetwork; status.textContent = network ? network.bodyCount + ' anchored network bodies · ' + (network.active ? 'current route' : 'route unavailable') + '. Its actual bus exciter and sparse coupling are inspected in Shared bodies.' : 'No observed prepared surface is bound. Prepare and bind a skin or bar, or load Three Hands.'; selector.disabled = true; return; }
    selector.disabled = false; const held = bindings.filter(binding => binding.bodyInstanceId === body.bodyInstanceId), finite = snapshot.finiteSources?.bodySources?.find(row => row.bodyInstanceId === body.bodyInstanceId);
    status.textContent = (body.quarantined ? 'Unavailable body · ' : body.active ? 'Current body · ' : 'Retained body · ') + held.length + ' preparation owners. Preparation moves create zero new notes; processor application and audibility remain separate evidence.';
    row('EXCITER', (finite?.semanticGates || 0) + ' semantic source gates · ' + (finite?.pendingExciters || 0) + ' owned finite forces awaiting completion. A source end does not clear shared body energy.');
    row('BODY', body.nodeId + ' · ' + body.processorRevision + ' · surface ' + body.surfaceId + '/r' + body.surfaceRevision + ' · map ' + body.surfaceMap.id + '/r' + body.surfaceMap.revision + ' · topology r' + body.surfaceMap.boundTopologyRevision + '. Identity: ' + body.bodyInstanceId);
    row('TOUCH / LOSS', held.filter(binding => ['touch', 'mode-loss'].includes(binding.kind)).length + ' contact contributions. Each ends independently; existing contacts keep this exact body through replacement. Released damping changes future decay and restores no lost energy.');
    row('PICKUP', held.filter(binding => ['pickup-left', 'pickup-right'].includes(binding.kind)).length + ' observed pickup owners. Pickup position changes observation only. A released pickup keeps its last observation position.');
    for (const binding of held) contacts.append(node('li', 'Actor ' + binding.actorId + ' · ' + binding.contactSpanId + ' → ' + binding.kind + (binding.lossMaskId ? ' ' + binding.lossMaskId : '') + ' / slot ' + binding.slot + ' · map r' + binding.mapRevision + (binding.position ? ' · normalized (' + binding.position.x01.toFixed(4) + ', ' + binding.position.y01.toFixed(4) + ')' : '') + (binding.amount01 != null ? ' · requested loss ' + binding.amount01 : '') + ' · submitted frame ' + binding.targetFrame + '.'));
    if (!held.length) contacts.append(node('li', 'No current contact contribution is owned by this body.'));
    for (const source of finite?.sources || []) sources.append(node('li', 'Actor ' + source.actorId + ' · ' + source.intentId + ' · ' + source.sourceEventCount + ' source facts · target frame ' + source.targetFrame + (source.applicationFrame == null ? ' · processor application unconfirmed.' : ' · processor acknowledged frame ' + source.applicationFrame + '. Individual acoustic audibility remains unconfirmed.')));
    if (finite?.omittedSources) sources.append(node('li', finite.omittedSources + ' more owned sources omitted from this bounded list.'));
    if (!finite?.pendingExciters) sources.append(node('li', 'No finite force is pending. Stored body energy and tail completion are separate from this source inventory.'));
  };
  const select = () => { selected = selector.value; refresh(); }, toggle = () => { if (element.open) refresh(); };
  selector.addEventListener('change', select); refreshButton.addEventListener('click', refresh); element.addEventListener('toggle', toggle);
  element.append(summary, status, selector, refreshButton, slots, node('h4', 'Observed touch and pickup contacts'), contacts, node('h4', 'Finite strike ownership'), sources);
  return Object.freeze({ element, refresh, dispose() { if (disposed) return true; storage.release(); disposed = true; selector.removeEventListener('change', select); refreshButton.removeEventListener('click', refresh); element.removeEventListener('toggle', toggle); element.remove(); return true; } });
}
