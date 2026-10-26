import { createResonatorMorphOwner } from './ResonatorMorphOwner.js';
import { readBrowserBuildResponse } from '../../runtime/BrowserGenerationService.js';
import { deliverArtifactToAnchor } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const PROOF_SOURCE = new URL('../../../content/morphs/dry-bright-proof.json', import.meta.url);
const roles = ['excitation', 'pickupLeft', 'pickupRight'];
export function createResonatorMorphView({ document, window, resourceBudget, jobs } = {}) {
  const listeners = [], rowListeners = [], retirement = createProcgenRetirementScope(), node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  let disposed = false, lastCandidate = null, lastSources = '', anchors = [], selected = new Map(), busy = false;
  const root = node('details'); root.className = 'studio-seed-body'; root.append(node('summary', 'MORPH MAP · reviewed named resonator correspondence'));
  const help = node('p', 'Choose two named modal endpoint JSON files or inspect the original dry/bright proof. Review pairs, unmatched modes and signed excitation/pickup sites. This prepares a next-onset parameter map. Continuous audio, physical state transfer and perceptual continuity remain unqualified.'), controls = node('div'), status = node('output'), endpoints = node('div'), table = node('div'), preview = node('pre'); controls.className = 'studio-seed-actions'; status.setAttribute('aria-live', 'polite');
  const listen = (element, event, handler, list = listeners) => { element.addEventListener(event, handler); list.push(() => element.removeEventListener(event, handler)); };
  const owner = createResonatorMorphOwner({ resourceBudget, jobs, onState: () => refresh() });
  const say = message => { if (!disposed) status.textContent = message; };
  const run = operation => { if (busy || disposed) return; busy = true; refresh(); Promise.resolve().then(operation).catch(error => say(error.message)).finally(() => { busy = false; refresh(); }); };
  const button = (label, handler) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', handler); controls.append(value); return value; };
  const files = [0, 1].map(index => { const label = node('label', 'Endpoint ' + (index ? 'B' : 'A') + ' · named modal JSON'), input = node('input'); input.type = 'file'; input.accept = 'application/json,.json'; input.setAttribute('aria-label', label.textContent); label.append(input); controls.append(label); listen(input, 'change', () => { const file = input.files?.[0]; if (file) run(async () => { await owner.importEndpoint(index, file); anchors = []; reviewed.checked = false; sites.checked = false; say('Endpoint imported. The previous correspondence is invalidated.'); }); }); return input; });
  const original = button('Load original dry / bright proof', () => run(async () => {
    const offered = await owner.importProof({ size: 65536, text: async signal => new TextDecoder('utf-8', { fatal: true }).decode(await readBrowserBuildResponse(await window.fetch(PROOF_SOURCE, { cache: 'force-cache', signal }), 65536, signal)) }); anchors = offered.anchors; sites.checked = false; reviewed.checked = false; say('Original four/six-mode endpoints loaded. Review site correspondence and mode pairs explicitly.');
  }));
  const siteLabel = node('label'), sites = node('input'); sites.type = 'checkbox'; siteLabel.append(sites, document.createTextNode(' Corresponding excitation and left/right pickup sites are intended across these endpoints'));
  const reviewLabel = node('label'), reviewed = node('input'); reviewed.type = 'checkbox'; reviewLabel.append(reviewed, document.createTextNode(' I reviewed the resolved pairs, unmatched modes, signed weights and endpoint sites'));
  const siteMap = state => sites.checked ? Object.fromEntries(roles.map(role => [role, { a: state.endpoints[0].sites[role], b: state.endpoints[1].sites[role] }])) : {};
  const analyze = button('Analyze correspondence candidates', () => run(async () => { const state = owner.state(); reviewed.checked = false; await owner.analyze({ anchors, siteCorrespondence: siteMap(state) }); say('Candidate assignment ready. Ambiguity and missing signatures still require review.'); }));
  const resolve = button('Prepare reviewed next-onset map', () => run(async () => { if (!sites.checked || !reviewed.checked) throw new Error('Review the displayed pairs and explicit site correspondence before preparing the map.'); const state = owner.state(), pairs = [...selected].filter(([, bId]) => bId).map(([aId, bId]) => ({ aId, bId })); await owner.resolve({ pairs, siteCorrespondence: siteMap(state), reviewed: true, transitionPolicy: 'next-onset-only' }); paintPreview(); say('Reviewed map prepared. This is a parameter preview; audio/render qualification remains pending.'); }));
  const exportMap = button('Download reviewed map JSON', () => run(() => { const artifact = owner.prepareExport(), receipt = deliverArtifactToAnchor(artifact, { document, windowRef: window }); artifact.discard(); say(receipt.state === 'delivery-requested' ? 'Map download requested. Browser completion is unacknowledged; source endpoints remain unchanged.' : 'Map delivery: ' + receipt.state); }));
  const cancel = button('Cancel map preparation', () => owner.cancel()), uLabel = node('label', 'Parameter preview · MORPH'), u = node('input'); u.type = 'range'; u.min = '0'; u.max = '1'; u.step = '0.01'; u.value = '0.5'; u.setAttribute('aria-label', 'Reviewed map parameter preview position'); uLabel.append(u);
  const paintPreview = () => { if (!owner.state().map) { preview.textContent = ''; return; } try { const value = owner.preview(Number(u.value)); preview.textContent = 'Parameter preview only · u=' + value.u.toFixed(2) + '\n' + value.modes.map(mode => mode.id + ' · ' + mode.frequencyHz.toFixed(2) + ' Hz · amplitude T60 ' + mode.t60Seconds.toFixed(3) + ' s').join('\n'); } catch (error) { preview.textContent = error.message; } };
  listen(u, 'input', paintPreview);
  listen(reviewed, 'change', () => { if (!reviewed.checked) owner.invalidateMap(); });
  listen(sites, 'change', () => { reviewed.checked = false; owner.invalidateMap(); });
  const draw = state => {
    for (const remove of rowListeners.splice(0)) remove(); table.replaceChildren(); selected = new Map(); const candidate = state.candidate;
    if (!candidate) return;
    selected = new Map(candidate.pairs.map(pair => [pair.aId, pair.bId])); const grid = node('table'), head = node('tr'); for (const text of ['Endpoint A', 'Resolved endpoint B', 'Confidence / alternatives']) head.append(node('th', text)); grid.append(head);
    for (const mode of state.endpoints[0].modes) {
      const row = node('tr'), choice = node('select'), cell = node('td'), pair = candidate.pairs.find(pair => pair.aId === mode.id), option = node('option', 'Unmatched · fade contribution'); option.value = ''; choice.append(option); choice.setAttribute('aria-label', 'Pair for mode ' + mode.id);
      for (const other of state.endpoints[1].modes) { const option = node('option', other.id + ' · ' + other.frequencyHz + ' Hz'); option.value = other.id; choice.append(option); } choice.value = selected.get(mode.id) || ''; cell.append(choice); row.append(node('td', mode.id + ' · ' + mode.frequencyHz + ' Hz / ' + mode.t60Seconds + ' s'), cell, node('td', (pair?.confidence || 'Unmatched candidate') + (pair?.alternatives?.length ? ' · ' + pair.alternatives.map(value => value.bId + ' cost ' + value.cost.toFixed(3)).join(', ') : ''))); grid.append(row);
      listen(choice, 'change', () => { selected.set(mode.id, choice.value); reviewed.checked = false; owner.invalidateMap(); }, rowListeners);
    }
    table.append(grid, node('p', 'Initially unmatched B modes: ' + (candidate.unmatchedBIds.join(', ') || 'none') + '. Changing pair choices recomputes the resolved unmatched set at preparation.'));
  };
  function refresh() {
    if (disposed) return; const state = owner.state(), locked = busy || state.active || state.unknownRetirement > 0;
    for (const element of [...files, original, analyze, resolve, exportMap]) element.disabled = locked; analyze.disabled ||= state.endpoints.some(value => !value); resolve.disabled ||= !state.candidate; exportMap.disabled ||= !state.map; cancel.disabled = !state.active; u.disabled = !state.map || locked;
    const sourceKey = String(state.sourceRevision);
    if (sourceKey !== lastSources) { lastSources = sourceKey; endpoints.replaceChildren(); for (const [index, endpoint] of state.endpoints.entries()) if (endpoint) { const detail = node('details'); detail.append(node('summary', (index ? 'B · ' : 'A · ') + endpoint.id + ' · source ' + endpoint.sourceAssetHash.slice(0, 12)), node('pre', JSON.stringify({ sites: endpoint.sites, modes: endpoint.modes }, null, 2))); endpoints.append(detail); } }
    if (state.candidate !== lastCandidate) { lastCandidate = state.candidate; draw(state); }
    if (!state.map) preview.textContent = ''; if (state.error) say(state.error); else if (state.active) say(state.phase + '…');
  }
  root.append(help, controls, siteLabel, reviewLabel, status, endpoints, table, uLabel, preview); refresh();
  return Object.freeze({ element: root, state: owner.state, suspend: owner.cancel, dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; const producer = owner.dispose(); return retirement.retire([{ name: 'morph-owner', run: async () => { await producer.completion; if (producer.outcome !== 'complete') throw new Error('Morph endpoints or exports retain unresolved ownership.'); } }, { name: 'morph-view', run: () => { for (const remove of [...listeners.splice(0), ...rowListeners.splice(0)]) remove(); root.remove(); } }]); } });
}
