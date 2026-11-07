import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';
import { createCausalPhysicalHistoryView } from './CausalPhysicalHistoryView.js';
import { decodePhysicalCounterfactualFrame } from './PhysicalCounterfactualFrame.js';
import { compilePhysicalCounterfactualRequest } from './PhysicalCounterfactual.js';
import { createPhysicalMusicStarterGoal } from './PhysicalMusicStarter.js';

export function createPhysicalCounterfactualView({ document, resourceBudget, readSource, readState, start, cancel, select, apply, discard, prepareAudition, readAudition, runAudition, stopAudition, exportReport, onDraftChange = () => {}, onStatus = () => {} } = {}) {
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-counterfactual-view', kind: 'bounded-two-branch-overlay', category: 'checkpoint', bytes: 4 * 1048576 });
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; }, element = node('section');
  element.__ownedControl = true; element.className = 'studio-counterfactual'; element.setAttribute('aria-label', 'Compare actual physical futures');
  const message = node('output'), source = node('p'), editor = node('fieldset'), controls = node('div'), review = node('section'), snapshots = node('div'), evidence = node('pre');
  message.setAttribute('role', 'status'); evidence.style.whiteSpace = 'pre-wrap'; evidence.style.overflowWrap = 'anywhere'; controls.className = 'studio-compose-controls';
  const button = (label, action) => { const value = node('button', label); value.type = 'button'; value.addEventListener('click', () => { Promise.resolve().then(action).catch(error => { message.textContent = error.message; onStatus(error.message); }); }); return value; };
  const field = (parent, label, value, type = 'number') => { const wrap = node('label', label), input = node('input'); input.type = type; input.value = value; input.setAttribute('aria-label', label); if (type === 'number') input.step = '1'; wrap.append(input); parent.append(wrap); return input; };
  const choice = (parent, label, choices) => { const wrap = node('label', label), input = node('select'); input.setAttribute('aria-label', label); for (const [value, title] of choices) { const option = node('option', title); option.value = value; input.append(option); } wrap.append(input); parent.append(wrap); return input; };
  const current = readSource(), kind = choice(editor, 'Proposed physical change', [['right-wall-x', 'Right wall X'], ['pickup-x', 'Vertical pickup X'], ['worker-tick', 'Shared skill tick'], ['none', 'No edit · compare identical futures']]),
    value = field(editor, 'Proposed integer value', 82), lane = field(editor, 'Physical lane index', 0), x1 = field(editor, 'Editable rectangle left', 78), x2 = field(editor, 'Editable rectangle right', 85), y1 = field(editor, 'Editable rectangle top', 65), y2 = field(editor, 'Editable rectangle bottom', 80),
    pickup = field(editor, 'Pickup ID', 'entry0', 'text'), actor = field(editor, 'Source actor ID', current?.actorIds?.[0] ?? 0), skill = choice(editor, 'Shared skill', [['builder', 'Builder'], ['basher', 'Basher'], ['digger', 'Digger'], ['miner', 'Miner']]), horizon = field(editor, 'Compared physical horizon in ticks', 480);
  editor.prepend(node('legend', 'One concrete proposal · all remaining source state stays locked'));
  const advanced = node('details'), json = node('textarea'); json.rows = 18; json.setAttribute('aria-label', 'Complete physical comparison request JSON'); json.style.width = '100%'; advanced.append(node('summary', 'Exact proposal, protected regions and budgets'), json);
  const jsonMode = field(editor, 'Use complete request JSON', '', 'checkbox'); jsonMode.checked = false;
  let dirty = false, disposed = false, resultId = null, selectedDifference = -1, revision = 0, frameKey = null, image = null;
  const number = input => { const result = Number(input.value); if (!input.value.trim() || !Number.isSafeInteger(result)) throw new Error('Enter an integer for ' + input.getAttribute('aria-label') + '.'); return result; };
  const makeRequest = () => {
    if (jsonMode.checked) { const request = JSON.parse(json.value); compilePhysicalCounterfactualRequest(request); return request; }
    const live = readSource(); if (!live) throw new Error('Open a paused physical score first.');
    const starter = createPhysicalMusicStarterGoal(), isStarter = live.graph.instruments.some(item => item.id === 'voice0') && live.graph.instruments.some(item => item.id === 'voice1') && live.height === 192;
    const edit = { id: 'reviewed-change', kind: kind.value, values: [number(value)] };
    if (kind.value === 'right-wall-x') Object.assign(edit, { laneId: number(lane), bounds: { x1: number(x1), x2: number(x2), y1: number(y1), y2: number(y2) } });
    else if (kind.value === 'pickup-x') edit.pickupId = pickup.value.trim();
    else if (kind.value === 'worker-tick') Object.assign(edit, { actorId: number(actor), skillType: skill.value });
    const ticks = number(horizon), request = { schema: 'lemmings-physical-counterfactual/v1', id: 'physical-counterfactual', revision: ++revision, proposedEdits: kind.value === 'none' ? [] : [edit], horizonTicks: ticks,
      crewConstraints: isStarter ? starter.crewConstraints : { requireAllSurvive: true, maximumActors: 64, containment: { x1: live.leftEdgeX, x2: live.width, y1: 0, y2: live.height }, protectedRegions: [] },
      skillInventory: { builder: 0, basher: 0, digger: 0, miner: 0, ...(kind.value === 'worker-tick' ? { [skill.value]: 1 } : {}) },
      budgets: { logicalTicks: ticks * 2, maximumOnsets: 2048, maximumFacts: 65536 }, comparisonPolicy: { alignment: 'fixed-origin', maximumPairs: 2048 } };
    compilePhysicalCounterfactualRequest(request); return request;
  };
  const stage = () => { const request = makeRequest(); if (!jsonMode.checked) json.value = JSON.stringify(request, null, 2); dirty = false; return start(request); };
  const compare = button('Evaluate original A and proposed B', stage), stop = button('Cancel comparison · keep draft', cancel),
    applyButton = button('Apply reviewed B commands · one Undo step', () => { if (dirty) throw new Error('Evaluate the changed proposal before Apply.'); return apply(); }),
    discardButton = button('Discard comparison · stop private audio', async () => { await discard(); render(); }),
    exportButton = button('Export actual comparison report', exportReport);
  controls.append(compare, stop, applyButton, discardButton, exportButton);
  for (const input of editor.querySelectorAll('input,select')) input.addEventListener('input', () => { dirty = true; applyButton.disabled = true; onDraftChange(); });
  json.addEventListener('input', () => { jsonMode.checked = true; dirty = true; applyButton.disabled = true; onDraftChange(); });
  const presentation = choice(review, 'Captured frame presentation', [['overlay', 'A/B overlay · common viewport'], ['side', 'A/B side by side · identical scale']]),
    alignment = choice(review, 'Comparison time alignment', [['fixed-origin', 'Fixed source origin'], ['phrase-aligned', 'Phrase alignment · view offset only']]),
    cursor = field(review, 'Read-only comparison cursor in physical ticks', 0, 'range'), cursorLabel = node('p'), differenceLabel = node('p'), differences = node('ol'), metrics = node('div');
  cursor.min = '0'; cursor.max = '480'; cursor.step = '1';
  const branch = choice(review, 'Private reference audition branch', [['A', 'A original'], ['B', 'B proposed']]);
  const prepare = button('Prepare chosen A/B reference · silent', async () => {
      const state = readState(), comparison = state?.comparison, chosen = comparison?.branches.find(item => item.id === branch.value);
      if (!comparison || dirty || state.stale || !chosen) throw new Error('Evaluate this unchanged proposal before audition.');
      const audio = readAudition(); if (audio?.active || audio?.busy || audio?.checkpointHeld) await stopAudition();
      select(chosen.candidateId); return prepareAudition();
    }), run = button('Run prepared reference audition', runAudition), close = button('Close reference audition', stopAudition);
  review.append(prepare, run, close);
  const overlay = node('figure'), canvas = node('canvas'), caption = node('figcaption'), actorLabels = node('ol'), side = node('div'); side.className = 'studio-counterfactual-side';
  canvas.width = canvas.height = 128; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Actual original A and proposed B collision and actor overlay'); canvas.style.width = '100%'; canvas.style.maxWidth = '640px'; canvas.style.imageRendering = 'pixelated'; overlay.append(canvas, caption, actorLabels); snapshots.append(overlay, side);
  let context, aView, bView;
  try { context = canvas.getContext('2d'); if (!context) throw new Error('The physical comparison canvas is unavailable.'); aView = createCausalPhysicalHistoryView({ document, resourceBudget, label: 'A original actual captured frame' }); bView = createCausalPhysicalHistoryView({ document, resourceBudget, label: 'B proposed actual captured frame' }); side.append(aView.element, bView.element); }
  catch (error) { aView?.dispose(); bView?.dispose(); storage.release(); throw error; }
  const frameAt = (frames, tick) => frames.findLast(frame => frame.relativeTick <= tick) || frames[0] || null;
  const renderFrames = result => {
    const tick = Number(cursor.value), shift = alignment.value === 'phrase-aligned' ? result.phraseAlignment.shiftBTicks : 0,
      frames = result.branches.map((item, index) => frameAt(item.frames, tick - (index ? shift : 0))),
      projections = frames.map((frame, index) => frame ? { ...decodePhysicalCounterfactualFrame(frame), presentationKey: result.comparisonId + ':' + (index ? 'B' : 'A') } : null);
    cursorLabel.textContent = 'Requested view tick ' + tick + ' · actual A ' + (frames[0]?.relativeTick ?? 'unavailable') + ' · actual B ' + (frames[1]?.relativeTick ?? 'unavailable') + '. ' + (alignment.value === 'phrase-aligned' ? 'B view shift ' + shift + ' ticks; source times and audition remain fixed-origin. ' + result.phraseAlignment.status : 'Same fixed source origin.') + ' Captured boundaries only; moving this cursor does not run physics.';
    side.hidden = presentation.value !== 'side'; overlay.hidden = !side.hidden;
    if (!side.hidden) { aView.render(projections[0]); bView.render(projections[1]); return; }
    const key = [result.comparisonId, frames[0]?.relativeTick, frames[1]?.relativeTick].join(':'); if (frameKey === key) return; frameKey = key;
    const [a, b] = projections;
    if (!a || !b || JSON.stringify(a.viewport) !== JSON.stringify(b.viewport)) { caption.textContent = 'A common actual viewport is unavailable; use the separate captured frames. No projection is inferred.'; context.clearRect(0, 0, 128, 128); actorLabels.replaceChildren(); return; }
    const view = a.viewport; canvas.width = view.pixelWidth; canvas.height = view.pixelHeight; image = context.createImageData(canvas.width, canvas.height);
    const colors = { unknown: [90, 78, 100], steel: [234, 203, 134], solid: [93, 129, 145], empty: [14, 17, 25], a: [70, 206, 235], b: [239, 164, 70] };
    for (let index = 0; index < a.cells.length; index++) {
      const left = a.cells[index], right = b.cells[index], color = left === 3 || right === 3 ? colors.unknown : left === right ? left === 2 ? colors.steel : left === 1 ? colors.solid : colors.empty : left ? colors.a : colors.b;
      const offset = index * 4; image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0); context.font = '7px monospace'; actorLabels.replaceChildren();
    for (const [index, projection] of projections.entries()) for (const mark of projection.actors) {
      const label = (index ? 'B' : 'A') + '#' + mark.actorId, x = (mark.x - view.x) / view.width * canvas.width, y = (mark.y - view.y) / view.height * canvas.height;
      context.fillStyle = index ? '#efa446' : '#46ceeb'; context.fillRect(x - 1, y - 3, 3, 4); context.fillText(label, x + 3, y - (index ? 0 : 5));
      const item = node('li', label + ' · lane ' + mark.laneId + ' · ' + mark.action + ' · (' + mark.x + ', ' + mark.y + ')'); actorLabels.append(item);
    }
    caption.textContent = 'Common collision samples are gray; A-only solid cyan; B-only solid amber; unknown samples purple. Text A/B and actor IDs identify branches independently of color. Actual ticks A ' + frames[0].relativeTick + ', B ' + frames[1].relativeTick + '. Visible actors A ' + a.visibleActors + ', B ' + b.visibleActors + '; omitted marks A ' + a.omittedActors + ', B ' + b.omittedActors + '.';
    canvas.setAttribute('aria-description', caption.textContent);
  };
  branch.addEventListener('change', () => { const candidate = readState()?.comparison?.branches.find(item => item.id === branch.value); if (candidate) select(candidate.candidateId); });
  let retainedDifferences = [];
  const moveDifference = delta => { if (!retainedDifferences.length) return; selectedDifference = (selectedDifference + delta + retainedDifferences.length) % retainedDifferences.length; const item = retainedDifferences[selectedDifference]; cursor.value = String(Math.max(0, Math.min(Number(cursor.max), Math.min(item.aTick, item.bTick)))); render(); };
  review.append(button('Previous retained difference', () => moveDifference(-1)), button('Next retained difference', () => moveDifference(1)), cursorLabel, differenceLabel, snapshots, differences, metrics);
  for (const input of [cursor, presentation, alignment]) input.addEventListener('input', () => render());
  function render() {
    if (disposed) return; const live = readSource(), owner = readState(), state = owner?.study?.mode === 'comparison' ? owner : null, result = state?.comparison, audio = readAudition();
    source.textContent = live ? 'Live source tick ' + live.tick + ' · generation ' + live.generation + ' · ' + live.actorIds.length + ' actors. Compare needs assistance off and a finite ordinary crew.' : 'Open a physical score.';
    compare.disabled = !live || !!owner?.busy || !!audio?.active || !!audio?.checkpointHeld; stop.disabled = !owner?.busy; applyButton.disabled = !state?.canApply || dirty; discardButton.disabled = !state && !owner?.busy; exportButton.disabled = !result;
    prepare.disabled = !result || dirty || state.stale || state.applied || !!owner?.busy || !!audio?.busy; run.disabled = !audio?.active || !!audio?.busy || audio.phase !== 'paused'; close.disabled = !audio?.active && !audio?.checkpointHeld && !audio?.busy;
    if (owner?.progress) message.textContent = owner.progress.phase + ' · ' + (owner.progress.completed ?? 0) + '/' + (owner.progress.total ?? '?');
    else if (state?.error) message.textContent = state.error;
    else if (state) message.textContent = state.study.status + (state.stale ? ' · source changed; retained comparison is read-only' : state.applied ? ' · reviewed commands queued paused with Undo' : ' · live source unchanged; no audio prepared automatically');
    review.hidden = !result;
    if (!result) { evidence.textContent = state?.partial ? JSON.stringify(state.partial, null, 2) : ''; return; }
    if (resultId !== result.comparisonId) {
      resultId = result.comparisonId; branch.value = result.branches.find(item => item.candidateId === state.selectedId)?.id || 'B'; frameKey = null; cursor.value = '0'; cursor.max = String(state.study.goal.horizon); selectedDifference = -1;
      retainedDifferences = result.correspondence.causes.matches.filter(match => match.deltaTicks || JSON.stringify(match.a.position) !== JSON.stringify(match.b.position)).sort((a, b) => Math.min(a.aTick, a.bTick) - Math.min(b.aTick, b.bTick));
      differences.replaceChildren(...retainedDifferences.slice(0, 64).map(match => node('li', match.a.kind + ' · actor ' + match.a.actorId + ' · A tick ' + match.aTick + ' → B ' + match.bTick + ' · Δ ' + match.deltaTicks + ' ticks')));
      metrics.replaceChildren(node('h3', 'Observed onset periods · actual intervals in ticks'), ...result.observedPeriods.groups.map(group => node('p', 'Actor ' + group.actorId + ' · ' + group.mappingId + ': A ' + (group.a.meanTicks ?? 'unobserved') + ', B ' + (group.b?.meanTicks ?? 'unmatched') + ', Δ ' + (group.deltaMeanTicks ?? 'unknown') + '. A observations ' + group.a.observations + ', B ' + (group.b?.observations ?? 0) + '.')));
    }
    differenceLabel.textContent = (result.emptyDifference ? 'No difference in the complete retained causal trace. ' : '') + 'Typed cause correspondence: ' + result.correspondence.causes.matchedCount + ' matched, ' + result.correspondence.causes.missingCount + ' A-only, ' + result.correspondence.causes.addedCount + ' B-only. ' + result.firstDifferenceCoverage + '. Showing up to64 changed pairs; cursor navigation covers all retained pairs. Initial actors correspond by source identity; future IDs stay branch-qualified.';
    renderFrames(result);
    evidence.textContent = JSON.stringify({ comparisonId: result.comparisonId, source: result.base, branches: result.branches.map(({ frames, ...rest }) => ({ ...rest, actualFrameCount: frames.length })), firstDownstreamDifference: result.firstDownstreamDifference,
      firstMusicalDifference: result.firstMusicalDifference, unmatchedOnsets: { aOnly: result.correspondence.onsets.missing, bOnly: result.correspondence.onsets.added }, displacement: result.displacement,
      displacementScope: 'Accumulated declared motion endpoint displacement; separate from observed onset period and not an inferred curved path length.', observedPeriodScope: result.observedPeriods.scope, work: result.work, coverage: result.coverage, audio }, null, 2);
  }
  element.append(node('h2', 'Compare physical futures'), source, node('p', 'Evaluate unchanged A and one concrete B from the same paused source. Captured frames, actual causes and onset intervals share a read-only cursor. Apply queues reviewed commands in the live world; preview actors are never copied. Qualification covers only the declared horizon.'), editor, advanced, controls, message, review, evidence);
  return Object.freeze({ element, render, hasDraft: () => dirty, dispose() { if (disposed) return false; disposed = true; aView.dispose(); bView.dispose(); image = null; canvas.width = canvas.height = 0; element.remove(); return storage.release(); } });
}
