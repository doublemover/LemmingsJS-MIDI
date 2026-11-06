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
  const button = (text, action, parent = controls, urgent = false) => {
    const node = element(document, 'button', text); node.type = 'button'; buttons.push(node);
    bindEvent(node, 'click', async () => { if (busy && !urgent) return; const operation = ++operationSerial; busy = true; render(); try { await action(); } catch (error) { if (operation === operationSerial) { message.textContent = error.message; onStatus(error.message); } } finally { if (operation === operationSerial) busy = false; render(); } }); parent.append(node); return node;
  };
  const bridgeUrl = input('Companion address', routes.client.url, 'url'), pairing = input('Local pairing code', '', 'password'); pairing.autocomplete = 'off'; pairing.spellcheck = false;
  const connect = button('Pair companion', async () => { routes.client.setUrl(bridgeUrl.value); const pairingCode = pairing.value; pairing.value = ''; await routes.connect({ pairingCode }); await routes.enumerate(); message.textContent = 'Paired. Select a device or publish a performance source.'; });
  const disconnect = button('Disconnect companion', () => routes.disconnect(), controls, true);
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
  const revoke = button('Revoke connection / unpublish', async () => { if (!active.value) throw new Error('Select an owned connection'); await routes.closeGrant(Number(active.value)); message.textContent = 'Connection revoked; owned notes cleaned up by the companion.'; }, routeControls, true);
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
  const ciInput = select('CI receive connection', routeControls), ciPeer = select('Discovered peer', routeControls);
  const showCi = () => {
    const state = ciSession?.state(); ciStatus.textContent = state ? 'Device discovery: ' + state.status + (state.reason ? ' · ' + state.reason : '') + ' · ' + state.peers.length + ' peers' : 'Device features unknown. Discovery requires separately selected SysEx input and output grants.';
    options(ciPeer, (state?.peers || []).map(peer => [peer.muid, 'Peer 0x' + peer.muid.toString(16).padStart(7, '0') + ' · CI v' + peer.version + ' · ' + peer.freshness]), 'Choose a discovered peer');
  };
  const ensureCi = async () => {
    const selected = { inputGrant: Number(ciInput.value), outputGrant: Number(active.value), group: Number(group.value) }, previous = ciSession?.state();
    if (ciSession && (previous.inputGrant !== selected.inputGrant || previous.outputGrant !== selected.outputGrant || previous.group !== selected.group || ['stale', 'disposed'].includes(previous.status))) {
      ciUnsubscribe?.(); ciUnsubscribe = null; await routes.closeCiSession(ciSession); ciSession = null;
    }
    if (!ciSession) { ciSession = routes.createCiSession(selected); ciUnsubscribe = ciSession.subscribe(showCi); showCi(); } return ciSession;
  };
  const ciDiscover = button('Discover device features (SysEx)', async () => { const session = await ensureCi(); await session.discover(); showCi(); }, routeControls);
  const ciInformation = button('Read endpoint information', async () => { if (!ciSession || !ciPeer.value) throw new Error('Discover and select a current peer'); const reply = await ciSession.endpointInformation(Number(ciPeer.value)); message.textContent = 'Endpoint information received: ' + reply.informationData.length + ' bytes.'; showCi(); }, routeControls);
  const ciProcess = button('Read Process Inquiry support', async () => { if (!ciSession || !ciPeer.value) throw new Error('Discover and select a current peer'); const reply = await ciSession.processCapabilities(Number(ciPeer.value)); message.textContent = 'Device Process Inquiry feature bitmap: 0x' + reply.supportedFeatures.toString(16) + '.'; showCi(); }, routeControls);
  const ciClose = button('Close device discovery', async () => { ciUnsubscribe?.(); ciUnsubscribe = null; if (ciSession) await routes.closeCiSession(ciSession); ciSession = null; showCi(); }, routeControls);
  const profileScope = select('Profile scope', routeControls);
  for (const [value, label] of [['channel', 'Selected channel / manager'], ['126', 'Selected group'], ['127', 'Function block — all profiles']]) { const option = element(document, 'option', label); option.value = value; profileScope.append(option); }
  const profileChoice = select('Device profile', routeControls), profileChannels = input('Requested profile channels (including manager)', '2', 'number', routeControls);
  profileChannels.min = '1'; profileChannels.max = '256'; profileChannels.step = '1';
  const profileConsent = input('Apply this profile change to the selected device; playback is stopped and controllers may be reassigned', '', 'checkbox', routeControls);
  const selectedProfile = () => profileSession?.state().profiles.find(row => [row.group, row.scope, row.id].join(':') === profileChoice.value) || null;
  const showProfiles = () => {
    const state = profileSession?.state(), previous = profileChoice.value;
    options(profileChoice, (state?.profiles || []).map(row => [[row.group, row.scope, row.id].join(':'), (row.specification?.name || 'Unreviewed profile ' + row.id.match(/../g).join(' ')) +
      ' · group ' + (row.group + 1) + ' · ' + (row.scope < 16 ? 'channel ' + (row.scope + 1) : row.scope === 126 ? 'group scope' : 'function-block scope') +
      ' · ' + (row.enabled == null ? 'unknown' : row.enabled ? 'enabled' : 'disabled') + (row.channels == null ? '' : ' · ' + row.channels + ' channels') + (row.origin === 'changed-externally' ? ' · changed externally' : '')]), 'Read and select a profile');
    if (previous !== profileChoice.value) profileConsent.checked = false;
    const row = selectedProfile(), result = state?.latest, mutable = !!row?.specification && row.group === state?.group && row.freshness === 'current' && row.supported;
    profileStatus.textContent = state ? 'Device profiles: ' + state.profiles.length + ' · ' + (state.busy ? 'pending' : result?.status || 'idle') + (result?.reason ? ' · ' + result.reason : '') +
      (row?.allocation ? ' · channel allocation ' + row.allocation.current + ' / ' + row.allocation.maximum : '') +
      (row ? ' · ' + (row.specification?.revision || 'Unreviewed specification; read-only inspection') : '') : 'Device profiles are unknown until queried.';
    profileEnable.disabled = busy || !mutable || !profileConsent.checked; profileDisable.disabled = busy || !mutable || !profileConsent.checked;
    profileDetails.disabled = busy || !row || row.group !== state?.group; profileCancel.disabled = !state?.busy;
  };
  const ensureProfile = async () => {
    const session = await ensureCi(), peerMuid = Number(ciPeer.value);
    if (!ciPeer.value) throw new Error('Discover and select a current Profile Configuration peer');
    if (!profileSession || profileCi !== session || profileSession.state().peerMuid !== peerMuid) {
      profileUnsubscribe?.(); profileUnsubscribe = null; profileSession = routes.createProfileSession(session, peerMuid); profileCi = session;
      profileUnsubscribe = profileSession.subscribe(showProfiles); profileConsent.checked = false;
    }
    return profileSession;
  };
  const profileRead = button('Read supported device profiles', async () => { const session = await ensureProfile(); const result = await session.inquire(profileScope.value === 'channel' ? Number(channel.value) : Number(profileScope.value)); message.textContent = result.reason || 'Profile inquiry: ' + result.status; showProfiles(); }, routeControls);
  const profileDetails = button('Read profile channel allocation', async () => { const session = await ensureProfile(), row = selectedProfile(); if (!row || row.group !== session.state().group) throw new Error('Select a profile in the current group'); const result = await session.details(row.profile, row.scope, 0); message.textContent = result.reason || 'Channel allocation: ' + result.status; showProfiles(); }, routeControls);
  const changeProfile = async enabled => {
    const session = await ensureProfile(), row = selectedProfile(); if (!row || row.group !== session.state().group) throw new Error('Select a reviewed profile in the current group');
    const result = await session.setEnabled({ profile: row.profile, scope: row.scope, enabled, channels: Number(profileChannels.value), confirmed: profileConsent.checked });
    profileConsent.checked = false; message.textContent = result.reason || (result.status === 'ok' ? 'Device reported the requested profile state. Review its accepted channel count, then explicitly reassign affected native lanes.' : 'Profile change: ' + result.status); showProfiles();
  };
  const profileEnable = button('Enable selected profile', () => changeProfile(true), routeControls), profileDisable = button('Disable selected profile', () => changeProfile(false), routeControls);
  const profileCancel = button('Cancel profile request', () => { profileSession?.cancel(); showProfiles(); }, routeControls, true);
  bindEvent(profileChoice, 'change', () => { profileConsent.checked = false; showProfiles(); }); bindEvent(profileConsent, 'change', showProfiles);
  const isolated = checkbox('Device idle; no other playback, controller or Thru traffic');
  const showReport = () => {
    const state = reportSession?.state(), result = state?.latest; cancelState.disabled = !state?.busy; reportStatus.textContent = state ? 'Controller state: ' + state.phase + (state.probe ? ' · checking reportable categories' : '') + (result?.reason ? ' · ' + result.reason : '') : 'Controller state is unknown until an isolated report completes.';
    reportValues.replaceChildren();
    if (!result?.observation) return;
    const observation = result.observation;
    reportValues.append(element(document, 'p', observation.values.length + ' reported values · ' + observation.conflicts.length + ' newer local-edit conflicts · unreported values remain unknown.', 'midi-help'));
    const table = element(document, 'table'), head = element(document, 'tr');
    for (const label of ['Group / channel', 'Reported control', 'Raw value', 'Wire bits']) head.append(element(document, 'th', label)); table.append(head);
    for (const entry of observation.values.slice(0, 64)) { const row = element(document, 'tr'); for (const text of [(entry.group + 1) + ' / ' + (entry.channel == null ? '—' : entry.channel + 1), entry.kind + (entry.index === '' ? '' : ' ' + entry.index), String(entry.value), String(entry.wireBits)]) row.append(element(document, 'td', text)); table.append(row); }
    reportValues.append(table); if (observation.values.length > 64) reportValues.append(element(document, 'p', 'Showing the first 64 values. The original input trace retains the received packets.', 'midi-help'));
  };
  const readState = button('Read selected channel state', async () => {
    const session = await ensureCi(); if (!ciPeer.value) throw new Error('Discover and select a current peer');
    if (reportSession && reportCi !== session) { reportUnsubscribe?.(); reportSession = null; reportCi = null; }
    if (!reportSession) { reportSession = routes.createMessageReportSession(session); reportCi = session; reportUnsubscribe = reportSession.subscribe(showReport); }
    const owner = reportSession;
    const result = await owner.read({ peerMuid: Number(ciPeer.value), channel: Number(channel.value), controllers: 63, quiescent: isolated.checked });
    if (owner !== reportSession) return; message.textContent = result.status === 'complete' ? 'Read-only controller state received; authored settings remain separate.' : result.reason || result.status; showReport();
  }, routeControls);
  const cancelState = button('Cancel state read', () => reportSession?.cancel(), routeControls, true);
  const exportInput = button('Save native input trace', () => {
    const blob = new Blob([JSON.stringify(routes.input.trace(), null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = element(document, 'a'); link.href = url; link.download = 'lemmings-native-input-trace.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }, routeControls);
  const status = element(document, 'output', '', 'midi-status'), message = element(document, 'p', '', 'midi-help'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const details = element(document, 'p', '', 'midi-help'); details.textContent = 'A native connection does not verify the receiver or DAW. Queued, driver-submitted, receiver-observed and audible are separate stages. Receiver protocol, conversion and original hardware precision remain unknown until independently qualified.';
  const inputStatus = element(document, 'output', '', 'midi-status'); inputStatus.setAttribute('aria-live', 'off');
  const ciStatus = element(document, 'output', '', 'midi-status'); ciStatus.setAttribute('role', 'status'); ciStatus.setAttribute('aria-live', 'polite');
  const reportStatus = element(document, 'output', '', 'midi-status'), reportValues = element(document, 'div'); reportStatus.setAttribute('role', 'status'); reportStatus.setAttribute('aria-live', 'polite');
  const profileStatus = element(document, 'output', '', 'midi-status'); profileStatus.setAttribute('role', 'status'); profileStatus.setAttribute('aria-live', 'polite');
  root.append(controls, routeControls, status, inputStatus, ciStatus, profileStatus, reportStatus, reportValues, message, details); container.append(root);
  let profileSession = null, profileCi = null, profileUnsubscribe = null;
  let reportSession = null, reportCi = null, reportUnsubscribe = null, ciSession = null, ciUnsubscribe = null, inputTimer = null;
  const renderInput = () => { const input = routes.input.state(); inputStatus.textContent = input.receivedPackets + ' native input packets · ' + input.losses + ' loss boundaries' + (input.lastObservation ? ' · ' + input.lastObservation.category : ''); };
  let operationSerial = 0, busy = false, selectedGrant = null, inventoryEpoch = null, laneSignature = '';
  const options = (node, rows, placeholder) => {
    const previous = node.value; node.replaceChildren(); const empty = element(document, 'option', placeholder); empty.value = ''; node.append(empty);
    for (const [value, label] of rows) { const option = element(document, 'option', label); option.value = String(value); node.append(option); } node.value = [...node.options].some(option => option.value === previous) ? previous : '';
  };
  function render() {
    if (!root.open) return;
    const state = routes.state(), connected = !!state.connectionEpoch, writable = state.grants.some(row => row.direction === 'output');
    for (const node of buttons) node.disabled = busy;
    connect.disabled ||= connected; disconnect.disabled = !connected; refresh.disabled ||= !connected; open.disabled ||= !connected || !state.inventory; publish.disabled ||= !connected; publishInput.disabled ||= !connected;
    switchBackend.disabled ||= !connected || !!state.grants.length; revoke.disabled = !state.grants.length; assign.disabled ||= !writable; all.disabled ||= !writable; exportTrace.disabled ||= !state.traceRecords; exportInput.disabled ||= !state.ingress.receivedPackets; renderInput();
    status.textContent = state.state + (connected ? ' · native UMP · ' + state.grants.length + ' owned connections · clock ' + state.clock.status : ' · local audio remains available');
    const capabilities = routes.client.capabilities;
    const ciReady = !!capabilities?.ciCodec && connected && state.grants.some(row => row.direction === 'input' && (row.permissions & 1)) && state.grants.some(row => row.direction === 'output' && (row.permissions & 1));
    ciDiscover.disabled ||= !ciReady; ciInformation.disabled ||= !ciSession; ciProcess.disabled ||= !ciSession; ciClose.disabled ||= !ciSession; readState.disabled ||= !ciReady || capabilities?.ciMessageReportCodecVersion !== 1; cancelState.disabled = !reportSession?.state().busy; showReport(); profileRead.disabled ||= !ciReady || capabilities?.ciProfileCodecVersion !== 1; showProfiles();
    options(ciInput, state.grants.filter(row => row.direction === 'input' && (row.permissions & 1)).map(row => [row.grant, row.endpoint?.name || 'Published control input']), 'Choose a SysEx input'); showCi();
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
  const unsubscribe = routes.subscribe(event => { if (!root.open) return; if (!event) render(); else if (inputTimer == null) inputTimer = setTimeout(() => { inputTimer = null; if (root.open) { renderInput(); exportInput.disabled = busy || !routes.input.state().receivedPackets; } }, 50); }); render();
  return { render, dispose() { unsubscribe(); profileUnsubscribe?.(); profileUnsubscribe = null; ciUnsubscribe?.(); ciUnsubscribe = null; reportUnsubscribe?.(); reportUnsubscribe = null; clearTimeout(inputTimer); inputTimer = null; for (const remove of removers) remove(); root.remove(); } };
}
