import { createParameterKnob } from '../controls/ParameterKnob.js';

export function createPatchVariationView({ document, window, owner } = {}) {
  if (!document?.createElement || !owner?.subscribe) throw new TypeError('Invalid variation dock.');
  const listeners = [], profileListeners = [], controls = [], rowViews = new Map(); let disposed = false, profileKey = null, selected = null, coordinates = {}, amount01 = 0.5;
  let parameterLocks = new Set(), macroLocks = new Set(), lastMessage = null;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text != null) element.textContent = text; if (className) element.className = className; return element; };
  const on = (element, type, callback, bucket = listeners) => { element.addEventListener(type, callback); bucket.push(() => element.removeEventListener(type, callback)); };
  const element = node('section', null, 'studio-variations'); element.setAttribute('aria-label', 'Authored sound variations');
  const parent = node('div', 'Prepare an exact lane instrument.', 'studio-variations-parent'), knobs = node('div', null, 'studio-variations-knobs');
  const status = node('output', 'Generate changes recipe data. Compare uses a saved physical take. Keep and Apply are separate.'); status.setAttribute('role', 'status'); status.setAttribute('aria-label', 'Variation status');
  const run = action => async () => { try { await action(); } catch (error) { if (!disposed) status.textContent = String(error.message).slice(0, 1024); } };
  const button = (label, action, bucket = listeners) => { const value = node('button', label); value.type = 'button'; on(value, 'click', run(action), bucket); return value; };
  const actions = node('div', null, 'studio-sound-actions');
  const prepare = button('Prepare parent', () => owner.prepare());
  const generate = button('Generate four', async () => {
    if (!owner.state().sourceCurrent) await owner.prepare();
    return owner.generate({ seed: Number(seed.value), coordinates: { ...coordinates }, amount01, locks: { parameters: [...parameterLocks], macros: [...macroLocks] } });
  });
  const cancel = button('Cancel generation', () => owner.cancel()), stop = button('Stop comparison', () => owner.stop());
  const a = button('A · Parent', () => owner.listen('parent')), b = button('B · Candidate', () => owner.listen('candidate'));
  actions.append(prepare, generate, cancel, button('PRELISTEN route…', () => owner.revealMonitor()), a, b, stop);
  const list = node('ol', null, 'studio-variation-list'); list.setAttribute('aria-label', 'Generated candidates and exact pins');
  const advanced = node('details'), summary = node('summary', 'Seed, version, locks and outcomes'), details = node('div', null, 'studio-variations-advanced');
  const seedLabel = node('label', 'Seed '), seed = node('input'); seed.type = 'number'; seed.min = '-2147483648'; seed.max = '2147483647'; seed.step = '1'; seed.value = '0'; seed.setAttribute('aria-label', 'Variation seed'); seedLabel.append(seed);
  const version = node('p'), lockFields = node('fieldset'), legend = node('legend', 'Keep fields unchanged'), outcomes = node('p'), provenance = node('pre');
  provenance.setAttribute('aria-label', 'Selected variation provenance'); lockFields.append(legend);
  details.append(seedLabel, version, lockFields, outcomes, provenance); advanced.append(summary, details);
  element.append(parent, knobs, actions, status, list, advanced);
  const resetControls = state => {
    const profile = state.neighborhood, key = profile ? profile.id + '@' + profile.version + ':' + state.session.parent?.definitionHash : null;
    if (key === profileKey) return;
    for (const control of controls) control.dispose(); controls.length = 0; knobs.replaceChildren();
    for (const remove of profileListeners) remove(); profileListeners.length = 0;
    profileKey = key; coordinates = {}; parameterLocks = new Set(); macroLocks = new Set(); amount01 = profile?.amount?.default ?? 0.5;
    lockFields.replaceChildren(legend);
    if (!profile) return;
    const addKnob = (axis, isAmount = false) => {
      if (!isAmount) coordinates[axis.id] = axis.default;
      const descriptor = { id: 'variation.' + axis.id, revision: profile.version, name: axis.name, quantity: isAmount ? 'neighborhood-amount' : 'neighborhood-coordinate',
        unit: axis.unit, min: axis.minimum, max: axis.maximum, defaultValue: axis.default, step: 0.01, fineStep: 0.001, scale: 'linear', functionalRole: 'timbre' };
      const control = createParameterKnob({ document, window, descriptor, value: descriptor.defaultValue, compact: true, contextName: 'Variation · ' + axis.name, getIdentity: () => profileKey,
        commit: value => { if (disposed || key !== profileKey) return false; if (isAmount) amount01 = value; else coordinates[axis.id] = value; return true; } });
      controls.push(control); knobs.append(control.element);
    };
    for (const axis of profile.axes) addKnob(axis);
    if (profile.amount) addKnob({ ...profile.amount, id: 'amount' }, true);
    const lock = (id, name, collection, kind) => {
      const label = node('label', name), input = node('input'); input.type = 'checkbox'; input.setAttribute('aria-label', 'Lock ' + kind + ' ' + name);
      on(input, 'change', () => { if (input.checked) collection.add(id); else collection.delete(id); }, profileListeners); label.prepend(input); lockFields.append(label);
    };
    const mapped = new Set(profile.axes.flatMap(axis => axis.mappings.map(mapping => mapping.parameter)));
    for (const parameter of state.parentOptions?.parameters || []) if (mapped.has(parameter)) lock(parameter, parameter, parameterLocks, 'parameter');
    for (const macro of state.parentOptions?.macros || []) lock(macro.id, macro.name, macroLocks, 'macro');
    version.textContent = profile.name + ' · version ' + profile.version + ' · ' + profile.qualification + ' · one pinned realization';
  };
  const rowFor = row => {
    let view = rowViews.get(row.id);
    if (!view) {
      const removers = [], item = node('li', null, 'studio-variation-row'), choose = button('', () => { selected = row.id; render(owner.state()); }, removers);
      const state = node('output'), deltas = node('span'), buttons = node('div', null, 'studio-sound-actions');
      const pin = button('Pin', () => owner.state().session.pins.some(value => value.id === row.id) ? owner.unpin(row.id) : owner.pin(row.id), removers);
      const compare = button('Compare', () => owner.compare(row.id), removers), keep = button('Keep', () => owner.keep(row.id), removers), apply = button('Apply', () => owner.apply(row.id), removers);
      buttons.append(pin, compare, keep, apply); item.append(choose, state, deltas, buttons);
      view = { id: row.id, item, choose, state, deltas, pin, compare, keep, apply, removers }; rowViews.set(row.id, view);
    }
    view.choose.textContent = (row.slot + 1) + ' · ' + row.name; view.choose.setAttribute('aria-pressed', String(row.id === selected));
    view.item.dataset.selected = String(row.id === selected); view.item.dataset.candidateId = row.candidateId || row.id;
    view.state.textContent = [row.state, row.pinned ? 'pinned' : null, row.kept ? 'kept' : null, row.admitted ? 'reference qualified' : null, row.duplicateLike ? 'duplicate-like parameter data' : null, row.sourceCurrent ? null : 'older source; inspect only', row.reason].filter(Boolean).join(' · ');
    view.deltas.textContent = row.deltas.map(change => change.parameter + ': ' + Number(change.previous.toPrecision(4)) + ' → ' + Number(change.value.toPrecision(4)) + ' ' + change.unit).join(' · ');
    view.pin.textContent = row.pinned ? 'Unpin' : 'Pin';
    const compiled = row.state === 'compiled'; view.pin.disabled = !compiled;
    view.compare.disabled = !compiled || !row.sourceCurrent || row.busy;
    view.keep.disabled = !compiled || !row.sourceCurrent || row.busy || row.kept;
    view.apply.disabled = !compiled || !row.sourceCurrent || row.busy || !row.kept || !row.admitted;
    for (const [control, label] of [[view.pin, row.pinned ? 'Unpin' : 'Pin'], [view.compare, 'Compare'], [view.keep, 'Keep'], [view.apply, 'Apply']]) control.setAttribute('aria-label', label + ' ' + row.name);
    return view;
  };
  function render(state) {
    if (disposed) return;
    resetControls(state);
    const source = state.session.parent;
    parent.textContent = source ? source.name + ' · revision ' + source.revision + ' · ' + (state.sourceCurrent ? 'CURRENT lane parent' : 'PARENT CHANGED; inspect only') +
      (state.session.comparison ? ' · PREVIEW ' + (state.playing === 'parent' ? 'A parent' : 'B candidate') + '; lane unchanged' : '') : 'Choose a pinned instrument in the Lane page, then Prepare parent.';
    const rows = [...state.session.rows, ...state.session.pins.filter(pin => !state.session.rows.some(row => row.id === pin.id))], ids = new Set(rows.map(row => row.id));
    for (const [id, view] of rowViews) if (!ids.has(id)) { for (const remove of view.removers) remove(); view.item.remove(); rowViews.delete(id); }
    for (let index = 0; index < rows.length; index++) { const view = rowFor(rows[index]); if (list.children[index] !== view.item) list.insertBefore(view.item, list.children[index] || null); }
    prepare.disabled = state.phase === 'preparing-parent' || !!state.unresolvedRetirement;
    generate.disabled = state.phase === 'preparing-parent' || state.session.generating || !!state.unresolvedRetirement;
    cancel.disabled = !state.session.generating; a.disabled = b.disabled = !state.session.comparison; stop.disabled = !state.session.comparison;
    for (const control of controls) control.setState({ value: control.descriptor.id === 'variation.amount' ? amount01 : coordinates[control.descriptor.id.slice(10)], isReadOnly: !state.sourceCurrent, isPending: state.phase === 'preparing-parent' });
    const selectedRow = rows.find(row => row.id === selected);
    provenance.textContent = selectedRow ? JSON.stringify({ reference: selectedRow.reference, provenance: selectedRow.provenance, outcome: { state: selectedRow.state, reason: selectedRow.reason } }, null, 2) : 'Select a numbered candidate to inspect its exact revision, source and clamp/constraint receipt.';
    const message = state.error || state.session.lastOutcome?.message;
    if (message && message !== lastMessage) { status.textContent = message; lastMessage = message; }
    outcomes.textContent = state.take ? 'Reference take ' + state.take.takeId + ' · revision ' + state.take.revision + ' · ' + (state.take.unavailable || 'same first ' + Math.min(8, state.take.seconds) + ' source-clock seconds; selected lane') : 'No saved reference take selected. Generation and exact Keep remain available; Compare reports the missing take.';
  }
  on(list, 'keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || ![...rowViews.values()].some(view => view.choose === document.activeElement)) return;
    const views = [...list.children].map(item => [...rowViews.values()].find(view => view.item === item)), index = views.findIndex(view => view.choose === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + views.length) % views.length;
    event.preventDefault(); if (views[next]) { selected = views[next].id; render(owner.state()); views[next].choose.focus(); }
  });
  const unsubscribe = owner.subscribe(render);
  return Object.freeze({ element, update: () => render(owner.state()), suspend: () => { for (const control of controls) control.cancel('dock-hidden'); },
    dispose() { if (disposed) return; disposed = true; unsubscribe(); for (const control of controls) control.dispose(); for (const remove of [...listeners, ...profileListeners]) remove(); for (const view of rowViews.values()) for (const remove of view.removers) remove(); rowViews.clear(); element.remove(); } });
}
