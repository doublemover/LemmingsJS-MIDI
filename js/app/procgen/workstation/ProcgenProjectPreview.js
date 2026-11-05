import { readProcgenProjectSummary } from './ProcgenProjectSummary.js';

export function createProcgenProjectPreview({ document, readState, open, verify, compare }) {
  const node = (tag, text) => { const value = document.createElement(tag); if (text) value.textContent = text; return value; };
  const element = node('section'), heading = node('h3', 'Selected project'), facts = node('dl'), policy = node('p'), comparison = node('p'), action = node('button'), check = node('button', 'Find verified recovery'), match = node('button', 'Compare named save');
  element.className = 'studio-project-preview'; element.setAttribute('aria-label', 'Selected project preview'); element.hidden = true;
  const rows = new Map(); for (const label of ['Kind', 'Name', 'Project reference', 'Saved', 'Saved revision', 'World', 'Compatibility', 'Durable range', 'Source named save']) { const value = node('dd'); facts.append(node('dt', label), value); rows.set(label, value); }
  action.type = check.type = match.type = 'button'; action.dataset.projectAction = 'open'; check.dataset.projectAction = 'verify'; match.dataset.projectAction = 'compare'; element.append(heading, facts, policy, comparison, check, match, action);
  let disposed = false;
  const onOpen = () => { if (!disposed) open(); }, onVerify = () => { if (!disposed) verify(); }, onCompare = () => { if (!disposed) compare(); };
  action.addEventListener('click', onOpen); check.addEventListener('click', onVerify); match.addEventListener('click', onCompare);
  const write = (target, text) => { if (target.textContent !== text) target.textContent = text; };
  const render = () => {
    if (disposed) return; const state = readState(), selected = state.selection; element.hidden = !selected; if (!selected) return;
    const item = readProcgenProjectSummary(selected, { verification: selected.verification }), recovery = item.kind !== 'checkpoint', legacy = item.kind === 'legacy-recovery', verified = item.verification === 'checksum-verified';
    write(rows.get('Project reference'), recovery ? 'Recovery generation ' + (item.recoveryGeneration ?? 'not recorded') : item.id || 'Not recorded');
    write(rows.get('Kind'), legacy ? 'Legacy recovery; no stored checksum' : recovery ? 'Recovery checkpoint' : 'Named full checkpoint'); write(rows.get('Name'), item.name); write(rows.get('Saved'), item.savedAt ? new Date(item.savedAt).toLocaleString() : 'Time not recorded');
    write(rows.get('Saved revision'), recovery ? 'Recovery generation ' + (item.recoveryGeneration ?? 'not recorded') + '; captured edit revision ' + (item.documentRevision ?? 'not recorded') : item.revision == null ? 'Not recorded' : String(item.revision));
    write(rows.get('World'), [item.laneCount == null ? 'Lane count not recorded' : item.laneCount + ' lanes', item.seed == null ? 'seed not recorded' : 'seed ' + item.seed, item.tick == null ? 'tick not recorded' : 'tick ' + item.tick].join(' · '));
    write(rows.get('Compatibility'), item.compatibility === 'unsupported-header' ? 'Unsupported saved format. The current project will be kept.' : item.compatibility === 'supported-header' ? 'Supported saved header. Assets and physical replay are checked during Open.' : 'Compatibility will be checked during Open. The source is not an empty project.');
    element.dataset.kind = item.kind; element.dataset.verification = item.verification; element.dataset.recoveryGeneration = item.recoveryGeneration == null ? '' : String(item.recoveryGeneration);
    const mismatch = item.assetDigest && state.execution?.assetDigest && item.assetDigest !== state.execution.assetDigest;
    if (mismatch && item.compatibility !== 'unsupported-header') write(rows.get('Compatibility'), 'The saved asset set differs from this build. Exact dependencies are checked during Open before replacement.');
    const range = item.range; write(rows.get('Durable range'), verified && range ? (range.lastSequence ? 'Verified stored records ' + range.firstSequence + '–' + range.lastSequence : 'Verified base checkpoint; no journal records') + '; generation ' + range.initial.generation + ', tick ' + range.initial.tick + ' through generation ' + range.final.generation + ', tick ' + range.final.tick + '. Later work may be missing; physical replay is checked during Open.' : verified ? 'Stored checkpoint checksum verified. No incremental range was recorded.' : legacy ? 'No verified durable range is available.' : recovery ? 'Not verified. Verify the stored source to inspect its exact retained range.' : 'Named checkpoint; separate captures and prepared files are not part of this save.');
    write(rows.get('Source named save'), item.sourceDocumentId ? 'Named save revision ' + (item.sourceStoredRevision ?? 'not recorded') + ' at recovery capture.' : 'No named source identity was recorded.');
    write(policy, legacy ? 'Opening this legacy recovery does not establish a verified durable prefix. It opens paused; save a recovered copy to create a new named project.' : 'Opens paused and silent. Recording, MIDI thru and physical automation remain unarmed. Separate recordings and prepared files keep their own source.');
    const named = state.comparison == null ? state.comparison : readProcgenProjectSummary(state.comparison); write(comparison, named === undefined ? '' : named === null ? 'The source named project is no longer available. Recovery remains separate.' : 'Current named save: ' + named.name + ' · revision ' + (named.revision ?? 'not recorded') + ' · ' + (named.savedAt ? new Date(named.savedAt).toLocaleString() : 'time not recorded') + '. Neither source is replaced by this comparison.'); comparison.hidden = named === undefined;
    action.textContent = legacy ? 'Open unverified legacy recovery' : recovery ? 'Open verified recovery' : 'Open selected project'; action.disabled = state.busy || !item.id || item.compatibility === 'unsupported-header' || recovery && !legacy && !verified;
    check.hidden = !recovery || legacy || verified; check.disabled = state.busy; match.hidden = !recovery || !verified || !item.sourceDocumentId; match.disabled = state.busy;
  };
  return Object.freeze({ element, render, dispose() { if (disposed) return; disposed = true; action.removeEventListener('click', onOpen); check.removeEventListener('click', onVerify); match.removeEventListener('click', onCompare); element.remove(); } });
}
