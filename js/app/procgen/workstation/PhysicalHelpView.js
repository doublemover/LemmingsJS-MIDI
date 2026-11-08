import { HELP_TOPICS, helpTopic } from '../../controls/HelpTopics.js';
import { explainPhysicalCause } from './PhysicalCauseExplanation.js';
import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

let serial = 0;
export function createPhysicalHelpView({ document, dispatcher, displayScheduler, resourceBudget, readSelected, performAction, onStatus = () => {} }) {
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-help-' + (++serial), kind: 'contextual-help-and-selected-cause', category: 'graphics', bytes: 262144 });
  const node = (tag, text = '') => { const el = document.createElement(tag); el.textContent = text; return el; };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-physical-help'; dialog.setAttribute('aria-label', 'Physical music help and selected cause');
  const heading = node('h2', 'Physical music help'), search = node('input'), topics = node('div'), diagnosis = node('section'), shortcuts = node('details'), shortcutTitle = node('summary', 'Current registered shortcuts'), shortcutRows = node('dl');
  const close = node('button', 'Close help'), refresh = node('button', 'Refresh selected cause'), remedy = node('button');
  for (const button of [close, refresh, remedy]) button.type = 'button';
  search.type = 'search'; search.maxLength = 160; search.setAttribute('aria-label', 'Search physical music concepts');
  shortcuts.append(shortcutTitle, shortcutRows); dialog.append(heading, search, topics, diagnosis, refresh, remedy, shortcuts, close); document.body.append(dialog);
  let disposed = false, previousFocus = null, mode = 'evidence', lastKey = null, action = null;
  const listeners = [], listen = (el, event, run) => { el.addEventListener(event, run); listeners.push(() => el.removeEventListener(event, run)); };
  const render = () => {
    if (disposed || !dialog.open) return;
    const source = readSelected(), explanation = explainPhysicalCause(source), query = search.value.trim().toLowerCase();
    const key = JSON.stringify([mode, query, source?.lane?.id, source?.revision, source?.mix?.outputState, explanation.evidenceRevision, source?.operational?.identity, dispatcher.bindingState()]);
    if (key === lastKey) return; lastKey = key;
    const matching = HELP_TOPICS.filter(value => [value.concept, value.shortHint].join(' ').toLowerCase().includes(query));
    const primary = helpTopic(mode), ordered = primary && matching.includes(primary) ? [primary, ...matching.filter(value => value !== primary)] : matching;
    topics.replaceChildren(...ordered.map(value => { const section = node('section'); section.append(node('h3', value.concept), node('p', value.shortHint));
      if (value.exampleFixture) section.append(node('p', 'Practice reference: ' + value.exampleFixture + '. Open an installed lesson explicitly; help never replaces the current project.'));
      return section; }));
    diagnosis.replaceChildren(node('h3', 'Selected cause · ' + (source?.lane?.name || 'unavailable')),
      node('p', 'Tick ' + explanation.sourceTick + ' · coverage ' + explanation.coverage + '. This is a retained observation, not a live signal meter.'),
      ...explanation.stages.map(value => { const row = node('p'); row.append(node('strong', value.label + ' · ' + value.state + ': '), document.createTextNode(value.detail)); return row; }));
    action = explanation.action; remedy.hidden = !action; remedy.textContent = action?.label || '';
    shortcutRows.replaceChildren(...dispatcher.list().slice(0, 96).flatMap(value => [node('dt', value.label + (value.enabled ? '' : ' · currently unavailable')), node('dd', value.shortcut || 'No shortcut assigned')]));
  };
  const surface = displayScheduler.register({ id: 'physical-context-help-' + serial, element: dialog, intervalMs: 250, write: render });
  const invalidate = () => { lastKey = null; surface.invalidate(); };
  listen(search, 'input', invalidate); listen(refresh, 'click', invalidate); listen(close, 'click', () => dialog.close());
  listen(dialog, 'close', () => { lastKey = null; previousFocus?.isConnected && previousFocus.focus?.({ preventScroll: true }); });
  listen(remedy, 'click', () => { if (!action) return; const captured = action; dialog.close(); Promise.resolve().then(() => performAction(captured)).catch(error => onStatus(error.message)); });
  const unwatch = dispatcher.watchBindings(invalidate);
  return Object.freeze({ open(topicId = 'evidence') { if (disposed) return false; mode = topicId; previousFocus = document.activeElement; search.value = ''; lastKey = null;
    if (!dialog.open) dialog.showModal(); render(); search.focus(); return true; }, invalidate,
  dispose() { if (disposed) return; disposed = true; unwatch(); surface.dispose(); for (const unlisten of listeners) unlisten(); dialog.remove(); storage.release(); } });
}
