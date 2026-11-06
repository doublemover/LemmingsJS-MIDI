import { PIANO_DYNAMICS, validatePianoPerformancePolicy } from '../../midi/content/PianoPerformanceIntent.js';

export function createNativeMidiPianoView({ document, container, routes, getLane, getWireTarget, getProfileSession, getProfileRecord, onSave, onSaveControls, onAssign, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Piano dynamics / shared pedals'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (label, node) => { const wrapper = element('label'); wrapper.className = 'midi-field'; wrapper.append(element('span', label), node); node.setAttribute('aria-label', label); controls.append(wrapper); return node; };
  const select = (label, values) => { const node = field(label, element('select')); for (const [value, text] of values) { const option = element('option', text); option.value = String(value); node.append(option); } return node; };
  const numeric = (label, value, min, max) => { const node = field(label, element('input')); node.type = 'number'; node.min = String(min); node.max = String(max); node.step = 'any'; node.value = String(value); return node; };
  const mode = select('Piano dynamics', [['authored-dynamic', 'Authored musical dynamic'], ['impact-in-authored-range', 'Physical impact within an authored dynamic range']]);
  const dynamics = PIANO_DYNAMICS.map(row => [row.mark, row.mark]), minimum = select('Quiet dynamic', dynamics), maximum = select('Loud / authored dynamic', dynamics);
  const exponent = numeric('Impact response curve', 1, 0.1, 10), source = select('Shared sustain source', [['off', 'No physical sustain source'], ['pressure01', 'Actor pressure / crowd compression · maximum held contribution'], ['swarm-density01', 'Completed swarm density · maximum held contribution']]);
  const smoothing = numeric('Sustain source smoothing (ms)', 20, 0, 60000), deadband = numeric('Pedal deadband (0–1)', 0.001, 0, 1);
  const pickup = field('Soft takeover after device pedal movement', element('input')); pickup.type = 'checkbox'; pickup.checked = true;
  const damping = numeric('Release damping (empty uses receiver default)', '', 0, 1);
  const temperament = select('Optional piano temperament', [['', 'Leave device tuning unchanged'], ...['Equal', 'Just major', 'Just minor', 'Pythagorean', 'Kirnberger', 'Meantone', 'Werckmeister'].map((value, index) => [index, value])]);
  const tonic = select('Temperament tonic', ['C', 'C♯ / D♭', 'D', 'D♯ / E♭', 'E', 'F', 'F♯ / G♭', 'G', 'G♯ / A♭', 'A', 'A♯ / B♭', 'B'].map((value, index) => [index, value]));
  const pedalRows = new Map();
  for (const [name, title] of [['sustain01', 'Sustain / half pedal'], ['sostenuto01', 'Sostenuto · capture currently held notes'], ['unaCorda01', 'Una corda / soft pedal']]) {
    const override = field('Override ' + title, element('input')); override.type = 'checkbox';
    const slider = field(title, element('input')); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.001'; slider.value = '0';
    const value = numeric(title + ' depth', 0, 0, 1), output = element('output'); output.setAttribute('aria-label', title + ' requested, submitted and device values'); controls.append(output);
    pedalRows.set(name, { override, slider, value, output, revision: null, dirty: false });
  }
  const status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(status, element('p', 'Piano dynamics and pedal semantics follow the accepted receiver profile. Local sound recipes are approximate and are not qualified as conforming pianos. Physical impact is a normalized authored source, not measured hammer force. Soft takeover needs an observed pedal value; read isolated values in the device-state section before playing, move the device pedal, or explicitly disable pickup in the saved policy. Each part owns one shared pedal state; releasing an actor removes only its contribution.')); container.append(root);
  let disposed = false, busy = false, serial = 0, laneId = null, message = '';
  const policy = () => validatePianoPerformancePolicy({ schema: 'lemmings-piano-performance-policy/v1', dynamicMode: mode.value, minimumDynamic: minimum.value, maximumDynamic: maximum.value, impactExponent: Number(exponent.value),
    sustainSource: source.value, smoothingMs: Number(smoothing.value), deadband01: Number(deadband.value), pickup: pickup.checked, releaseVelocity01: damping.value === '' ? null : Number(damping.value),
    tuning: temperament.value === '' ? null : { temperament: Number(temperament.value), tonic: Number(tonic.value) } });
  const render = () => {
    if (disposed) return; const lane = getLane(), record = getProfileRecord(), features = record?.id === '7e20000101' ? record.pianoFeatures : null, parts = lane ? routes.pianoPerformanceState(lane.id).filter(part => part.outputId === lane.outputId) : [], part = parts[0];
    if (laneId !== lane?.id) {
      laneId = lane?.id ?? null; const saved = lane?.piano; mode.value = saved?.dynamicMode || 'impact-in-authored-range'; minimum.value = saved?.minimumDynamic || 'p'; maximum.value = saved?.maximumDynamic || 'ff';
      exponent.value = String(saved?.impactExponent ?? 1); source.value = saved?.sustainSource || 'off'; smoothing.value = String(saved?.smoothingMs ?? 20); deadband.value = String(saved?.deadband01 ?? 0.001); pickup.checked = saved?.pickup ?? true;
      damping.value = saved?.releaseVelocity01 == null ? '' : String(saved.releaseVelocity01); temperament.value = saved?.tuning == null ? '' : String(saved.tuning.temperament); tonic.value = String(saved?.tuning?.tonic ?? 0);
      for (const row of pedalRows.values()) { row.dirty = false; row.revision = null; }
    }
    for (const button of buttons) button.disabled = busy || !lane; read.disabled ||= record?.id !== '7e20000101'; activate.disabled ||= !lane?.piano || !record?.enabled || !features;
    for (const [name, row] of pedalRows) {
      const requested = lane?.pianoControls?.[name], observed = part?.observed[name], revision = observed?.revision ?? 0;
      if (row.revision != null && revision !== row.revision && row.dirty) { row.dirty = false; message = 'Device pedal changed during the edit; its draft was canceled.'; }
      row.revision = revision;
      if (!row.dirty) { row.override.checked = requested != null; row.slider.value = row.value.value = String(requested ?? observed?.value ?? part?.queued[name] ?? 0); }
      row.override.disabled = busy || !lane?.piano || name === 'sostenuto01' && !features?.sostenuto || name === 'unaCorda01' && !features?.unaCorda;
      row.slider.disabled = row.value.disabled = busy || !lane?.piano || !row.override.checked || name === 'sostenuto01' && !features?.sostenuto || name === 'unaCorda01' && !features?.unaCorda;
      row.output.textContent = 'requested ' + (requested ?? 'physical source / off') + ' · native ' + (part?.submitted[name] ?? 'not submitted') + ' · device ' + (observed?.known ? observed.value : 'unknown') + (part?.pending ? ' · pending' : '');
    }
    status.textContent = (lane ? 'Lane ' + (lane.name || lane.id) : 'Choose a lane') + (features ? ' · piano receiver ' + features.lowestNote + '–' + features.highestNote + ' · sustain ' + (features.continuousSustain ? 'continuous / half pedal' : 'on/off') : ' · read receiving piano details') +
      (part ? ' · ' + part.contributors + ' held contributions' + (part.fault ? ' · ' + part.fault : '') : ' · no active native piano part') + (message ? ' · ' + message : '');
  };
  const commitPedal = (name, row) => {
    const lane = getLane(), part = routes.pianoPerformanceState(lane.id).find(part => part.outputId === lane.outputId);
    if (row.revision !== (part?.observed[name]?.revision ?? 0)) { row.dirty = false; message = 'The device changed this pedal; review its value before overriding.'; render(); return; }
    onSaveControls(lane.id, { ...(lane.pianoControls || {}), [name]: row.override.checked ? Number(row.value.value) : null }); row.dirty = false; render();
  };
  for (const [name, row] of pedalRows) {
    bind(row.slider, 'input', () => { row.value.value = row.slider.value; row.dirty = true; }); bind(row.slider, 'change', () => commitPedal(name, row));
    bind(row.value, 'input', () => { row.slider.value = row.value.value; row.dirty = true; }); bind(row.value, 'change', () => commitPedal(name, row));
    bind(row.override, 'change', () => { row.dirty = true; commitPedal(name, row); });
  }
  const button = (label, operation) => {
    const node = element('button', label); node.type = 'button'; buttons.push(node); controls.append(node);
    bind(node, 'click', async () => { if (busy || disposed) return; const owned = ++serial; busy = true; render(); try { await operation(); } catch (error) { if (!disposed && owned === serial) { message = error.message; onStatus(message); } } finally { if (owned === serial) busy = false; render(); } }); return node;
  };
  const read = button('Read piano receiver and pedal capabilities', async () => { const session = await getProfileSession(), record = getProfileRecord(); if (record?.id !== '7e20000101') throw new Error('Select the advertised Piano Profile above'); const response = await session.details(record.profile, record.scope, 64); message = response.reason || 'Piano details: ' + response.status; });
  button('Save authored piano performance policy', () => { onSave(getLane().id, policy()); message = 'Piano intent saved. Review its receiving profile and activate this native part.'; });
  const activate = button('Activate receiving piano profile for this lane', async () => {
    const lane = getLane(), session = await getProfileSession(), record = getProfileRecord(), target = getWireTarget(); if (!lane?.piano || record?.id !== '7e20000101') throw new Error('Save a piano policy and select its receiving profile');
    await routes.prepareOutput(target.grant); const route = routes.bindPiano({ laneId: lane.id, policy: lane.piano, ...target, session, profile: record.profile }); onAssign(lane.id, route); message = 'Piano part active. Pedal overrides are shared by this part and retain distinct native-submitted versus device-observed values.';
  });
  button('Lift this part’s owned pedals', () => { onSaveControls(getLane().id, { sustain01: 0, sostenuto01: 0, unaCorda01: 0 }); message = 'Pedal-off requested for this part; stop also retires its native ownership.'; });
  bind(root, 'toggle', () => { if (root.open) render(); }); render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; serial++; for (const remove of removers) remove(); root.remove(); } });
}
