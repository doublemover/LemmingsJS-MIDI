import { createMidiAutomationSpanEditor, createMidiSpan } from '../midi-ui/midiAutomationSpanEditor.js';
import { AUTOMATION_TARGETS } from '../../midi/project/MidiProject.js';
const createProcgenMidiSpanControls = ({ document, getProject, onIntent, getRouter, getLaneCount, onSelect = () => {} }) => {
  const list = document.getElementById('procgenSpanList'), add = document.getElementById('procgenSpanAdd');
  let selectedId = null, selectedEditor = null, sequence = 0, rendering = false;
  const select = id => { selectedId = id; render(); onSelect(id); };
  const addSpan = (span = createMidiSpan(document.getElementById('procgenSpanDomain')?.value), target = document.getElementById('procgenSpanTarget')?.value || 'velocity') => {
    if (getProject().automation.filter(entry => entry.span).length >= 64) return null;
    const id = 'span-' + Date.now().toString(36) + '-' + (++sequence); selectedId = id;
    const [min, max] = target === 'note' ? [0, 12] : target === 'duration' ? [2, 12] : target === 'pan' ? [-64, 64] : ['attack', 'decay', 'sustain', 'release'].includes(target) ? [0.5, 1.5] : [48, 110];
    onIntent({ type: 'automation.add', automation: { id, name: target + ' span', target, min, max, span } });
    render(); onSelect(id); return id;
  };
  const render = () => {
    if (!list || rendering) return;
    rendering = true;
    try {
      while (list.firstChild) list.removeChild(list.firstChild);
      const project = getProject(), spans = project.automation.filter(entry => entry.span).slice(0, 64);
      if (!spans.some(entry => entry.id === selectedId)) selectedId = spans[0]?.id || null;
      selectedEditor = null;
      for (const lane of spans) {
        const row = document.createElement('div'); row.className = 'midi-span-row'; row.dataset.spanId = lane.id;
        const header = document.createElement('div'); header.className = 'midi-span-row-header';
        const button = document.createElement('button'); button.type = 'button'; button.textContent = lane.name; button.setAttribute('aria-pressed', String(lane.id === selectedId)); button.addEventListener('click', () => select(lane.id)); header.append(button);
        const enabledLabel = document.createElement('label'); enabledLabel.textContent = 'On'; const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = lane.enabled; enabled.setAttribute('aria-label', lane.name + ' enabled'); enabled.addEventListener('change', () => onIntent({ type: 'automation.update', automationId: lane.id, patch: { enabled: enabled.checked } })); enabledLabel.append(enabled); header.append(enabledLabel);
        const summary = document.createElement('span'); summary.textContent = lane.span.domain + ' · ' + lane.span.shape + ' · priority ' + lane.span.priority; header.append(summary);
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => onIntent({ type: 'automation.remove', automationId: lane.id })); header.append(remove); row.append(header);
        if (selectedId === lane.id) {
          const field = (label, key, choices = null) => {
            const wrapper = document.createElement('label'); wrapper.textContent = label; const input = document.createElement(choices ? 'select' : 'input');
            if (choices) for (const value of choices) { const option = document.createElement('option'); option.value = value; option.textContent = value; input.append(option); }
            else { input.type = 'number'; input.step = '0.1'; }
            input.value = String(lane[key]); input.setAttribute('aria-label', lane.name + ' ' + label); input.addEventListener('change', () => { const value = choices ? input.value : Number(input.value); if (choices || Number.isFinite(value)) onIntent({ type: 'automation.update', automationId: lane.id, patch: { [key]: value } }); }); wrapper.append(input); header.append(wrapper);
          };
          field('Target', 'target', AUTOMATION_TARGETS); field('Start value', 'min'); field('End value', 'max');
          selectedEditor = createMidiAutomationSpanEditor({ document, lane, tracks: project.tracks, laneCount: getLaneCount(), open: true,
            getState: () => getRouter()?.getAutomationSpanState?.(lane.id, Math.min(getLaneCount() - 1, lane.span.laneStart)),
            onUpdate: patch => onIntent({ type: 'automation.update', automationId: lane.id, patch }) }); row.append(selectedEditor);
        }
        list.append(row);
      }
      if (add) add.disabled = spans.length >= 64;
    } finally { rendering = false; }
  };
  const addClicked = () => addSpan(); add?.addEventListener('click', addClicked);
  render();
  return { render, select, addSpan, getSelectedId: () => selectedId, syncStatus: () => selectedEditor?.syncStatus?.(), dispose: () => add?.removeEventListener('click', addClicked) };
};
export { createProcgenMidiSpanControls };
