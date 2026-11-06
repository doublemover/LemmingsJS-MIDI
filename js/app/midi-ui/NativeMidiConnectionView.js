const element = (document, tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
export function createNativeMidiConnectionView({ document, container, routes, getLanes, getSelectedLaneId, onAssign, onAssignMany, onStatus = () => {} }) {
  if (!container) return { render() {}, dispose() {} };
  const root = element(document, 'details', '', 'midi-preset-panel native-midi-connection'); root.id = 'midiNativeConnection';
  root.append(element(document, 'summary', 'Native MIDI / DAW'));
  root.append(element(document, 'p', 'Pair the optional companion to use native UMP devices or publish a performance source for a DAW. Each connection is explicitly granted.', 'midi-help'));
  const controls = element(document, 'div', '', 'midi-control-group'), routeControls = element(document, 'div', '', 'midi-control-group');
  const removers = [], buttons = [], bindEvent = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (label, node, parent = controls) => { const wrapper = element(document, 'label', '', 'midi-field'); wrapper.append(element(document, 'span', label), node); node.setAttribute('aria-label', label); parent.append(wrapper); return node; };
  const input = (label, value, type = 'text', parent = controls) => { const node = element(document, 'input'); node.type = type; node.value = value; return field(label, node, parent); };
  const select = (label, parent = controls) => field(label, element(document, 'select'), parent);
  const checkbox = label => { const node = input(label, '', 'checkbox'); node.checked = false; return node; };
  const button = (text, action, parent = controls) => {
    const node = element(document, 'button', text); node.type = 'button'; buttons.push(node);
    bindEvent(node, 'click', async () => { if (busy) return; busy = true; render(); try { await action(); } catch (error) { message.textContent = error.message; onStatus(error.message); } finally { busy = false; render(); } }); parent.append(node); return node;
  };
  const bridgeUrl = input('Companion address', routes.client.url, 'url'), pairing = input('Local pairing code', '', 'password'); pairing.autocomplete = 'off'; pairing.spellcheck = false;
  const connect = button('Pair companion', async () => { routes.client.setUrl(bridgeUrl.value); const pairingCode = pairing.value; pairing.value = ''; await routes.connect({ pairingCode }); await routes.enumerate(); message.textContent = 'Paired. Select a device or publish a performance source.'; });
  const disconnect = button('Disconnect companion', () => routes.disconnect());
  const backend = select('Native backend'), switchBackend = button('Select backend', async () => { await routes.client.selectBackend(Number(backend.value)); await routes.enumerate(); });
  const endpoint = select('Native device'), refresh = button('Refresh native devices', () => routes.enumerate());
  const groups = input('Granted groups (1–16, comma-separated)', '1');
  const sysex = checkbox('Allow SysEx / CI data'), timing = checkbox('Allow timing'), sensing = checkbox('Allow active sensing'), control = checkbox('Allow endpoint control');
  const groupMask = () => {
    const values = groups.value.split(',').map(value => Number(value.trim()));
    if (!values.length || values.length > 16 || values.some(value => !Number.isInteger(value) || value < 1 || value > 16)) throw new Error('Choose explicit group numbers from 1 to 16');
    return values.reduce((mask, value) => mask | 1 << value - 1, 0);
  };
  const permissions = () => Number(sysex.checked) | Number(timing.checked) << 1 | Number(sensing.checked) << 2 | Number(control.checked) << 3;
  const open = button('Grant selected device', async () => {
    const snapshot = routes.state(); if (!endpoint.value) throw new Error('Select a native input or output first');
    const grant = await routes.open({ inventoryEpoch: snapshot.inventory.inventoryEpoch, endpointToken: Number(endpoint.value), groupMask: groupMask(), permissions: permissions() }); selectedGrant = grant.grant;
    message.textContent = grant.direction === 'input' ? 'Input granted. Native packets retain source timestamps and precision provenance.' : 'Output granted. Assign a lane before sending.';
  });
  const publicationName = input('Published endpoint name', 'Lemmings Performance');
  const publish = button('Publish Lemmings Performance', async () => { const grant = await routes.publish({ name: publicationName.value, direction: 'output', groupMask: groupMask(), permissions: permissions() }); selectedGrant = grant.grant; message.textContent = 'Performance source published. Select it in your DAW and assign lanes below. DAW recording compatibility is unverified.'; });
  const publishInput = button('Publish control input', async () => { const grant = await routes.publish({ name: publicationName.value + ' Control', direction: 'input', groupMask: groupMask(), permissions: permissions() }); selectedGrant = grant.grant; message.textContent = 'Separate control input published under its own grant.'; });
  const active = select('Owned connection', routeControls);
  const revoke = button('Revoke connection / unpublish', async () => { if (!active.value) throw new Error('Select an owned connection'); await routes.closeGrant(Number(active.value)); message.textContent = 'Connection revoked; owned notes cleaned up by the companion.'; }, routeControls);
  const lane = select('Lane', routeControls), group = select('Group', routeControls), channel = select('Channel', routeControls), protocol = select('Requested channel protocol', routeControls), sharing = select('Channel ownership', routeControls);
  for (let value = 0; value < 16; value++) { const a = element(document, 'option', String(value + 1)); a.value = String(value); group.append(a); const b = a.cloneNode(true); channel.append(b); }
  for (const [value, label] of [['midi2', 'MIDI2 · receiver support unverified'], ['midi1-in-ump', 'MIDI1 in UMP · reduced expression']]) { const option = element(document, 'option', label); option.value = value; protocol.append(option); }
  for (const [value, label] of [['dedicated', 'Dedicated lane channel'], ['shared-ensemble', 'Share ensemble channel explicitly']]) { const option = element(document, 'option', label); option.value = value; sharing.append(option); }
  const assign = button('Route this lane', () => {
    if (!getLanes().some(value => value.id === lane.value)) throw new Error('Choose a current lane');
    const route = routes.bind({ laneId: lane.value, grant: Number(active.value), group: Number(group.value), channel: Number(channel.value), protocol: protocol.value, sharing: sharing.value });
    onAssign(lane.value, route); message.textContent = 'Lane routed to group ' + (route.group + 1) + ', channel ' + (route.channel + 1) + '.';
  }, routeControls);
  const all = button('Allocate dedicated channels to all lanes', () => {
    const result = routes.allocateDedicated(getLanes().map(value => value.id), { grant: Number(active.value), protocol: protocol.value }); onAssignMany(result);
    const assigned = result.filter(value => value.status === 'assigned').length; message.textContent = assigned + ' lanes assigned; ' + (result.length - assigned) + ' remain local only. Channels are never wrapped.';
  }, routeControls);
  const exportTrace = button('Save native wire trace', () => {
    const blob = new Blob([JSON.stringify(routes.wireTrace(), null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = element(document, 'a'); link.href = url; link.download = 'lemmings-native-wire-trace.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }, routeControls);
  const status = element(document, 'output', '', 'midi-status'), message = element(document, 'p', '', 'midi-help'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const details = element(document, 'p', '', 'midi-help'); details.textContent = 'A native connection does not verify the receiver or DAW. Queued, driver-submitted, receiver-observed and audible are separate stages. Receiver protocol, conversion and original hardware precision remain unknown until independently qualified.';
  root.append(controls, routeControls, status, message, details); container.append(root);
  let busy = false, selectedGrant = null, inventoryEpoch = null, laneSignature = '';
  const options = (node, rows, placeholder) => {
    const previous = node.value; node.replaceChildren(); const empty = element(document, 'option', placeholder); empty.value = ''; node.append(empty);
    for (const [value, label] of rows) { const option = element(document, 'option', label); option.value = String(value); node.append(option); } node.value = [...node.options].some(option => option.value === previous) ? previous : '';
  };
  function render() {
    if (!root.open) return;
    const state = routes.state(), connected = !!state.connectionEpoch, writable = state.grants.some(row => row.direction === 'output');
    for (const node of buttons) node.disabled = busy;
    connect.disabled ||= connected; disconnect.disabled ||= !connected; refresh.disabled ||= !connected; open.disabled ||= !connected || !state.inventory; publish.disabled ||= !connected; publishInput.disabled ||= !connected;
    switchBackend.disabled ||= !connected || !!state.grants.length; revoke.disabled ||= !state.grants.length; assign.disabled ||= !writable; all.disabled ||= !writable; exportTrace.disabled ||= !state.traceRecords;
    status.textContent = state.state + (connected ? ' · native UMP · ' + state.grants.length + ' owned connections · clock ' + state.clock.status : ' · local audio remains available');
    const capabilities = routes.client.capabilities;
    if (capabilities && backend.options.length !== capabilities.compiledApis.length + 1) options(backend, capabilities.compiledApis.map(api => [api.id, api.name]), 'Choose backend');
    if (capabilities && !backend.value) backend.value = String(capabilities.selectedApi);
    if (state.inventory?.inventoryEpoch !== inventoryEpoch) { inventoryEpoch = state.inventory?.inventoryEpoch ?? null; options(endpoint, (state.inventory?.endpoints || []).map(row => [row.endpointToken, row.name + ' · ' + row.direction + (row.groupMask == null ? ' · group support unknown' : ' · groups ' + Array.from({ length: 16 }, (_, i) => row.groupMask & 1 << i ? i + 1 : null).filter(Boolean).join(','))]), 'Choose a native device'); }
    options(active, state.grants.map(row => [row.grant, (row.endpoint?.name || 'Published ' + row.direction) + ' · ' + row.direction]), 'Choose an owned connection');
    if (selectedGrant && state.grants.some(row => row.grant === selectedGrant)) active.value = String(selectedGrant);
    const lanes = getLanes(), signature = lanes.map(value => value.id + ':' + value.name).join('|');
    if (signature !== laneSignature) { laneSignature = signature; options(lane, lanes.map(value => [value.id, value.name || value.id]), 'Choose a lane'); if (!lane.value) lane.value = getSelectedLaneId(); }
  }
  bindEvent(root, 'toggle', () => { if (root.open) render(); });
  bindEvent(active, 'change', () => { selectedGrant = Number(active.value) || null; });
  const unsubscribe = routes.subscribe(event => { if (!event && root.open) render(); }); render();
  return { render, dispose() { unsubscribe(); for (const remove of removers) remove(); root.remove(); } };
}
