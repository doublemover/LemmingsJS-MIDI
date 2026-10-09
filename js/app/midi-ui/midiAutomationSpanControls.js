import { MIDI_AUTOMATION_SPAN_PRESETS, createMidiAutomationSpanBundle } from '../../midi/project/MidiAutomationSpanPresets.js';
import { createMidiAutomationSpanEditor, createMidiSpan } from './midiAutomationSpanEditor.js';
import { AUTOMATION_TARGETS } from '../../midi/project/MidiProject.js';
const find = (host, matches) => matches(host) ? host : Array.from(host.children || []).map(child => find(child, matches)).find(Boolean);
const createMidiAutomationSpanControls = ({ document, getProject, onIntent, getRouter, getLaneCount, onSelect = () => {}, onReturnToSpatial = () => {}, ids = {} }) => {
  const names = { list: 'midiMainSpanList', preset: 'midiSpanPreset', presetApply: 'midiSpanPresetApply', domain: 'midiSpanPresetDomain', presetStatus: 'midiSpanPresetStatus', ...ids };
  const element = key => names[key] ? document.getElementById(names[key]) : null;
  const list = element('list'), add = element('add');
  const presetPicker = element('preset'), presetButton = element('presetApply');
  if (presetPicker && !presetPicker.children.length) for (const preset of MIDI_AUTOMATION_SPAN_PRESETS) { const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.label; presetPicker.append(option); }
  if (presetPicker && !presetPicker.value) presetPicker.value = MIDI_AUTOMATION_SPAN_PRESETS[0].id;
  let selectedId = null, sequence = 0, rendering = false, initialized = false, page = 0;
  const pageSize = 64;
  const selected = new Set(), expanded = new Set(), editors = new Map();
  const announce = () => onSelect(selectedId, [...selected]);
  const nextId = () => {
    let id;
    do { id = 'span-' + Date.now().toString(36) + '-' + (++sequence); } while (getProject().automation.some(entry => entry.id === id));
    return id;
  };
  const select = (id, { additive = false, focus = false } = {}) => {
    const index = getProject().automation.filter(entry => entry.span).findIndex(entry => entry.id === id);
    if (index < 0 || additive && selected.size >= pageSize && !selected.has(id)) return;
    if (!additive) selected.clear();
    page = Math.floor(index / pageSize);
    selected.add(id); expanded.add(id); selectedId = id; render(); announce();
    if (focus && list) { const row = find(list, element => element.dataset?.spanId === id); if (row) find(row, element => element.dataset?.spanProperty === 'name')?.focus?.({ preventScroll: true }); }
  };
  const updateSelected = (patch, spanPatch = null) => {
    const updates = getProject().automation.filter(entry => entry.span && selected.has(entry.id)).map(entry => ({ automationId: entry.id,
      patch: { ...patch, ...(spanPatch ? { span: { ...entry.span, ...spanPatch } } : {}) } }));
    if (!updates.length) return false;
    onIntent({ type: 'automation.batch.update', updates }); render(); return true;
  };
  const addSpan = (span = createMidiSpan(element('domain')?.value), target = element('target')?.value || 'velocity') => {
    if (getProject().automation.filter(entry => entry.span).length >= 64) return null;
    const id = nextId(); selected.clear(); selected.add(id); expanded.add(id); selectedId = id;
    const [min, max] = target === 'note' ? [0, 12] : target === 'duration' ? [2, 12] : target === 'pan' ? [-64, 64] : ['attack', 'decay', 'sustain', 'release'].includes(target) ? [0.5, 1.5] : [48, 110];
    onIntent({ type: 'automation.add', automation: { id, name: target + ' span', target, min, max, span } });
    render(); announce(); return id;
  };
  const applyPreset = id => {
    const bundle = createMidiAutomationSpanBundle(id, { domain: element('domain')?.value })
      .map(entry => ({ ...entry, id: nextId() }));
    if (!bundle.length) return false;
    const excess = getProject().automation.filter(entry => entry.span).length + bundle.length - 64;
    if (excess > 0) { const status = element('presetStatus'); if (status) status.textContent = 'Remove ' + excess + ' spans before adding this combination.'; return false; }
    selected.clear(); for (const entry of bundle) { selected.add(entry.id); expanded.add(entry.id); } selectedId = bundle[0].id;
    onIntent({ type: 'automation.bundle.add', automation: bundle }); render(); announce();
    const status = element('presetStatus'); if (status) status.textContent = MIDI_AUTOMATION_SPAN_PRESETS.find(preset => preset.id === id).description;
    return true;
  };
  const render = () => {
    if (!list || rendering) return;
    rendering = true;
    const active = document.activeElement, wasFocused = list.contains(active);
    let parent = active; while (parent && !parent.dataset?.spanId && parent !== list) parent = parent.parentElement || parent.parent;
    const focusId = parent?.dataset?.spanId, focusKey = active?.dataset?.spanField || active?.dataset?.spanProperty, bulkKey = active?.dataset?.bulkSpanField;
    const selection = active?.type === 'text' ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    try {
      while (list.firstChild) list.removeChild(list.firstChild);
      const project = getProject(), allSpans = project.automation.filter(entry => entry.span), ids = new Set(allSpans.map(entry => entry.id));
      page = Math.max(0, Math.min(page, Math.ceil(allSpans.length / pageSize) - 1));
      const spans = allSpans.slice(page * pageSize, (page + 1) * pageSize);
      for (const id of selected) if (!ids.has(id)) selected.delete(id);
      const visibleIds = new Set(spans.map(entry => entry.id));
      for (const id of expanded) if (!visibleIds.has(id)) expanded.delete(id);
      if (!initialized && spans[0]) { selected.add(spans[0].id); expanded.add(spans[0].id); selectedId = spans[0].id; }
      initialized = spans.length > 0;
      if (!ids.has(selectedId)) selectedId = selected.values().next().value || null;
      editors.clear();
      if (allSpans.length > pageSize) {
        const navigation = document.createElement('div'); navigation.className = 'midi-span-batch'; navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', 'Musical span pages');
        const status = document.createElement('span'); status.textContent = 'Spans ' + (page * pageSize + 1) + '-' + Math.min(allSpans.length, (page + 1) * pageSize) + ' of ' + allSpans.length + '; up to 64 selected for common edits.'; navigation.append(status);
        for (const [label, delta, key] of [['Previous spans', -1, 'pagePrevious'], ['Next spans', 1, 'pageNext']]) {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.bulkSpanField = key; button.disabled = delta < 0 ? page === 0 : (page + 1) * pageSize >= allSpans.length;
          button.addEventListener('click', () => { page += delta; render(); }); navigation.append(button);
        }
        list.append(navigation);
      }
      if (selected.size > 1) {
        const toolbar = document.createElement('div'); toolbar.className = 'midi-span-batch'; toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Edit selected musical spans');
        const summary = document.createElement('strong'); summary.textContent = selected.size + ' selected'; toolbar.append(summary);
        const entries = allSpans.filter(entry => selected.has(entry.id));
        const common = getter => entries.every(entry => getter(entry) === getter(entries[0])) ? getter(entries[0]) : '';
        const bulk = (label, key, choices = null, spanField = false) => {
          const wrapper = document.createElement('label'); wrapper.textContent = label;
          const input = document.createElement(choices ? 'select' : 'input'); input.dataset.bulkSpanField = key;
          if (choices) for (const choice of ['', ...choices]) { const option = document.createElement('option'); option.value = choice; option.textContent = choice || 'Mixed'; input.append(option); }
          else { input.type = 'number'; input.step = '0.25'; input.placeholder = 'Mixed'; }
          input.value = String(common(entry => spanField ? entry.span[key] : entry[key])); input.setAttribute('aria-label', 'Selected spans ' + label);
          input.addEventListener('change', () => { if (!input.value.trim()) return; const value = choices ? input.value : Number(input.value); if (choices || Number.isFinite(value)) updateSelected(spanField ? {} : { [key]: value }, spanField ? { [key]: value } : null); });
          wrapper.append(input); toolbar.append(wrapper);
        };
        bulk('Target', 'target', AUTOMATION_TARGETS); bulk('Start value', 'min'); bulk('End value', 'max');
        if (common(entry => entry.span.domain)) { bulk('Start', 'start', null, true); bulk('Length', 'duration', null, true); }
        for (const [label, enabled] of [['Enable selected', true], ['Bypass selected', false]]) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.bulkSpanField = enabled ? 'enable' : 'bypass'; button.addEventListener('click', () => updateSelected({ enabled })); toolbar.append(button); }
        list.append(toolbar);
      }
      for (const lane of spans) {
        const row = document.createElement('div'); row.className = 'midi-span-row'; row.dataset.spanId = lane.id;
        const header = document.createElement('div'); header.className = 'midi-span-row-header';
        const selectedLabel = document.createElement('label'); const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(lane.id); check.dataset.spanProperty = 'selected'; check.setAttribute('aria-label', 'Select ' + lane.name);
        check.disabled = !check.checked && selected.size >= pageSize; check.title = check.disabled ? 'Deselect another span before selecting more than 64.' : 'Include this span in common edits';
        check.addEventListener('change', () => { if (check.checked && selected.size >= pageSize && !selected.has(lane.id)) { check.checked = false; return; } if (check.checked) { selected.add(lane.id); expanded.add(lane.id); selectedId = lane.id; } else { selected.delete(lane.id); if (selectedId === lane.id) selectedId = selected.values().next().value || null; } render(); announce(); }); selectedLabel.append(check); header.append(selectedLabel);
        const button = document.createElement('button'); button.type = 'button'; button.textContent = lane.name; button.dataset.spanProperty = 'open'; button.setAttribute('aria-pressed', String(selected.has(lane.id))); button.setAttribute('aria-expanded', String(expanded.has(lane.id))); button.addEventListener('click', event => select(lane.id, { additive: event.ctrlKey || event.metaKey || event.shiftKey })); header.append(button);
        const enabledLabel = document.createElement('label'); enabledLabel.textContent = 'On'; const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = lane.enabled; enabled.dataset.spanProperty = 'enabled'; enabled.setAttribute('aria-label', lane.name + ' enabled'); enabled.addEventListener('change', () => onIntent({ type: 'automation.update', automationId: lane.id, patch: { enabled: enabled.checked } })); enabledLabel.append(enabled); header.append(enabledLabel);
        const summary = document.createElement('span'); summary.textContent = lane.span.domain + ' · ' + lane.span.shape + ' · priority ' + lane.span.priority; header.append(summary);
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.dataset.spanProperty = 'remove'; remove.addEventListener('click', () => onIntent({ type: 'automation.remove', automationId: lane.id })); header.append(remove); row.append(header);
        if (expanded.has(lane.id)) {
          const fields = document.createElement('div'); fields.className = 'midi-span-fields';
          const field = (label, key, choices = null) => {
            const wrapper = document.createElement('label'); wrapper.textContent = label; const input = document.createElement(choices ? 'select' : 'input'); input.dataset.spanProperty = key;
            if (choices) for (const value of choices) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
            else { input.type = key === 'name' ? 'text' : 'number'; input.step = '0.1'; }
            input.value = String(lane[key]); input.setAttribute('aria-label', lane.name + ' ' + label); input.addEventListener('change', () => { const value = choices || key === 'name' ? input.value : Number(input.value); if (choices || key === 'name' || Number.isFinite(value)) onIntent({ type: 'automation.update', automationId: lane.id, patch: { [key]: value } }); }); wrapper.append(input); fields.append(wrapper);
          };
          field('Name', 'name'); field('Target', 'target', AUTOMATION_TARGETS); field('Start value', 'min'); field('End value', 'max'); row.append(fields);
          const editor = createMidiAutomationSpanEditor({ document, lane, tracks: project.tracks, laneCount: getLaneCount(), open: true,
            getState: () => getRouter()?.getAutomationSpanState?.(lane.id, Math.min(getLaneCount() - 1, lane.span.laneStart)),
            onUpdate: patch => { const returnFocus = patch.span === null && row.contains(document.activeElement); onIntent({ type: 'automation.update', automationId: lane.id, patch }); if (returnFocus) onReturnToSpatial(lane.id); } });
          editor.addEventListener('toggle', () => { if (!list.contains(editor)) return; if (!editor.open) expanded.delete(lane.id); else expanded.add(lane.id); }); editors.set(lane.id, editor); row.append(editor);
        }
        list.append(row);
      }
      if (add) add.disabled = allSpans.length >= pageSize;
      if (presetButton) presetButton.disabled = allSpans.length + 3 > pageSize;
      if (wasFocused) {
        const host = bulkKey ? list : find(list, element => element.dataset?.spanId === focusId);
        let control = host && find(host, element => bulkKey ? element.dataset?.bulkSpanField === bulkKey : (element.dataset?.spanField || element.dataset?.spanProperty) === focusKey);
        if (control?.disabled && ['pagePrevious', 'pageNext'].includes(bulkKey)) control = find(list, element => ['pagePrevious', 'pageNext'].includes(element.dataset?.bulkSpanField) && !element.disabled);
        control?.focus?.({ preventScroll: true }); if (selection && Number.isInteger(selection[0])) control?.setSelectionRange?.(...selection);
      }
    } finally { rendering = false; }
  };
  const addClicked = () => addSpan(), presetClicked = () => applyPreset(presetPicker?.value); add?.addEventListener('click', addClicked); presetButton?.addEventListener('click', presetClicked);
  render();
  return { render, select, addSpan, applyPreset, updateSelected, getSelectedId: () => selectedId, getSelectedIds: () => [...selected], syncStatus: () => { for (const editor of editors.values()) editor.syncStatus?.(); }, dispose: () => { add?.removeEventListener?.('click', addClicked); presetButton?.removeEventListener?.('click', presetClicked); selected.clear(); expanded.clear(); editors.clear(); } };
};
export { createMidiAutomationSpanControls };
