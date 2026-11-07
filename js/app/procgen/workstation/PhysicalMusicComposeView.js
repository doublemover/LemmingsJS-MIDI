import { createPhysicalMusicStarterGoal } from './PhysicalMusicStarter.js';
import { validatePhysicalMusicGoal } from './PhysicalMusicGoal.js';

export function createPhysicalMusicComposeView({ document, readSource, readState, start, cancel, select, apply, prepareStarter = () => {}, prepareAudition = () => {}, readAudition = () => null, runAudition = () => {}, stopAudition = () => {}, exportReport = () => {}, onDraftChange = () => {}, onStatus = () => {} } = {}) {
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; }, element = node('section');
  element.__ownedControl = true; element.className = 'studio-compose'; element.setAttribute('aria-label', 'Physical musical composition');
  const sourceLabel = node('p'), message = node('output'), controls = node('div'), drafts = node('div'), results = node('div'), report = node('pre'), ghost = node('div');
  message.setAttribute('role', 'status'); report.style.whiteSpace = 'pre-wrap'; report.style.overflowWrap = 'anywhere';
  const button = (label, action) => { const value = node('button', label); value.type = 'button'; value.addEventListener('click', () => { Promise.resolve().then(action).catch(error => { message.textContent = error.message; onStatus(error.message); }); }); return value; };
  const field = (parent, label, value, type = 'number') => { const wrap = node('label', label), input = node('input'); input.type = type; input.value = value; input.setAttribute('aria-label', label); if (type === 'number') { input.step = '1'; input.min = '0'; } wrap.append(input); parent.append(wrap); return input; };
  const choice = (parent, label, choices) => { const wrap = node('label', label), input = node('select'); input.setAttribute('aria-label', label); for (const [value, title] of choices) { const option = node('option', title); option.value = value; input.append(option); } wrap.append(input); parent.append(wrap); return input; };
  const source = readSource(), basic = node('fieldset'); basic.append(node('legend', 'GOAL · desired musical results'));
  const units = choice(basic, 'Goal time units', [['ticks', 'Physical ticks'], ['seconds', 'Seconds · fixed study clock'], ['beats', 'Beats · fixed study clock']]),
    mapping = field(basic, 'Actual mapping ID', source?.graph?.instruments[0]?.id || 'voice0', 'text'), attacks = field(basic, 'Desired onsets · comma separated', '', 'text'),
    tolerance = field(basic, 'Onset tolerance', 0), period = field(basic, 'Desired period ·0 disables', 120), horizon = field(basic, 'Physical horizon in ticks', 480),
    tickMs = field(basic, 'Fixed tick duration in milliseconds', source?.tickDurationMs || 20), bpm = field(basic, 'Fixed tempo in BPM', source?.bpm || 120),
    candidates = field(basic, 'Candidate limit', 64), logicalTicks = field(basic, 'Logical tick budget', 30720);
  for (const input of [tolerance, period, tickMs, bpm]) input.step = 'any';
  const ratioEnabled = field(basic, 'Require period ratio', '', 'checkbox'), ratioRight = field(basic, 'Other ratio mapping ID', 'voice1', 'text'), ratioNumerator = field(basic, 'Left period ratio term', 3), ratioDenominator = field(basic, 'Right period ratio term', 4);
  ratioEnabled.checked = false;
  const handles = node('fieldset'); handles.append(node('legend', 'Finite physical handles · all other terrain and crew stay locked'));
  const kind = choice(handles, 'Physical handle kind', [['right-wall-x', 'Right wall X'], ['pickup-x', 'Vertical pickup X'], ['worker-tick', 'Shared skill application tick'], ['release-spread-ticks', 'Sensitivity · release spread ticks'], ['release-clock-mode', 'Sensitivity · clock0=locked,1=adaptive'], ['junction-configuration', 'Sensitivity · junction configuration index'], ['layer-muted', 'Sensitivity · layer0=unmuted,1=muted']]),
    handleId = field(handles, 'Handle ID', 'wall0', 'text'), values = field(handles, 'Allowed integer values · comma separated', '80,81,82', 'text'),
    laneId = field(handles, 'Physical lane index', 0), x1 = field(handles, 'Editable rectangle left', 80), x2 = field(handles, 'Editable rectangle right', 83),
    y1 = field(handles, 'Editable rectangle top', 65), y2 = field(handles, 'Editable rectangle bottom', 80),
    pickupId = field(handles, 'Pickup ID', 'entry0', 'text'), actorId = field(handles, 'Source actor ID', source?.actorIds?.[0] ?? 0),
    skill = choice(handles, 'Shared skill', [['builder', 'Builder'], ['basher', 'Basher'], ['digger', 'Digger'], ['miner', 'Miner']]);
  const junctionId = field(handles, 'Authored junction ID', source?.junctions?.[0]?.id || 'junction0', 'text'),
    junctionWindow = field(handles, 'Junction eligibility window in ticks', 8), junctionPolicy = choice(handles, 'Junction request policy', [['waitForSafeBoundary', 'Wait for actual safe boundary'], ['rejectIfBusy', 'Reject when actually busy']]),
    layerId = field(handles, 'Contingent layer ID', source?.graph?.feedback?.layers?.[0]?.id || 'layer0', 'text');
  const editList = node('ol'), inventory = node('fieldset'); inventory.append(node('legend', 'Joint skill inventory'));
  const skillFields = Object.fromEntries(['builder', 'basher', 'digger', 'miner'].map(name => [name, field(inventory, name + ' uses', 0)]));
  const advanced = node('details'); advanced.append(node('summary', 'Complete goal · ratios, protection and exact selectors'));
  const json = node('textarea'); json.rows = 18; json.setAttribute('aria-label', 'Complete physical music goal JSON'); json.style.width = '100%'; advanced.append(json);
  const editor = choice(drafts, 'Goal editor', [['fields', 'Numeric fields and handles'], ['json', 'Complete goal JSON']]);
  let edits = [], protectedRegions = [], goal = null, draftDirty = false, jsonDirty = false, jsonAuthority = false, disposed = false;
  const markDraft = () => { draftDirty = true; applyButton.disabled = true; onDraftChange(); };
  const setEditor = mode => { jsonAuthority = mode === 'json'; editor.value = mode; basic.disabled = handles.disabled = inventory.disabled = jsonAuthority; json.disabled = !jsonAuthority; };
  const numbers = input => { if (!input.value.trim()) return []; const list = input.value.split(',').map(value => { if (!value.trim()) throw new Error('Every comma separated value needs a number.'); return Number(value.trim()); }); if (list.some(value => !Number.isFinite(value))) throw new Error('Use finite numeric values.'); return list; };
  const numeric = input => { if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new Error('Enter a finite value for ' + input.getAttribute('aria-label') + '.'); return Number(input.value); };
  const renderEdits = () => { editList.replaceChildren(); for (const edit of edits) { const row = node('li', edit.id + ' · ' + edit.kind + ' · [' + edit.values.join(', ') + '] '); row.append(button('Remove ' + edit.id, () => { edits = edits.filter(value => value !== edit); markDraft(); renderEdits(); })); editList.append(row); } };
  const protections = node('ul');
  handles.append(button('Protect this rectangle', () => { const region = { x1: numeric(x1), x2: numeric(x2), y1: numeric(y1), y2: numeric(y2) };
    if (protectedRegions.length >= 32 || region.x2 <= region.x1 || region.y2 <= region.y1) throw new Error('Choose a valid protected rectangle within the32-region profile.');
    protectedRegions.push(region); const row = node('li', JSON.stringify(region)); row.append(button('Remove protected rectangle', () => { protectedRegions = protectedRegions.filter(value => value !== region); row.remove(); markDraft(); jsonAuthority = false; applyButton.disabled = true; })); protections.append(row); markDraft(); jsonAuthority = false; applyButton.disabled = true;
  }), protections);
  handles.append(button('Add finite handle', () => {
    const id = handleId.value.trim(), common = { id, kind: kind.value, values: numbers(values) };
    const edit = kind.value === 'right-wall-x' ? { ...common, laneId: numeric(laneId), bounds: { x1: numeric(x1), x2: numeric(x2), y1: numeric(y1), y2: numeric(y2) } } :
      kind.value === 'pickup-x' ? { ...common, pickupId: pickupId.value.trim() } : kind.value.startsWith('release-') ? common : kind.value === 'junction-configuration' ? { ...common, junctionId: junctionId.value.trim(), eligibilityTicks: numeric(junctionWindow), junctionPolicy: junctionPolicy.value } :
        kind.value === 'layer-muted' ? { ...common, layerId: layerId.value.trim() } : { ...common, actorId: numeric(actorId), skillType: skill.value };
    if (edits.some(value => value.id === id)) throw new Error('Choose a distinct physical handle ID.'); edits.push(edit); markDraft(); renderEdits();
  }), editList);
  const build = () => {
    if (jsonAuthority) return validatePhysicalMusicGoal(JSON.parse(json.value));
    const current = readSource(); if (!current) throw new Error('Open a physical project first.');
    const selected = mapping.value.trim(), target = numbers(attacks), value = numeric(period);
    return validatePhysicalMusicGoal({ schema: 'lemmings-physical-music-goal/v1', id: 'compose-goal', revision: (goal?.revision || 0) + 1, timeDomain: units.value,
      ...(units.value === 'ticks' ? {} : { referenceTimeline: { tickDurationMs: numeric(tickMs), ...(units.value === 'beats' ? { tempoBpm: numeric(bpm) } : {}) } }),
      targetOnsets: target.map(time => ({ time, tolerance: numeric(tolerance), ...(selected ? { mappingId: selected } : {}) })),
      periodGoals: value > 0 ? [{ selector: { mappingId: selected }, period: value, tolerance: numeric(tolerance) }] : [],
      periodRatios: ratioEnabled.checked ? [{ left: { mappingId: selected }, right: { mappingId: ratioRight.value.trim() }, numerator: numeric(ratioNumerator), denominator: numeric(ratioDenominator), toleranceTicks: numeric(tolerance) }] : [],
      requiredCauseKinds: [], forbiddenCauses: [], allowedEdits: edits,
      crewConstraints: { requireAllSurvive: true, maximumActors: 64, containment: { x1: current.leftEdgeX, x2: current.width, y1: 0, y2: current.height }, protectedRegions },
      skillInventory: Object.fromEntries(Object.entries(skillFields).map(([name, input]) => [name, numeric(input)])), horizon: numeric(horizon),
      budgets: { maximumCandidates: numeric(candidates), logicalTicks: numeric(logicalTicks), maximumOnsets: 2048, maximumFacts: 65536, finalists: 1 } });
  };
  const stage = mode => { goal = build(); if (!jsonAuthority) json.value = JSON.stringify(goal, null, 2); draftDirty = false; jsonDirty = false; return start({ goal, mode }); };
  const search = button('Search physical candidates', () => stage('search')), sensitivity = button('Sample musical sensitivity', () => stage('sensitivity')),
    stop = button('Cancel study · keep draft', cancel), applyButton = button('Apply verified candidate · one undo step', () => { if (draftDirty) throw new Error('The goal draft changed; Search again before Apply.'); return apply(); });
  const audition = button('Prepare selected branch · reference sine', () => { if (draftDirty) throw new Error('Search the changed goal before preparing its selected branch audition.'); return prepareAudition(); }),
    run = button('Run prepared branch audition', runAudition), stopAudio = button('Close branch audition · stop audio', stopAudition);
  const exportStudy = button('Export source-bound study JSON', exportReport);
  controls.append(search, sensitivity, stop, audition, run, stopAudio, applyButton, exportStudy);
  const loadStarterGoal = unreachable => { goal = createPhysicalMusicStarterGoal({ unreachable }); json.value = JSON.stringify(goal, null, 2); setEditor('json'); jsonDirty = true; markDraft(); advanced.open = true; applyButton.disabled = true; };
  const starters = node('div'); starters.append(button('Prepare two-wall starter for review', prepareStarter), button('Use120/160 goal · three wall samples', () => loadStarterGoal(false)), button('Use121 goal · seven-value domain', () => loadStarterGoal(true)));
  drafts.append(starters);
  drafts.append(basic, handles, inventory, button('Copy fields to complete goal', () => { jsonDirty = false; jsonAuthority = false; goal = build(); json.value = JSON.stringify(goal, null, 2); markDraft(); setEditor('json'); advanced.open = true; }), advanced);
  editor.addEventListener('change', () => { try { if (editor.value === 'json' && !json.value.trim()) json.value = JSON.stringify(build(), null, 2); setEditor(editor.value); markDraft(); } catch (error) { editor.value = jsonAuthority ? 'json' : 'fields'; message.textContent = error.message; } });
  for (const input of [basic, handles, inventory].flatMap(parent => [...parent.querySelectorAll('input,select')])) input.addEventListener('input', () => { markDraft(); jsonAuthority = false; applyButton.disabled = true; });
  json.addEventListener('input', () => { jsonDirty = true; setEditor('json'); markDraft(); applyButton.disabled = true; });
  const plot = (study, row) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 560 150'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Hollow GOAL onsets and filled actual RESULT onsets in physical ticks'); svg.style.width = '100%';
    const mark = (tag, attrs, label) => { const value = document.createElementNS(svg.namespaceURI, tag); for (const [key, entry] of Object.entries(attrs)) value.setAttribute(key, entry); const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = label; value.append(title); svg.append(value); };
    const scale = study.goal.timeDomain === 'ticks' ? 1 : study.goal.timeDomain === 'seconds' ? 1000 / study.goal.referenceTimeline.tickDurationMs : 60000 / study.goal.referenceTimeline.tempoBpm / study.goal.referenceTimeline.tickDurationMs;
    const missed = new Set(row.metrics?.missedTargets || []), extras = new Set(row.metrics?.extraActualOnsets || []);
    for (const [index, target] of study.goal.targetOnsets.entries()) {
      if (target.tolerance) mark('rect', { x: 10 + (target.time - target.tolerance) * scale / study.goal.horizon * 540, y: 31, width: target.tolerance * 2 * scale / study.goal.horizon * 540, height: 18, fill: 'currentColor', opacity: '.15' }, 'Explicit requested tolerance band');
      mark('circle', { cx: 10 + target.time * scale / study.goal.horizon * 540, cy: 40, r: 5, fill: 'none', stroke: missed.has(index) ? '#e5ad5b' : 'currentColor', 'stroke-width': 2 }, (missed.has(index) ? 'UNMATCHED GOAL ' : 'GOAL ') + target.time + ' ' + study.goal.timeDomain);
    }
    if (!study.goal.targetOnsets.length) for (const [index, period] of study.goal.periodGoals.slice(0, 3).entries()) {
      const y = 20 + index * 22, x = 10 + period.period * scale / study.goal.horizon * 540;
      mark('line', { x1: 10, x2: x, y1: y, y2: y, stroke: 'currentColor' }, 'GOAL interval ' + period.period + ' ' + study.goal.timeDomain + ' · phase unspecified');
      for (const cx of [10, x]) mark('circle', { cx, cy: y, r: 5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, 'Requested interval endpoint; phase unspecified');
    }
    for (const [index, onset] of (row.trace?.onsets || []).entries()) mark('circle', { cx: 10 + onset.timeTicks / study.goal.horizon * 540, cy: 95 + (onset.laneId % 3) * 12, r: 3, fill: extras.has(index) ? '#e07272' : 'currentColor' }, (extras.has(index) ? 'EXTRA RESULT tick ' : 'RESULT tick ') + onset.timeTicks + ' · ' + onset.mappingId + ' · actor ' + onset.actorId);
    return svg;
  };
  const spatialGhost = (current, row) => {
    const edits = row.edits.filter(edit => edit.kind === 'right-wall-x'); if (!edits.length) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 560 160'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Selected proposed wall collision rectangles; the live world is unchanged'); svg.style.width = '100%';
    const low = Math.min(...edits.map(edit => edit.bounds.x1)) - 4, high = Math.max(...edits.map(edit => edit.bounds.x2)) + 4;
    for (const [index, edit] of edits.slice(0, 8).entries()) {
      const y = 10 + index * 18, x = 10 + (edit.value - low) / (high - low) * 540, rectangle = document.createElementNS(svg.namespaceURI, 'rect');
      for (const [key, value] of Object.entries({ x, y, width: Math.max(0, (edit.bounds.x2 - edit.value) / (high - low) * 540), height: 12, fill: 'currentColor', opacity: '.25', stroke: 'currentColor', 'stroke-dasharray': '4 3' })) rectangle.setAttribute(key, String(value));
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = edit.id + ': proposed solid cells at X≥' + edit.value + ', physical lane ' + edit.laneId + ', only inside the explicit editable rectangle'; rectangle.append(title); svg.append(rectangle);
    }
    return svg;
  };
  const candidatePicker = choice(results, 'Candidate ghost · selection does not edit the world', []); let listedRows = null;
  candidatePicker.addEventListener('change', () => select(candidatePicker.value));
  function render() {
    if (disposed) return; const current = readSource(), ownedState = readState(), state = ownedState?.study?.mode === 'comparison' ? null : ownedState;
    sourceLabel.textContent = current ? `Source tick ${current.tick}, generation ${current.generation}; ${current.actorIds.length} actors. Assistance ${current.assists ? 'on' : 'off'}; future births ${current.finiteCrew ? 'paused/exhausted' : 'active'}. Search needs a finite ordinary crew with assistance off. Sensitivity preserves adaptive policies.` : 'Open and pause a physical project.';
    exportStudy.disabled = !state?.study && !state?.partial;
    const audio = readAudition(); audition.disabled = !state?.canAudition || draftDirty || !!audio?.active || !!audio?.busy || !!audio?.checkpointHeld;
    run.disabled = !audio?.active || !!audio?.busy || audio.phase !== 'paused'; stopAudio.disabled = !audio?.active && !audio?.checkpointHeld && !audio?.busy;
    search.disabled = sensitivity.disabled = !current || !!ownedState?.busy || !!audio?.active || !!audio?.checkpointHeld; stop.disabled = !state?.busy; applyButton.disabled = !state?.canApply || draftDirty;
    if (state?.progress) message.textContent = state.progress.phase + ' · ' + (state.progress.completedUnits ?? 0) + '/' + (state.progress.totalUnits ?? '?');
    else if (state?.error) message.textContent = state.error;
    else if (state?.study) message.textContent = state.study.status + (state.stale ? ' · source changed; Apply unavailable' : state.applied ? ' · queued paused with one Undo step' : ' · source unchanged; output off');
    results.replaceChildren(); ghost.replaceChildren();
    if (!state?.study) { report.textContent = state?.partial ? JSON.stringify(state.partial, null, 2) : ''; return; }
    if (listedRows !== state.study.rows) { candidatePicker.replaceChildren(); for (const row of state.study.rows) { const option = node('option', row.id + ' · ' + row.status + (Number.isFinite(row.metrics?.score) ? ' · cost ' + row.metrics.score : '')); option.value = row.id; candidatePicker.append(option); } listedRows = state.study.rows; }
    candidatePicker.value = state.selectedId || ''; results.append(candidatePicker.parentElement || candidatePicker);
    const row = state.selected; if (row) {
      ghost.append(node('h3', 'GOAL ◯ · RESULT ●'), plot(state.study, row), node('h3', 'Selected candidate ghost · proposed changes'));
      const changes = node('ul'); for (const edit of row.edits) changes.append(node('li', edit.id + ': ' + edit.kind + ' → ' + edit.value + (edit.bounds ? ` inside [${edit.bounds.x1},${edit.bounds.x2}) × [${edit.bounds.y1},${edit.bounds.y2})` : ''))); ghost.append(changes);
      const proposed = spatialGhost(current, row); if (proposed) ghost.append(proposed);
      ghost.append(node('p', 'Reference audition replays the frozen physical candidate through the existing independent owned sine output. Prepare is silent; Run is explicit. It uses the reference realization, not the selected patch/rack. Close stops audio and returns to the untouched live source. Qualification covers only the declared study horizon.'));
      report.textContent = JSON.stringify({ source: state.study.base, sourceContinuationHash: state.study.sourceIdentity?.baseContinuationHash, patchHash: row.patchHash, mappingRevision: row.mappingRevision, constraintRevision: row.constraintRevision, audition: audio, status: row.status, reason: row.reason, metrics: row.metrics, safety: row.trace?.safetyFailures, rejectedInputs: row.trace?.rejectedInputs,
        freshVerification: row.verification || null, work: state.study.work, sensitivity: state.sensitivity ? { domain: state.sensitivity.domain, edges: state.sensitivity.edges } : null }, null, 2);
    } else report.textContent = JSON.stringify({ status: state.study.status, reason: state.study.reason, coverage: state.study.coverage, work: state.study.work }, null, 2);
  }
  setEditor('fields');
  element.append(node('h2', 'Compose with physics'), sourceLabel, node('p', 'Declare a finite goal and edit domain, then explicitly Search or Sample. Selecting a candidate shows its proposed changes. Apply queues the independently reviewed commands while preserving live actors. Play applies them at their physical boundaries; Undo restores the pre-edit world. Goal timing uses physical source ticks or an explicitly fixed seconds/beat clock. Sampled gaps remain unknown.'), drafts, controls, message, results, ghost, report);
  return Object.freeze({ element, render, hasDraft: () => draftDirty || jsonDirty, dispose() { disposed = true; element.remove(); } });
}
