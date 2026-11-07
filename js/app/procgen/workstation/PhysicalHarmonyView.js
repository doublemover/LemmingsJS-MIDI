import { createOwnedResourceReservation } from '../../resources/OwnedResourceReservation.js';

const centsText = value => Number.isFinite(value) ? value.toFixed(2) + ' cents' : 'pitch unavailable';
const referenceText = value => Number.isFinite(value) ? ' @ ' + value + ' Hz reference' : '';
export function createPhysicalHarmonyView({ document, resourceBudget = null, readSnapshot, getGraph, getLaneIndex = () => null, makePitchInput = null, updatePitchInput = null,
  onSelectActor = () => {}, onPitch = () => {}, onFieldBypass = () => {}, onEdit = () => {} } = {}) {
  if (!document?.createElementNS || [readSnapshot, getGraph, onSelectActor, onPitch, onFieldBypass, onEdit].some(value => typeof value !== 'function')) throw new TypeError('Physical harmony needs its readonly source and canonical edit owners.');
  const storage = createOwnedResourceReservation({ budget: resourceBudget, owner: 'physical-harmony-diagram', kind: 'bounded-svg-and-equivalent-list', category: 'graphics', bytes: 524288 });
  const element = document.createElement('section'); element.className = 'studio-physical-harmony'; element.setAttribute('aria-label', 'Physical harmony · actors and pitch');
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const svgNode = (tag, attributes = {}) => { const value = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, item] of Object.entries(attributes)) value.setAttribute(key, String(item)); return value; };
  const summary = node('p'), axes = node('p', 'Horizontal: sounding pitch in cents relative to A4 = 440 Hz at 6900 cents. Source references stay explicit in the list. Vertical: distinct logical voices, ordered by pitch. A shared x-position means unison; row spacing has no musical duration or distance.');
  const graph = svgNode('svg', { role: 'img', 'aria-label': 'Pitch diagram; every mark is also described in the voice list', viewBox: '0 0 640 160', preserveAspectRatio: 'none' });
  const plot = node('div'); plot.className = 'studio-harmony-plot'; plot.append(graph);
  const list = node('ol'), mapping = node('div'), help = node('p', 'Tuning membership, original continuous pitch and quantized target are separate. Unknown tuning stays unknown. Source ownership and modeled release are not proof of acoustic sound.');
  list.setAttribute('aria-label', 'Physical harmony voices and causes');
  const edit = node('button', 'Edit physical harmony objects'); edit.type = 'button'; edit.addEventListener('click', onEdit);
  element.append(node('h3', 'Physical harmony'), summary, axes, plot, list, mapping, edit, help);
  const rows = new Map(), controls = new Map(); let disposed = false;
  const render = () => {
    if (disposed) return;
    let snapshot; try { snapshot = readSnapshot(); } catch (error) { summary.textContent = 'Physical harmony inspection is unavailable: ' + error.message; plot.hidden = list.hidden = mapping.hidden = true; return; }
    plot.hidden = list.hidden = mapping.hidden = !snapshot;
    if (!snapshot) { summary.textContent = 'Physical harmony inspection is unavailable.'; return; }
    const values = snapshot.activeVoices.slice(0, 64), graphDefinition = getGraph(), live = new Set();
    summary.textContent = snapshot.activeVoices.length + ' retained logical voice(s); ' + values.length + ' shown' + (snapshot.omitted ? '; ' + snapshot.omitted + ' inspection records omitted' : '') +
      '. Tuning: ' + (snapshot.tuningIds.length ? snapshot.tuningIds.join(', ') : 'unknown') + '. No future candidate is supplied by the engine.';
    const pitches = values.map(value => value.axisPitchCents).filter(Number.isFinite), low = pitches.length ? Math.floor((Math.min(...pitches) - 100) / 100) * 100 : 6000,
      high = pitches.length ? Math.max(low + 200, Math.ceil((Math.max(...pitches) + 100) / 100) * 100) : 7200;
    const height = Math.max(128, values.length * 30 + 42); graph.setAttribute('viewBox', '0 0 640 ' + height); graph.style.height = height + 'px';
    graph.replaceChildren(svgNode('line', { x1: 120, x2: 620, y1: 22, y2: 22, stroke: 'currentColor' }));
    for (const [pitch, x] of [[low, 120], [(low + high) / 2, 370], [high, 620]]) {
      const label = svgNode('text', { x, y: 14, 'text-anchor': 'middle' }); label.textContent = pitch.toFixed(0) + ' c'; graph.append(label);
    }
    const focused = document.activeElement;
    values.forEach((voice, index) => {
      const key = voice.generation + ':' + voice.voiceId; live.add(key); let row = rows.get(key);
      if (!row) { const item = node('li'), select = node('button'), detail = node('span'); select.type = 'button';
        select.addEventListener('click', () => { const current = rows.get(key)?.value; if (current?.actorId != null) onSelectActor(current); });
        item.append(select, detail); row = { item, select, detail, value: voice }; rows.set(key, row); list.append(item); }
      row.value = voice; row.select.textContent = 'Actor ' + (voice.actorId ?? 'unassigned'); row.select.disabled = voice.actorId == null;
      row.detail.textContent = ' · ' + voice.voiceId + ' · ' + (voice.role || 'role unknown') + ' · ' + centsText(voice.pitchCents) + referenceText(voice.referenceHz) +
        (Number.isFinite(voice.pitchHz) ? ' / ' + voice.pitchHz.toFixed(2) + ' Hz' : '') + ' · ' + voice.state +
        ' · tuning ' + (voice.tuningId || 'unknown') + ' (' + voice.membership + ')' +
        ' · continuous input ' + centsText(voice.originalContinuousPitchCents) + referenceText(voice.originalContinuousReferenceHz) + ' · quantized target ' + centsText(voice.quantizedTargetCents) + referenceText(voice.quantizedTargetReferenceHz) +
        ' · ' + voice.realizationCount + ' local source realization(s) · causes [' + voice.causeIds.join(', ') + '] (' + voice.causeCoverage + ')';
      if (list.children[index] !== row.item) list.insertBefore(row.item, list.children[index] || null);
      const y = 42 + index * 30, x = Number.isFinite(voice.axisPitchCents) ? 120 + (voice.axisPitchCents - low) / (high - low) * 500 : 120;
      const label = svgNode('text', { x: 2, y: y + 4 }); label.textContent = 'Actor ' + (voice.actorId ?? '?') + ' · ' + (index + 1);
      graph.append(label, svgNode(voice.state === 'released-tail' ? 'rect' : 'circle', voice.state === 'released-tail' ?
        { x: x - 5, y: y - 5, width: 10, height: 10, fill: 'none', stroke: 'currentColor' } : { cx: x, cy: y, r: 5, fill: voice.realizationCount ? 'currentColor' : 'none', stroke: 'currentColor' }));
      const title = svgNode('title'); title.textContent = voice.voiceId + ' · ' + centsText(voice.pitchCents) + ' · ' + voice.state; graph.lastChild.append(title);
    });
    for (const [key, row] of rows) if (!live.has(key)) { row.item.remove(); rows.delete(key); }
    if (focused?.isConnected && list.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    const laneIndex = getLaneIndex(), selected = graphDefinition.instruments.filter(instrument => instrument.route === 'local' && !instrument.formationId && !instrument.topologyRegionId &&
      Number.isFinite(instrument.pitchCents) && (!instrument.sourceLanes || instrument.sourceLanes.includes(laneIndex)));
    const mappingKeys = new Set();
    for (const instrument of selected) {
      const key = 'instrument:' + instrument.id; mappingKeys.add(key); let control = controls.get(key);
      if (!control) {
        const commit = amount => { if (Number.isFinite(amount)) onPitch(instrument.id, amount); };
        const label = node('label', instrument.id + ' · authored onset pitch '), value = makePitchInput ? makePitchInput(instrument.id, instrument.pitchCents, commit) : node('input'), lower = node('button', '−100 c'), raise = node('button', '+100 c');
        value.type = 'number'; value.min = '-24000'; value.max = '24000'; value.step = '0.01'; value.setAttribute('aria-label', instrument.id + ' onset pitch in cents');
        lower.type = raise.type = 'button';
        if (!makePitchInput) value.addEventListener('change', () => commit(value.valueAsNumber));
        lower.addEventListener('click', () => commit(value.valueAsNumber - 100)); raise.addEventListener('click', () => commit(value.valueAsNumber + 100));
        label.append(value, lower, raise); control = { element: label, value }; controls.set(key, control); mapping.append(label);
      }
      if (updatePitchInput) updatePitchInput(control.value, instrument.pitchCents);
      else if (document.activeElement !== control.value) control.value.value = String(instrument.pitchCents);
    }
    for (const field of graphDefinition.harmonicFields || []) {
      if (field.laneScope && !field.laneScope.includes(laneIndex)) continue;
      const key = 'field:' + field.id; mappingKeys.add(key); let control = controls.get(key);
      if (!control) { const element = node('button'); element.type = 'button'; element.addEventListener('click', () => {
        const current = getGraph().harmonicFields.find(item => item.id === field.id); if (current) onFieldBypass(field.id, !current.bypass);
      }); control = { element }; controls.set(key, control); mapping.append(element); }
      control.element.textContent = (field.bypass ? 'Restore field ' : 'Bypass field ') + field.id;
      control.element.title = 'Canonical field edit; authored held-note policy: ' + field.heldPolicy;
    }
    for (const [key, control] of controls) if (!mappingKeys.has(key) && !control.element.contains(document.activeElement)) { control.element.remove(); controls.delete(key); }
  };
  return Object.freeze({ element, render, dispose() { if (disposed) return true; disposed = true; element.remove(); rows.clear(); controls.clear(); storage.release(); return true; } });
}
