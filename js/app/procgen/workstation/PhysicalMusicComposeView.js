import { validatePhysicalMusicGoal } from './PhysicalMusicGoal.js';

export function createPhysicalMusicComposeView({ document, readSource, readState, start, cancel, select, apply, onStatus = () => {} } = {}) {
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
  const handles = node('fieldset'); handles.append(node('legend', 'Finite physical handles · all other terrain and crew stay locked'));
  const kind = choice(handles, 'Physical handle kind', [['right-wall-x', 'Right wall X'], ['pickup-x', 'Vertical pickup X'], ['worker-tick', 'Shared skill application tick']]),
    handleId = field(handles, 'Handle ID', 'wall0', 'text'), values = field(handles, 'Allowed integer values · comma separated', '80,81,82', 'text'),
    laneId = field(handles, 'Physical lane index', 0), x1 = field(handles, 'Editable rectangle left', 80), x2 = field(handles, 'Editable rectangle right', 83),
    y1 = field(handles, 'Editable rectangle top', 65), y2 = field(handles, 'Editable rectangle bottom', 80),
    pickupId = field(handles, 'Pickup ID', 'entry0', 'text'), actorId = field(handles, 'Source actor ID', source?.actorIds?.[0] ?? 0),
    skill = choice(handles, 'Shared skill', [['builder', 'Builder'], ['basher', 'Basher'], ['digger', 'Digger'], ['miner', 'Miner']]);
  const editList = node('ol'), inventory = node('fieldset'); inventory.append(node('legend', 'Joint skill inventory'));
  const skillFields = Object.fromEntries(['builder', 'basher', 'digger', 'miner'].map(name => [name, field(inventory, name + ' uses', 0)]));
  const advanced = node('details'); advanced.append(node('summary', 'Complete goal · ratios, protection and exact selectors'));
  const json = node('textarea'); json.rows = 18; json.setAttribute('aria-label', 'Complete physical music goal JSON'); json.style.width = '100%'; advanced.append(json);
  let edits = [], goal = null, draftDirty = false, jsonDirty = false, jsonAuthority = false, disposed = false;
  const numbers = input => { if (!input.value.trim()) return []; const list = input.value.split(',').map(value => { if (!value.trim()) throw new Error('Every comma separated value needs a number.'); return Number(value.trim()); }); if (list.some(value => !Number.isFinite(value))) throw new Error('Use finite numeric values.'); return list; };
  const numeric = input => { if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new Error('Enter a finite value for ' + input.getAttribute('aria-label') + '.'); return Number(input.value); };
  const renderEdits = () => { editList.replaceChildren(); for (const edit of edits) { const row = node('li', edit.id + ' · ' + edit.kind + ' · [' + edit.values.join(', ') + '] '); row.append(button('Remove ' + edit.id, () => { edits = edits.filter(value => value !== edit); draftDirty = true; renderEdits(); })); editList.append(row); } };
  handles.append(button('Add finite handle', () => {
    const id = handleId.value.trim(), common = { id, kind: kind.value, values: numbers(values) };
    const edit = kind.value === 'right-wall-x' ? { ...common, laneId: numeric(laneId), bounds: { x1: numeric(x1), x2: numeric(x2), y1: numeric(y1), y2: numeric(y2) } } :
      kind.value === 'pickup-x' ? { ...common, pickupId: pickupId.value.trim() } : { ...common, actorId: numeric(actorId), skillType: skill.value };
    if (edits.some(value => value.id === id)) throw new Error('Choose a distinct physical handle ID.'); edits.push(edit); draftDirty = true; renderEdits();
  }), editList);
  const build = () => {
    if (jsonAuthority) return validatePhysicalMusicGoal(JSON.parse(json.value));
    const current = readSource(); if (!current) throw new Error('Open a physical project first.');
    const selected = mapping.value.trim(), target = numbers(attacks), value = numeric(period);
    return validatePhysicalMusicGoal({ schema: 'lemmings-physical-music-goal/v1', id: 'compose-goal', revision: (goal?.revision || 0) + 1, timeDomain: units.value,
      ...(units.value === 'ticks' ? {} : { referenceTimeline: { tickDurationMs: numeric(tickMs), ...(units.value === 'beats' ? { tempoBpm: numeric(bpm) } : {}) } }),
      targetOnsets: target.map(time => ({ time, tolerance: numeric(tolerance), ...(selected ? { mappingId: selected } : {}) })),
      periodGoals: value > 0 ? [{ selector: { mappingId: selected }, period: value, tolerance: numeric(tolerance) }] : [], periodRatios: [],
      requiredCauseKinds: [], forbiddenCauses: [], allowedEdits: edits,
      crewConstraints: { requireAllSurvive: true, maximumActors: 64, containment: { x1: current.leftEdgeX, x2: current.width, y1: 0, y2: current.height }, protectedRegions: [] },
      skillInventory: Object.fromEntries(Object.entries(skillFields).map(([name, input]) => [name, numeric(input)])), horizon: numeric(horizon),
      budgets: { maximumCandidates: numeric(candidates), logicalTicks: numeric(logicalTicks), maximumOnsets: 2048, maximumFacts: 65536, finalists: 1 } });
  };
  const stage = mode => { goal = build(); json.value = JSON.stringify(goal, null, 2); draftDirty = false; jsonDirty = false; return start({ goal, mode }); };
  const search = button('Search physical candidates', () => stage('search')), sensitivity = button('Sample musical sensitivity', () => stage('sensitivity')),
    stop = button('Cancel study · keep draft', cancel), applyButton = button('Apply verified candidate · one undo step', () => { if (draftDirty) throw new Error('The goal draft changed; Search again before Apply.'); return apply(); });
  controls.append(search, sensitivity, stop, applyButton);
  drafts.append(basic, handles, inventory, button('Copy fields to complete goal', () => { jsonDirty = false; jsonAuthority = false; goal = build(); json.value = JSON.stringify(goal, null, 2); draftDirty = false; advanced.open = true; }), advanced);
  for (const input of drafts.querySelectorAll('input,select')) input.addEventListener('input', () => { draftDirty = true; jsonAuthority = false; applyButton.disabled = true; });
  json.addEventListener('input', () => { jsonDirty = true; jsonAuthority = true; draftDirty = true; applyButton.disabled = true; });
  const plot = (study, row) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 560 150'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Hollow GOAL onsets and filled actual RESULT onsets in physical ticks'); svg.style.width = '100%';
    const mark = (tag, attrs, label) => { const value = document.createElementNS(svg.namespaceURI, tag); for (const [key, entry] of Object.entries(attrs)) value.setAttribute(key, entry); const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = label; value.append(title); svg.append(value); };
    const scale = study.goal.timeDomain === 'ticks' ? 1 : study.goal.timeDomain === 'seconds' ? 1000 / study.goal.referenceTimeline.tickDurationMs : 60000 / study.goal.referenceTimeline.tempoBpm / study.goal.referenceTimeline.tickDurationMs;
    for (const target of study.goal.targetOnsets) mark('circle', { cx: 10 + target.time * scale / study.goal.horizon * 540, cy: 40, r: 5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }, 'GOAL ' + target.time + ' ' + study.goal.timeDomain);
    for (const onset of row.trace?.onsets || []) mark('circle', { cx: 10 + onset.timeTicks / study.goal.horizon * 540, cy: 95 + (onset.laneId % 3) * 12, r: 3, fill: 'currentColor' }, 'RESULT tick ' + onset.timeTicks + ' · ' + onset.mappingId + ' · actor ' + onset.actorId);
    return svg;
  };
  function render() {
    if (disposed) return; const current = readSource(), state = readState();
    sourceLabel.textContent = current ? `Source tick ${current.tick}, generation ${current.generation}; ${current.actorIds.length} actors. Assistance ${current.assists ? 'on' : 'off'}; future births ${current.finiteCrew ? 'paused/exhausted' : 'active'}. Search needs a finite ordinary crew with assistance off. Sensitivity preserves adaptive policies.` : 'Open and pause a physical project.';
    search.disabled = sensitivity.disabled = !current || !!state?.busy; stop.disabled = !state?.busy; applyButton.disabled = !state?.canApply || draftDirty;
    if (state?.progress) message.textContent = state.progress.phase + ' · ' + (state.progress.completed ?? 0) + '/' + (state.progress.total ?? '?');
    else if (state?.error) message.textContent = state.error;
    else if (state?.study) message.textContent = state.study.status + (state.stale ? ' · source changed; Apply unavailable' : state.applied ? ' · applied paused with undo' : ' · source unchanged; output off');
    results.replaceChildren(); ghost.replaceChildren();
    if (!state?.study) return;
    const picker = choice(results, 'Candidate ghost · selection does not edit the world', state.study.rows.map(row => [row.id, row.id + ' · ' + row.status + (row.metrics ? ' · cost ' + row.metrics.score : '')]));
    picker.value = state.selectedId || ''; picker.addEventListener('change', () => { select(picker.value); render(); });
    const row = state.selected; if (row) {
      ghost.append(node('h3', 'GOAL ◯ · RESULT ●'), plot(state.study, row), node('h3', 'Selected candidate ghost · proposed changes'));
      const changes = node('ul'); for (const edit of row.edits) changes.append(node('li', edit.id + ': ' + edit.kind + ' → ' + edit.value + (edit.bounds ? ` inside [${edit.bounds.x1},${edit.bounds.x2}) × [${edit.bounds.y1},${edit.bounds.y2})` : ''))); ghost.append(changes);
      report.textContent = JSON.stringify({ status: row.status, reason: row.reason, metrics: row.metrics, safety: row.trace?.safetyFailures, rejectedInputs: row.trace?.rejectedInputs,
        freshVerification: row.verification || null, work: state.study.work, sensitivity: state.sensitivity ? { domain: state.sensitivity.domain, edges: state.sensitivity.edges } : null }, null, 2);
    }
  }
  element.append(node('h2', 'Compose with physics'), sourceLabel, node('p', 'Declare a finite goal and edit domain, then explicitly Search or Sample. Selecting a candidate shows its proposed changes. Apply publishes the independently replayed first boundary paused; Undo restores the previous world. Goal timing uses physical source ticks or an explicitly fixed seconds/beat clock. Sampled gaps remain unknown.'), drafts, controls, message, results, ghost, report);
  return Object.freeze({ element, render, hasDraft: () => draftDirty || jsonDirty, dispose() { disposed = true; element.remove(); } });
}
