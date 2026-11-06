import { DEVICE_PARAMETER_SOURCES } from '../../midi/native/DeviceParameter.js';

export function createNativeMidiParameterView({ document, container, routes, getCiSession, getPeerMuid, getLane, getWireTarget, onSaveMappings, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Device expression / physical controls'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (label, node) => { const wrapper = element('label'); wrapper.className = 'midi-field'; wrapper.append(element('span', label), node); node.setAttribute('aria-label', label); controls.append(wrapper); return node; };
  const number = (label, value, min, max, step = 'any') => { const node = field(label, element('input')); node.type = 'number'; node.value = String(value); node.min = String(min); node.max = String(max); node.step = String(step); return node; };
  const checkbox = label => { const node = field(label, element('input')); node.type = 'checkbox'; return node; };
  const list = field('Controller resource', element('select')), all = element('option', 'All currently active controllers'); all.value = 'all'; list.append(all);
  const parameter = field('Device parameter', element('select'));
  const slider = field('Parameter position', element('input')); slider.type = 'range'; slider.min = '0'; slider.max = '4294967295'; slider.step = '1'; slider.value = '0';
  const numeric = number('Exact parameter value', 0, 0, 4294967295, 1), enumeration = field('Named parameter value', element('select')), binary = checkbox('Momentary / toggle state');
  const increment = number('Relative change (signed full-resolution units)', 1, -2147483648, 2147483647, 1);
  const rawReplay = checkbox('Explicitly include receiver-dependent relative / toggle automation');
  const stopped = checkbox('The selected native output is stopped; apply this device-control change');
  const source = field('Physical source', element('select'));
  for (const [id, definition] of Object.entries(DEVICE_PARAMETER_SOURCES)) { const option = element('option', definition.label); option.value = id; source.append(option); }
  const inputMinimum = number('Physical source minimum', 0, -1000000000, 1000000000), inputMaximum = number('Physical source maximum', 1, -1000000000, 1000000000);
  const curve = field('Response curve', element('select')); for (const value of ['linear', 'exponential', 'logarithmic', 'step']) { const option = element('option', value); option.value = value; curve.append(option); }
  const exponent = number('Curve strength', 2, 0.1, 10), smoothing = number('Smoothing (ms)', 20, 0, 60000), deadband = number('Deadband (fraction of range)', 0.001, 0, 0.5);
  const pickup = checkbox('Soft takeover after a device move; wait until the physical source crosses the observed value'); pickup.checked = true;
  const status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const description = element('p'); description.className = 'midi-help'; root.append(status, description); container.append(root);
  let catalog = null, ci = null, unsubscribe = null, disposed = false, busy = false, operation = 0, displayed = null, displayedRevision = 0, dirty = false, message = '';
  const selected = () => catalog?.state().parameters.find(row => row.stableId === parameter.value);
  const draft = () => {
    const row = selected(); if (!row) throw new Error('Discover and select a device parameter first');
    return catalog.intent(row.stableId, { source: source.value, inputMinimum: Number(inputMinimum.value), inputMaximum: Number(inputMaximum.value), curve: curve.value, exponent: Number(exponent.value), smoothingMs: Number(smoothing.value), deadband: Number(deadband.value), pickup: pickup.checked, ...(['momentary', 'toggle'].includes(row.type) && row.scope === 'channel' ? { releaseValue: row.minimum } : {}) });
  };
  const render = () => {
    if (disposed) return; const state = catalog?.state(), row = selected(), observed = row ? catalog.baseline(row.stableId) : null;
    if (displayed !== row?.stableId) {
      displayed = row?.stableId ?? null; dirty = false; stopped.checked = false; displayedRevision = observed?.revision || 0;
      if (row) {
        slider.min = numeric.min = String(row.minimum); slider.max = numeric.max = String(row.maximum);
        slider.step = numeric.step = row.stepCount ? String((row.maximum - row.minimum) / (row.stepCount - 1)) : String(2 ** (32 - row.sourceResolution));
        enumeration.replaceChildren(); for (const entry of row.enumValues) { const option = element('option', entry.title); option.value = String(entry.value); enumeration.append(option); }
        const value = observed.known ? observed.value : row.defaultValue ?? row.minimum; numeric.value = slider.value = String(value); enumeration.value = String(value); binary.checked = value === row.maximum;
      }
    } else if (observed && observed.revision !== displayedRevision) {
      if (dirty && observed.origin !== 'local-request') message = 'The device changed this value. The pending edit was canceled; review its current value.';
      dirty = false; stopped.checked = false; displayedRevision = observed.revision;
      if (observed.known) { numeric.value = slider.value = String(observed.value); enumeration.value = String(observed.value); binary.checked = observed.value === row.maximum; }
    }
    for (const button of buttons) button.disabled = busy;
    const selectionChanged = state && (state.peerMuid !== getPeerMuid() || state.outputGrant !== getWireTarget().grant);
    const writable = !!row?.writable && !state?.stale && !selectionChanged, absolute = writable && ['absolute', 'both'].includes(row.recognize);
    slider.disabled = numeric.disabled = !absolute || busy; enumeration.disabled = !absolute || busy; binary.disabled = !absolute || busy;
    slider.hidden = numeric.hidden = row?.type === 'enum' || ['momentary', 'toggle'].includes(row?.type);
    enumeration.hidden = row?.type !== 'enum'; binary.hidden = !['momentary', 'toggle'].includes(row?.type);
    apply.disabled ||= !absolute || !stopped.checked || row.scope !== 'channel'; relative.disabled ||= !writable || !stopped.checked || row.scope !== 'channel' || !['rpn', 'nrpn'].includes(row.ctrlType);
    save.disabled ||= !writable || !getLane(); activate.disabled ||= !writable || !getLane()?.deviceParameters?.some(mapping => mapping.stableId === row.stableId);
    baseline.disabled ||= !row || selectionChanged || state?.stale || !stopped.checked; remove.disabled ||= !getLane()?.deviceParameters?.length;
    startCapture.disabled ||= !state || state.stale || selectionChanged || state.capturing; stopCapture.disabled ||= !state?.capturing; exportCapture.disabled ||= !state?.automationRecords; clearCapture.disabled ||= !state?.automationRecords; replayLast.disabled ||= !state?.automationRecords || state.capturing || !stopped.checked;
    const flags = !state ? 'Not discovered' : selectionChanged ? 'Device selection changed; discover its controls' : state.stale ? 'Stale / disconnected metadata' : !row ? 'Choose a parameter' : observed.pending ? 'Pending native submission' : !row.writable ? 'Read-only device control' : row.scope === 'note' ? 'Owned-note scope · physical mapping only' : 'Writable channel control';
    status.textContent = flags + (row ? ' · value ' + (observed.known ? observed.value : 'unknown') + (observed.localValue != null ? ' · local requested ' + observed.localValue + ' · residual ' + observed.rawRemainder : '') + ' · ' + row.sourceResolution + ' significant bits' + (observed.reason ? ' · ' + observed.reason : '') : '') +
      (state?.latest ? ' · ' + state.latest.status + (state.latest.reason ? ' · ' + state.latest.reason : '') : '') + (state?.automationRecords ? ' · ' + state.automationRecords + ' captured controller gestures' + (state.capturing ? ' · capturing' : '') : '') + (message ? ' · ' + message : '');
    description.textContent = row ? row.name + (row.description ? ' · ' + row.description : '') + ' · range ' + row.minimum + '–' + row.maximum + (row.unit ? ' ' + row.unit : ' · unit not declared') +
      ' · sends ' + row.transmit + ' / recognizes ' + row.recognize + (row.paramPath ? ' · ' + row.paramPath : '') + ' · ' + (row.scope === 'note' ? 'Each owned note keeps its own value.' : ['momentary', 'toggle'].includes(row.type) ? 'Actor triggers combine across this channel; the last trigger releases to ' + row.minimum + (row.type === 'toggle' ? '. Only a rising edge toggles the receiver; trigger release does not restore its latched setting.' : '.') : 'All voices on this lane channel share the control.') :
      'Discover the selected peer’s declared controls. A saved physical mapping requires explicit activation after reconnecting. Device observations never send an echo.';
  };
  const ensure = async () => {
    const session = await getCiSession(), peer = getPeerMuid();
    if (!session || !Number.isInteger(peer)) throw new Error('Select a discovered CI peer');
    if (!catalog || ci !== session || catalog.state().peerMuid !== peer || catalog.state().disposed) { unsubscribe?.(); ci = session; catalog = routes.createDeviceParameterCatalog(ci, peer); unsubscribe = catalog.subscribe(render); displayed = null; }
    return catalog;
  };
  const refreshParameters = () => {
    const previous = parameter.value; parameter.replaceChildren();
    for (const row of catalog.state().parameters) { const option = element('option', row.name + ' · channel ' + row.propertyChannel + (row.writable ? '' : ' · read only')); option.value = row.stableId; parameter.append(option); }
    if ([...parameter.options].some(row => row.value === previous)) parameter.value = previous; displayed = null; render();
  };
  const button = (label, action) => {
    const node = element('button', label); node.type = 'button'; buttons.push(node); controls.append(node);
    bind(node, 'click', async () => { if (busy || disposed) return; const owned = ++operation; busy = true; render(); try { await action(); } catch (error) { if (!disposed && owned === operation) { message = error.message; onStatus(message); } } finally { if (owned === operation) busy = false; render(); } }); return node;
  };
  button('Find channel-specific controller lists', async () => { const owner = await ensure(), links = await owner.channelLinks(); list.replaceChildren(all); for (const link of links) { const option = element('option', link.title + ' · channel ' + link.propertyChannel); option.value = JSON.stringify(link); list.append(option); } });
  button('Discover selected device controls', async () => { const owner = await ensure(), link = list.value === 'all' ? null : JSON.parse(list.value), response = await owner.load(link ? { resource: 'ChCtrlList', ...link } : {}); message = response.reason || response.count + ' device parameters discovered'; refreshParameters(); });
  const baseline = button('Read isolated current values', async () => { const row = selected(), response = await catalog.readBaseline({ propertyChannel: row.propertyChannel, quiescent: stopped.checked }); message = response.reason || 'Device value report: ' + response.status; stopped.checked = false; });
  const apply = button('Apply selected value', async () => {
    const row = selected(), value = row.type === 'enum' ? Number(enumeration.value) : ['momentary', 'toggle'].includes(row.type) ? binary.checked ? row.maximum : row.minimum : Number(numeric.value);
    const response = await catalog.write(row.stableId, { target: getWireTarget(), value, expectedRevision: displayedRevision, confirmed: stopped.checked }); message = response.reason || 'Control ' + response.status; stopped.checked = false; dirty = false;
  });
  const relative = button('Apply relative change', async () => { const row = selected(), response = await catalog.write(row.stableId, { target: getWireTarget(), delta: Number(increment.value), expectedRevision: displayedRevision, confirmed: stopped.checked }); message = response.reason || 'Relative control ' + response.status; stopped.checked = false; dirty = false; });
  const save = button('Save physical source mapping to lane', () => { const lane = getLane(), mapping = draft(); onSaveMappings(lane.id, [...(lane.deviceParameters || []).filter(row => row.stableId !== mapping.stableId), mapping]); message = 'Mapping intent saved. Review and activate it on the current device before native playback.'; });
  const activate = button('Activate saved mapping on this route', async () => {
    const lane = getLane(), mapping = lane.deviceParameters.find(row => row.stableId === selected().stableId), route = routes.resolve(lane.outputId, lane.id);
    if (!route) throw new Error('Explicitly route this lane to the matching native device first'); await catalog.activate(lane.id, mapping, route); message = 'Physical mapping active for this route. Soft takeover uses observed device values; an unknown baseline waits for a report or device movement.';
  });
  const remove = button('Remove selected lane mapping', async () => { const lane = getLane(); await catalog?.deactivate(lane.id, parameter.value); onSaveMappings(lane.id, (lane.deviceParameters || []).filter(row => row.stableId !== parameter.value)); message = 'Saved mapping removed from this lane.'; });
  const startCapture = button('Capture ordered controller automation', () => { catalog.startAutomationCapture(); message = 'Capturing native hardware movements and submitted UI gestures. Resolved values and original relative gestures remain separate.'; });
  const stopCapture = button('Stop controller capture', () => catalog.stopAutomationCapture());
  const exportCapture = button('Save controller automation', () => { const data = catalog.automation({ includeBaselineDependent: rawReplay.checked }), url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })), link = element('a'); link.href = url; link.download = 'lemmings-device-controller-automation.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); });
  const clearCapture = button('Clear controller capture', () => catalog.clearAutomation());
  const replayLast = button('Apply last captured controller value', async () => { const data = catalog.automation({ includeBaselineDependent: rawReplay.checked }), record = data.records.at(-1), response = await catalog.replayMutation(record, { target: getWireTarget(), confirmed: stopped.checked, allowBaselineDependent: rawReplay.checked }); stopped.checked = false; message = response.reason || 'Captured control ' + response.status; });
  for (const node of [parameter, list]) bind(node, 'change', () => { stopped.checked = false; dirty = false; render(); });
  bind(source, 'change', () => { const definition = DEVICE_PARAMETER_SOURCES[source.value]; inputMinimum.value = String(definition.minimum); inputMaximum.value = String(definition.maximum); });
  bind(slider, 'input', () => { numeric.value = slider.value; dirty = true; }); bind(numeric, 'input', () => { slider.value = numeric.value; dirty = true; });
  bind(enumeration, 'change', () => { dirty = true; }); bind(binary, 'change', () => { dirty = true; }); bind(stopped, 'change', render);
  bind(root, 'toggle', () => { if (root.open) render(); }); render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; operation++; unsubscribe?.(); for (const remove of removers) remove(); root.remove(); } });
}
