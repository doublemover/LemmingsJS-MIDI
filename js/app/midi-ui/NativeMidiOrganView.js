import { ORGAN_DRAWBAR_NAMES, validateOrganRotaryPolicy, validateOrganRotaryControls } from '../../midi/content/OrganRotaryIntent.js';
import { DRAWBAR_PROFILE_IDS, DRAWBAR_VALUES } from '../../midi/native/OrganRotaryProfileAdapter.js';

export function createNativeMidiOrganView({ document, container, routes, getLane, getWireTarget, getProfileSession, getProfileState, onSave, onSaveControls, onAssign, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Drawbar organ / independent rotary'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (label, node) => { const wrapper = element('label'); wrapper.className = 'midi-field'; wrapper.append(element('span', label), node); node.setAttribute('aria-label', label); controls.append(wrapper); return node; };
  const select = (label, values) => { const node = field(label, element('select')); for (const [value, text] of values) { const option = element('option', text); option.value = String(value); node.append(option); } return node; };
  const numeric = (label, value, min, max) => { const node = field(label, element('input')); node.type = 'number'; node.value = String(value); node.min = String(min); node.max = String(max); node.step = 'any'; return node; };
  const profiles = select('Accepted profiles to use', [['organ', 'Drawbar Organ only'], ['rotary', 'Rotary Speaker only'], ['both', 'Independent organ and rotary profiles']]);
  const routeMode = select('Hardware role', [['primary', 'This lane’s native instrument'], ['parallel-control', 'Parallel rotary controls; keep the lane’s note output']]);
  const density = select('Physical drawbar source', [['none', 'Manual registration'], ['represented-actor-density', 'Held actor density in this part']]);
  const circulation = select('Physical rotary source', [['none', 'Manual slow / fast'], ['cohort-circulation', 'Measured circulation from completed actor motion']]);
  const fullRotation = numeric('Circulation scale (radians / second)', 4, 0.001, 1000), smoothing = numeric('Physical-source smoothing (ms)', 40, 0, 60000), deadband = numeric('Control deadband (0–1)', 0.001, 0, 1);
  const pickup = field('Soft takeover after hardware registration changes', element('input')); pickup.type = 'checkbox'; pickup.checked = true;
  const bars = element('div'); bars.className = 'midi-control-group'; controls.append(bars);
  const sliders = [], labels = [];
  for (const [index, title] of ORGAN_DRAWBAR_NAMES.entries()) {
    const wrapper = element('label'); wrapper.className = 'midi-field'; const slider = element('input'); slider.type = 'range'; slider.min = '0'; slider.max = '8'; slider.step = '1'; slider.value = index === 2 ? '8' : '0';
    slider.style.writingMode = 'vertical-lr'; slider.style.height = '104px'; slider.style.width = '28px'; slider.setAttribute('aria-label', title + ' drawbar, pull down to increase'); slider.setAttribute('aria-orientation', 'vertical');
    const label = element('output', title + ' · 0'); wrapper.append(element('span', title), slider, label); bars.append(wrapper); sliders.push(slider); labels.push(label);
  }
  const barIndex = select('Exact drawbar', ORGAN_DRAWBAR_NAMES.map((value, index) => [index, value])), barValue = numeric('Exact drawbar setting (0–8)', 0, 0, 8); barValue.step = '1';
  const speed = select('Rotary speed override', [['', 'Physical circulation / unchanged'], ['slow', 'Slow / chorale'], ['fast', 'Fast / tremolo']]);
  const brake = select('Optional brake override', [['', 'Leave unchanged'], ['rotate', 'Rotate'], ['stop', 'Brake / stop']]);
  const percussion = select('Optional organ percussion', [['', 'Leave unchanged'], ['off', 'Off'], ['on', 'On']]);
  const keyClick = numeric('Optional key click (0–1; empty leaves unchanged)', '', 0, 1), leakage = numeric('Optional leakage (0–1; empty leaves unchanged)', '', 0, 1), acceleration = numeric('Optional horn / woofer acceleration (normalized, empty leaves unchanged)', '', 0, 1);
  const status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(status, element('p', 'Pull drawbars down to increase 0–8. Organ and rotary support are independent. Optional rotary controls require current declared controller metadata; acceleration values are receiver-defined, not seconds. Completed physical motion changes controls without creating note onsets. A registration restore uses observed original values only after fresh readback confirms the app’s last setting.')); container.append(root);
  let disposed = false, busy = false, serial = 0, laneId = null, minimumBars = [0, 0, 8, 0, 0, 0, 0, 0, 0], maximumBars = [8, 8, 8, 5, 4, 3, 2, 1, 0], message = '', displayedRevision = '';
  const controlsDraft = () => validateOrganRotaryControls({ drawbars: density.value === 'none' ? sliders.map(node => Number(node.value)) : null, rotaryFast: speed.value === '' ? null : speed.value === 'fast', rotaryBrake: brake.value === '' ? null : brake.value === 'stop',
    percussion: percussion.value === '' ? null : percussion.value === 'on', keyClick01: keyClick.value === '' ? null : Number(keyClick.value), leakage01: leakage.value === '' ? null : Number(leakage.value), acceleration01: acceleration.value === '' ? null : Number(acceleration.value) });
  const policy = () => validateOrganRotaryPolicy({ schema: 'lemmings-organ-rotary-policy/v1', profiles: profiles.value, routeMode: routeMode.value, drawbarSource: density.value, minimumDrawbars: minimumBars, maximumDrawbars: maximumBars,
    rotarySource: circulation.value, fullRotationRadiansPerSecond: Number(fullRotation.value), smoothingMs: Number(smoothing.value), deadband01: Number(deadband.value), pickup: pickup.checked });
  const activePart = () => getLane() ? routes.organPerformanceState(getLane().id)[0] : null;
  const render = () => {
    if (disposed) return; const lane = getLane(), state = getProfileState(), target = getWireTarget(), part = activePart(), same = row => row.group === target.group && row.scope === target.channel && row.enabled;
    const organ = state?.profiles.find(row => DRAWBAR_PROFILE_IDS.includes(row.id) && same(row)), rotary = state?.profiles.find(row => row.id === '7e22000101' && same(row));
    if (laneId !== lane?.id) {
      laneId = lane?.id ?? null; const saved = lane?.organ, values = lane?.organControls; profiles.value = saved?.profiles || 'organ'; routeMode.value = saved?.routeMode || 'primary'; density.value = saved?.drawbarSource || 'none'; circulation.value = saved?.rotarySource || 'none';
      minimumBars = [...(saved?.minimumDrawbars || minimumBars)]; maximumBars = [...(saved?.maximumDrawbars || maximumBars)]; fullRotation.value = String(saved?.fullRotationRadiansPerSecond ?? 4); smoothing.value = String(saved?.smoothingMs ?? 40); deadband.value = String(saved?.deadband01 ?? 0.001); pickup.checked = saved?.pickup ?? true;
      sliders.forEach((node, index) => { node.value = String(values?.drawbars?.[index] ?? minimumBars[index]); }); speed.value = values?.rotaryFast == null ? '' : values.rotaryFast ? 'fast' : 'slow'; brake.value = values?.rotaryBrake == null ? '' : values.rotaryBrake ? 'stop' : 'rotate';
      percussion.value = values?.percussion == null ? '' : values.percussion ? 'on' : 'off'; keyClick.value = values?.keyClick01 == null ? '' : String(values.keyClick01); leakage.value = values?.leakage01 == null ? '' : String(values.leakage01); acceleration.value = values?.acceleration01 == null ? '' : String(values.acceleration01);
    }
    for (const button of buttons) button.disabled = busy || !lane; activate.disabled ||= !lane?.organ; restore.disabled ||= !part || part.contributors || part.pending || part.suspended;
    const revision = JSON.stringify(part?.observed || {});
    if (displayedRevision && revision !== displayedRevision) message = 'Device registration changed; review observed values before applying a new override.';
    displayedRevision = revision;
    sliders.forEach((node, index) => { node.disabled = busy || profiles.value === 'rotary'; const observed = part?.observed['64:' + (48 + index)], submitted = part?.submitted['64:' + (48 + index)], nearest = value => DRAWBAR_VALUES.reduce((best, candidate, i) => Math.abs(candidate - value) < Math.abs(DRAWBAR_VALUES[best] - value) ? i : best, 0);
      labels[index].textContent = ORGAN_DRAWBAR_NAMES[index] + ' · requested ' + node.value + ' · native ' + (submitted == null ? 'unknown' : nearest(submitted)) + ' · device ' + (observed?.known ? nearest(observed.value) : 'unknown'); });
    status.textContent = (lane ? 'Lane ' + (lane.name || lane.id) : 'Choose a lane') + ' · organ ' + (organ ? 'enabled' : 'not enabled') + ' · rotary ' + (rotary ? 'enabled' : 'not enabled') +
      (part ? ' · ' + part.contributors + ' held voices · ' + (part.pending ? 'pending' : part.fault || part.suspended ? part.fault || 'restored; rebind before continuing' : 'ready') + ' · circulation ' + (part.formation?.circulationRadiansPerSecond == null ? 'unknown' : part.formation.circulationRadiansPerSecond.toFixed(3) + ' rad/s') : '') + (message ? ' · ' + message : '');
  };
  const button = (label, operation) => {
    const node = element('button', label); node.type = 'button'; buttons.push(node); controls.append(node);
    bind(node, 'click', async () => { if (busy || disposed) return; const owned = ++serial; busy = true; render(); try { await operation(); } catch (error) { if (!disposed && owned === serial) { message = error.message; onStatus(message); } } finally { if (owned === serial) busy = false; render(); } }); return node;
  };
  button('Read accepted organ / rotary allocations and organ features', async () => {
    const session = await getProfileSession(), target = getWireTarget(); await session.inquire(target.channel);
    for (const row of session.state().profiles.filter(row => row.group === target.group && row.scope === target.channel && (DRAWBAR_PROFILE_IDS.includes(row.id) || row.id === '7e22000101'))) { await session.details(row.profile, row.scope, 0); if (DRAWBAR_PROFILE_IDS.includes(row.id)) await session.details(row.profile, row.scope, 1); }
    message = 'Independent profile evidence refreshed. Optional rotary controls use the discovered controller resource panel.';
  });
  button('Use current drawbars as quiet-density registration', () => { minimumBars = sliders.map(node => Number(node.value)); message = 'Quiet-density registration drafted'; });
  button('Use current drawbars as full-density registration', () => { maximumBars = sliders.map(node => Number(node.value)); message = 'Full-density registration drafted'; });
  button('Save organ / rotary source policy', () => { onSave(getLane().id, policy()); message = 'Organ/rotary policy saved; explicitly bind the current accepted profiles.'; });
  button('Apply requested drawbars and rotary controls to the owned part', () => { const part = activePart(); if (JSON.stringify(part?.observed || {}) !== displayedRevision) throw new Error('Device controls changed during this edit; review their observed values'); onSaveControls(getLane().id, controlsDraft()); message = 'Part control intent saved. Native submissions and device observations are displayed separately.'; });
  const activate = button('Activate independent profiles on this route', async () => { const lane = getLane(), session = await getProfileSession(), target = getWireTarget(); if (!lane?.organ) throw new Error('Save an organ/rotary policy first'); await routes.prepareOutput(target.grant); const route = routes.bindOrganRotary({ laneId: lane.id, policy: lane.organ, ...target, session }); if (!route.auxiliary) onAssign(lane.id, route); message = route.auxiliary ? 'Parallel rotary control output active; the lane keeps its note output.' : 'Native organ/rotary part active on the accepted channel.'; });
  const restore = button('Restore unchanged app-owned registration from observations', async () => { const response = await routes.restoreOrganRegistration(getLane().id); message = response.reason || 'Registration restore ' + response.status + (response.skipped?.length ? ' · ' + response.skipped.length + ' unknown or changed controls skipped' : ''); });
  sliders.forEach(node => bind(node, 'input', render)); bind(barIndex, 'change', () => { barValue.value = sliders[Number(barIndex.value)].value; });
  bind(barValue, 'change', () => { const value = Number(barValue.value); if (Number.isInteger(value) && value >= 0 && value <= 8) sliders[Number(barIndex.value)].value = String(value); render(); });
  for (const node of [profiles, routeMode, density, circulation]) bind(node, 'change', render); bind(root, 'toggle', () => { if (root.open) render(); }); render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; serial++; for (const remove of removers) remove(); root.remove(); } });
}
