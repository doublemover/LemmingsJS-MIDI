import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

let nextView = 0;
export function createPhysicalMappingEditorView({ document, owner, displayScheduler, resourceBudget, readRuntimeValues = () => [], onStatus = () => {} } = {}) {
  if (!document?.createElement || !owner?.state || !displayScheduler?.register) throw new TypeError('Mapping controls need their physical source owner and shared display scheduler.');
  const id = 'physical-mapping-editor-' + (++nextView), listeners = [], scope = createProcgenRetirementScope();
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: id, kind: 'paged-typed-mapping-dialog', category: 'graphics', bytes: 2 * 1048576 });
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const listen = (target, event, callback) => { target.addEventListener(event, callback); listeners.push(() => target.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-physical-mappings'; dialog.setAttribute('aria-labelledby', id + '-title');
  const title = node('h2', 'Physical source → parameter'); title.id = id + '-title';
  const status = node('output'); status.setAttribute('role', 'status');
  const help = node('p', 'Edit typed bindings for this exact instrument. Apply saves an immutable revision through the normal sound transaction. Curve previews and source Learn produce no notes. Held voices keep their original patch.');
  const search = node('input'); search.type = 'search'; search.maxLength = 160; search.setAttribute('aria-label', 'Filter physical mappings');
  const choices = node('select'); choices.size = 8; choices.setAttribute('aria-label', 'Physical mappings · 32 per page');
  const previous = node('button', 'Previous'), more = node('button', 'More'), add = node('button', 'Add mapping'), remove = node('button', 'Remove selected mapping');
  for (const button of [previous, more, add, remove]) button.type = 'button';
  const navigation = node('div'); navigation.append(search, choices, previous, more, add, remove);
  const form = node('fieldset'), legend = node('legend', 'Selected mapping'); form.append(legend);
  const controls = {}, fields = ['source', 'target', 'mode', 'curve', 'composition'];
  for (const field of fields) { const label = node('label', field + ' '), select = node('select'); select.setAttribute('aria-label', 'Mapping ' + field); label.append(select); form.append(label); controls[field] = select; }
  const numericFields = [['inputMin', -1e9, 1e9], ['inputMax', -1e9, 1e9], ['outputMin', -1e6, 1e6], ['outputMax', -1e6, 1e6], ['deadZone01', 0, 0.49], ['smoothingMs', 0, 60000]];
  for (const [field, min, max] of numericFields) { const label = node('label', field + ' '), input = node('input');
    input.type = 'number'; input.step = 'any'; input.min = String(min); input.max = String(max); input.setAttribute('aria-label', 'Mapping ' + field);
    label.append(input); form.append(label); controls[field] = input; }
  const enabled = node('input'); enabled.type = 'checkbox'; const enabledLabel = node('label', 'Enabled · reversible A/B '); enabledLabel.append(enabled);
  const unit = node('p'), scopeInfo = node('p'), range = node('button', 'Keep this authored input range'); range.type = 'button';
  const learn = node('button', 'Learn next eligible physical source'), cancel = node('button', 'Cancel Learn'), accept = node('button', 'Accept observed source'), keep = node('button', 'Keep listening');
  for (const button of [learn, cancel, accept, keep]) button.type = 'button';
  const actor = node('input'); actor.type = 'number'; actor.min = '0'; actor.step = '1'; actor.placeholder = 'Any eligible actor'; actor.setAttribute('aria-label', 'Optional exact actor filter');
  const actorScoped = node('input'); actorScoped.type = 'checkbox'; actorScoped.checked = true;
  const actorScopeLabel = node('label', 'Bind learned source to its exact actor/world/generation '); actorScopeLabel.append(actorScoped);
  const learning = node('p'), observation = node('p'), preview = node('p'), runtime = node('p');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 320 120'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Hypothetical source-to-contribution curve; the same transform used by the engine');
  const line = document.createElementNS(svg.namespaceURI, 'polyline'); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '2'); svg.append(line);
  const neutralScope = node('button', 'Use causal voice-owner scope'); neutralScope.type = 'button';
  form.append(enabledLabel, unit, scopeInfo, neutralScope, range, node('p', 'Dead zone uses normalized input around its center. Input clamps to the authored range. Smoothing is an owned continuous-control slew; onset-only mappings use zero smoothing.'),
    actor, actorScopeLabel, learn, cancel, accept, keep, learning, observation, svg, preview, runtime);
  const apply = node('button', 'Apply mapping revision'), reset = node('button', 'Discard draft changes'), close = node('button', 'Close');
  for (const button of [apply, reset, close]) button.type = 'button';
  const actions = node('div'); actions.append(apply, reset, close);
  dialog.append(title, help, status, navigation, form, actions); document.body.append(dialog);
  let disposed = false, selectedId = null, page = 0, catalogKey = null, renderedSerial = -1, renderedSearch = null, rows = [], previousFocus = null, rowSerial = 0;
  const invalid = () => form.querySelector('[aria-invalid="true"]') !== null;
  const say = value => { status.textContent = value; try { onStatus(value); } catch {} };
  const currentBinding = () => owner.state().bindings.find(value => value.id === selectedId);
  const change = patch => { const state = owner.state(); if (!selectedId) return;
    try { owner.edit(state.bindings.map(binding => binding.id === selectedId ? { ...binding, ...patch } : binding)); renderedSerial = -1; surface.invalidate(); }
    catch (error) { say(error.message); } };
  const option = (value, label, disabled = false) => { const item = node('option', label); item.value = value; item.disabled = disabled; return item; };
  const render = () => {
    if (disposed || !dialog.open) return;
    const state = owner.state(), binding = state.bindings.find(value => value.id === selectedId);
    title.textContent = 'Physical mappings · ' + (state.laneName || state.laneId || 'selected lane');
    status.textContent = state.error || (state.current ? state.phase + ' · changes remain a draft until Apply' : state.phase === 'committed' ? 'Mapping revision committed.' : 'The original target changed. Close and reopen to inspect its new revision.');
    const nextCatalogKey = state.definitionHash + ':' + state.parameterSchemaHash;
    if (catalogKey !== nextCatalogKey) {
      catalogKey = nextCatalogKey; controls.source.replaceChildren(); controls.target.replaceChildren();
      for (const group of ['actor', 'action', 'contact']) { const parent = node('optgroup'); parent.label = group;
        for (const source of state.quantities.filter(value => value.group === group)) parent.append(option(source.id, source.payloadField + ' · ' + source.unit + ' · ' + source.sourceKind));
        controls.source.append(parent); }
      for (const group of ['spacing', 'field']) { const parent = node('optgroup'); parent.label = group; parent.append(option(group + ':unavailable', 'No admitted typed ' + group + ' source adapter for this patch', true)); controls.source.append(parent); }
      for (const parameter of state.parameters) controls.target.append(option(parameter.id, parameter.id + ' · ' + parameter.unit + ' · [' + parameter.min + ', ' + parameter.max + ']' +
        (parameter.discrete ? ' · discrete target unavailable' : parameter.causalLiveSafe ? ' · onset/continuous' : ' · onset only'), parameter.discrete === true));
      for (const [field, values] of [['mode', ['onset-only', 'continuous']], ['curve', ['linear', 'logarithmic', 'step']], ['composition', ['replace', 'add', 'scale']]]) controls[field].replaceChildren(...values.map(value => option(value, value)));
    }
    const query = search.value.toLowerCase();
    if (renderedSerial !== state.serial || renderedSearch !== query) {
      rows = state.bindings.filter(value => [value.id, value.sourceKind, value.payloadField, value.target, value.unit].join(' ').toLowerCase().includes(query)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      page = Math.min(page, Math.max(0, Math.ceil(rows.length / 32) - 1)); choices.replaceChildren(...rows.slice(page * 32, page * 32 + 32).map(value =>
        option(value.id, (value.enabled === false ? 'OFF · ' : '') + value.id + ' · ' + value.payloadField + ' → ' + value.target)));
      choices.value = selectedId || ''; renderedSerial = state.serial; renderedSearch = query;
    }
    previous.disabled = page === 0; more.disabled = (page + 1) * 32 >= rows.length;
    const ready = state.current && state.phase === 'ready'; add.disabled = !ready || state.bindings.length >= 64; remove.disabled = !ready || !binding;
    form.disabled = !ready || !binding; apply.disabled = !ready || invalid() || state.rangeReview.length > 0; reset.disabled = !ready;
    if (!binding) { legend.textContent = 'Select or add a mapping'; return; }
    legend.textContent = binding.id;
    const parameter = state.parameters.find(value => value.id === binding.target);
    for (const [name, control] of Object.entries(controls)) {
      if (document.activeElement === control || control.hasAttribute('aria-invalid')) continue;
      const value = name === 'source' ? binding.sourceKind + '.' + binding.payloadField : name === 'deadZone01' ? binding.deadZone01 ?? 0 : binding[name];
      if (control.tagName === 'SELECT' && ![...control.options].some(item => item.value === String(value))) control.append(option(String(value), 'Unavailable saved value: ' + value, true));
      control.value = String(value ?? '');
    }
    controls.mode.querySelector('option[value="continuous"]').disabled = parameter?.causalLiveSafe !== true;
    enabled.checked = binding.enabled !== false; controls.smoothingMs.disabled = binding.mode !== 'continuous';
    unit.textContent = 'Input: ' + binding.unit + ' · contribution: ' + binding.outputUnit + ' · target: ' + (parameter?.unit || 'unavailable') + '. Scalar engine parameters are distinct from legacy velocity/gate automation.';
    scopeInfo.textContent = binding.sourceScope?.kind === 'actor' ? 'Exact actor ' + binding.sourceScope.actorId + ' · world ' + binding.sourceScope.worldId + ' · generation ' + binding.sourceScope.generation + '. Missing owners remain inactive.' : 'Scope: each causal voice owns its actor observation. No visible-lane index is substituted for actor identity.';
    range.hidden = !state.rangeReview.includes(binding.id);
    const learned = state.learning; cancel.disabled = !learned; keep.disabled = !learned?.candidate; accept.disabled = !learned?.candidate || actorScoped.checked && !Number.isSafeInteger(learned.candidate.actorId);
    learn.disabled = !ready || !!learned; actor.disabled = !!learned;
    learning.textContent = learned ? (learned.candidate ? 'Review candidate ' + learned.candidate.eventId + ' from actor ' + learned.candidate.actorId : 'Listening for ' + learned.quantityId + ' in this named lane/actor scope') +
      ' · observed ' + learned.observations + ' · min/max ' + learned.minimum + '/' + learned.maximum + ' · observed window only; global range is not calibrated.' : 'Learn is not armed. Unrelated MIDI and other lanes cannot select a physical source.';
    const detail = owner.inspect(binding.id);
    if (!detail?.valid) { preview.textContent = detail?.reason || 'The mapping target is unavailable.'; line.setAttribute('points', ''); observation.textContent = ''; runtime.textContent = ''; apply.disabled = true; return; }
    const low = Math.min(binding.outputMin, binding.outputMax), span = Math.max(1e-12, Math.abs(binding.outputMax - binding.outputMin));
    line.setAttribute('points', detail.curve.map((point, index) => (10 + index / 64 * 300).toFixed(2) + ',' + (105 - (point.output - low) / span * 90).toFixed(2)).join(' '));
    observation.textContent = detail.source ? 'Observed completed physical fact · ' + detail.source.value + ' ' + detail.source.unit + ' · actor ' + detail.source.actorId + ' · tick ' + detail.source.tick +
      ' · event ' + detail.source.eventId + (detail.source.terminated ? ' · actor subsequently ended' : '') : 'No qualified source sample is available; absence is not zero.';
    preview.textContent = 'Hypothetical curve: input [' + binding.inputMin + ', ' + binding.inputMax + '] ' + binding.unit + ' → contribution [' + binding.outputMin + ', ' + binding.outputMax + '] ' + binding.outputUnit +
      '. Canonical base ' + detail.baseValue + '; hypothetical final target ' + detail.hypotheticalEffectiveValue + '. Order: ' + detail.compositionOrder +
      '. Contributions: ' + (detail.contributions.map(value => (value.bindingId || value.macroId || value.origin) + ' → ' + value.requestedValue + (value.clamped ? ' (clamped)' : '')).join('; ') || 'none') +
      '. Current authored macro values include accepted manual/MIDI pickup edits; historical automation is not synthesized for this preview. No musical command was sent.';
    const actual = readRuntimeValues(binding.target);
    runtime.textContent = actual.length ? 'Current owner host models: ' + actual.slice(0, 16).map(value => value.voiceId + ' · ' + value.patchId + '@' + value.revision + ' = ' + value.value + ' ' + detail.unit + ' · target frame ' + value.targetFrame + ' (' + value.evidence + ')').join('; ') :
      'No matching admitted local voice target is currently observed. This does not measure a hardware device or acoustic output.';
  };
  const surface = displayScheduler.register({ id, element: dialog, intervalMs: 100, write: render });
  listen(search, 'input', () => { page = 0; surface.invalidate(); });
  listen(choices, 'change', () => { if (invalid()) { choices.value = selectedId || ''; say('Finish the invalid numeric draft before changing mapping rows.'); return; } selectedId = choices.value || null; surface.invalidate(); });
  listen(previous, 'click', () => { page = Math.max(0, page - 1); renderedSerial = -1; surface.invalidate(); });
  listen(more, 'click', () => { page++; renderedSerial = -1; surface.invalidate(); });
  listen(add, 'click', () => {
    const state = owner.state(), parameter = state.parameters.find(value => !value.discrete), source = state.quantities[0]; if (!parameter || !source || invalid()) return;
    let bindingId; do { bindingId = 'mapping-' + (++rowSerial); } while (state.bindings.some(value => value.id === bindingId));
    selectedId = bindingId; owner.edit([...state.bindings, { id: bindingId, sourceKind: source.sourceKind, payloadField: source.payloadField, unit: source.unit, target: parameter.id,
      inputMin: 0, inputMax: 1, outputMin: parameter.min, outputMax: parameter.max, outputUnit: parameter.unit, curve: 'linear', composition: 'replace', mode: 'onset-only', smoothingMs: 0 }]); surface.invalidate();
  });
  listen(remove, 'click', () => { owner.edit(owner.state().bindings.filter(value => value.id !== selectedId)); selectedId = null; surface.invalidate(); });
  listen(controls.source, 'change', () => { const source = owner.state().quantities.find(value => value.id === controls.source.value); if (source) change({ sourceKind: source.sourceKind, payloadField: source.payloadField, unit: source.unit }); });
  listen(controls.target, 'change', () => { const parameter = owner.state().parameters.find(value => value.id === controls.target.value); if (parameter) change({ target: parameter.id, outputUnit: parameter.unit, outputMin: parameter.min, outputMax: parameter.max, mode: 'onset-only', smoothingMs: 0, composition: 'replace' }); });
  for (const field of ['mode', 'curve']) listen(controls[field], 'change', () => change({ [field]: controls[field].value, ...(field === 'mode' && controls.mode.value === 'onset-only' ? { smoothingMs: 0 } : {}) }));
  listen(controls.composition, 'change', () => { const parameter = owner.state().parameters.find(value => value.id === controls.target.value); change({ composition: controls.composition.value, outputUnit: controls.composition.value === 'scale' ? 'ratio' : parameter.unit }); });
  for (const [field, min, max] of numericFields) listen(controls[field], 'change', () => { const value = controls[field].valueAsNumber;
    if (!Number.isFinite(value) || value < min || value > max) { controls[field].setAttribute('aria-invalid', 'true'); say('Enter a finite ' + field + ' in [' + min + ', ' + max + ']. Empty is not zero.'); return; }
    controls[field].removeAttribute('aria-invalid'); change({ [field]: value }); });
  listen(enabled, 'change', () => change({ enabled: enabled.checked }));
  listen(neutralScope, 'click', () => change({ sourceScope: { kind: 'voice-owner' } }));
  listen(range, 'click', () => { if (selectedId) owner.confirmRange(selectedId); surface.invalidate(); });
  listen(learn, 'click', () => { try { owner.armLearn(selectedId, controls.source.value, actor.value.trim() ? actor.valueAsNumber : null); } catch (error) { say(error.message); } surface.invalidate(); });
  listen(cancel, 'click', () => owner.cancelLearn('Canceled by user.'));
  listen(keep, 'click', () => owner.keepListening());
  listen(accept, 'click', () => { try { owner.acceptLearn({ actorScoped: actorScoped.checked }); } catch (error) { say(error.message); } surface.invalidate(); });
  listen(actorScoped, 'change', () => surface.invalidate());
  listen(reset, 'click', () => { owner.reset(); selectedId = null; for (const control of Object.values(controls)) control.removeAttribute('aria-invalid'); surface.invalidate(); });
  listen(apply, 'click', () => { owner.commit().then(() => { say('Mapping revision saved and admitted through the sound transaction.'); dialog.close(); }).catch(error => { say(error.message); surface.invalidate(); }); });
  listen(close, 'click', () => dialog.close());
  listen(dialog, 'close', () => { owner.suspend(); previousFocus?.focus?.({ preventScroll: true }); });
  return Object.freeze({ invalidate: () => surface.invalidate(), open() { previousFocus = document.activeElement; if (!dialog.open) dialog.showModal(); owner.prepare().then(() => surface.invalidate()).catch(error => { say(error.message); surface.invalidate(); }); },
    suspend() { owner.suspend(); if (dialog.open) dialog.close(); },
    dispose() { if (scope.getReceipt()) return scope.getReceipt(); disposed = true;
      return scope.retire([{ name: 'mapping-controls', run: () => { surface.dispose(); for (const unlisten of listeners) unlisten(); dialog.remove(); } },
        { name: 'mapping-editor-owner', run: () => owner.dispose() }, { name: 'mapping-control-storage', run: () => storage.release() }]); } });
}
