const reasonText = value => String(value?.reason || value || '').replaceAll('-', ' ').slice(0, 240);
const channelsText = values => Array.isArray(values) && values.length ? values.slice(0, 16).join(', ') : 'none';

export function describeMidiRoute({ midi = {}, output = {}, outputId = null, mpe = {} } = {}) {
  const id = outputId || midi.noteOutputId;
  const route = midi.outputRoutes?.find(route => route.outputId === id);
  const zone = route?.mpeZone || midi.mpeZone;
  const requestedFailure = midi.lastConfigurationFailure;
  const failure = route?.configurationFailure || requestedFailure?.reason || route?.activationFailure || route?.mpeFailure || (zone?.ok === false ? zone.reason : null);
  const policy = zone?.voicePolicy || mpe.voicePolicy || 'steal-oldest';
  const details = [];
  if (failure) details.push(`Configuration diagnostic: ${reasonText(failure)}.`);
  let state, summary;
  if (output.selectedBackend !== 'midi') {
    state = 'local'; summary = `Browser preview ${output.enabled ? 'on' : 'off'}; MIDI note routing disabled.`;
  } else if (!output.enabled) {
    state = 'off'; summary = 'MIDI note output is off. Connect the selected destination to start.';
  } else if (!id || !route) {
    state = 'unavailable'; summary = id ? 'Selected MIDI route is unavailable.' : 'No MIDI note destination selected.';
  } else if (route.ownedVoiceAdmissionReady === false) {
    state = 'rejected'; summary = 'MIDI note admission blocked: an owned release is unconfirmed.';
  } else if (failure) {
    state = 'rejected'; summary = `MIDI setup rejected: ${reasonText(failure)}.`;
    if (requestedFailure?.retained) details.push('The requested configuration was refused; the previous route configuration is retained.');
  } else if (!route.available || !route.authorized || !route.active) {
    state = route.state || 'unavailable'; summary = `MIDI route ${reasonText(state)}; no new note admission.`;
  } else if (zone) {
    state = route.mpeReady === true ? 'mpe-ready' : 'setup-pending';
    summary = state === 'mpe-ready' ? `MPE ${zone.zone} zone ready for application admission.` : 'MPE setup is pending; receiver behavior is unverified.';
  } else if (mpe.enabled) {
    state = 'setup-pending'; summary = 'MPE requested; no admitted member zone; no automatic shared-channel fallback.';
  } else {
    state = 'shared'; summary = 'Shared MIDI 1 expression; bends and controllers affect the whole channel.';
  }
  if (id) details.push(`Destination: ${route?.name || id}.`);
  if (zone) {
    details.push(`Manager ${zone.managerChannel}; members ${channelsText(zone.memberChannels)}; reserved channels ${channelsText(zone.reservedChannels)}.`);
    if (zone.memberRange && zone.managerRange) details.push(`Bend ranges: members ${zone.memberRange.semitones + zone.memberRange.cents / 100}, manager ${zone.managerRange.semitones + zone.managerRange.cents / 100} semitones.`);
    if (route?.mpeEvidence === 'zone-configuration-api-accepted') details.push('Zone setup messages accepted by the output API; receiver unverified.');
    else if (route?.mpeEvidence === 'manual-zone-api-accepted') details.push('Manual zone assumed; pitch-range messages accepted by the output API; receiver unverified.');
    else details.push('Zone setup has no acceptance evidence; receiver unverified.');
  } else if (mpe.enabled) details.push('MPE requested; no admitted zone configuration.');
  if (zone || mpe.enabled) details.push(`Member exhaustion: ${policy === 'reject' ? 'reject the new voice' : 'release the oldest member before replacement'}. No automatic fallback to the manager or shared expression.`);
  return { state, summary, details: details.join(' '), mpeEnabled: !!mpe.enabled, policy, configuration: mpe.configuration || 'manual' };
}

export function createMidiRouteDiagnostics({ document, onPolicy }) {
  let disposed = false;
  const element = document.createElement('section'), status = document.createElement('output'), detail = document.createElement('p');
  element.className = 'studio-midi-route'; element.setAttribute('aria-label', 'MIDI route diagnostics');
  status.className = 'studio-midi-route-status'; status.setAttribute('aria-live', 'polite');
  detail.className = 'studio-hint'; element.append(status, detail);
  const controls = document.createElement('div'), buttons = new Map();
  for (const [policy, label] of [['reject', 'Reject when members are full'], ['steal-oldest', 'Steal oldest member'], ['shared', 'Use shared MIDI 1 expression'], ['local', 'Select browser preview'], ['manual', 'Assume manual MPE zone'], ['send-zone', 'Send MPE zone setup']]) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => { if (!disposed) onPolicy?.(policy); }); controls.append(button); buttons.set(policy, button);
  }
  element.append(controls);
  return { element, dispose() { disposed = true; }, update(snapshot) {
    if (disposed) return null;
    const current = describeMidiRoute(snapshot);
    if (status.textContent !== current.summary) status.textContent = current.summary;
    if (detail.textContent !== current.details) detail.textContent = current.details;
    element.dataset.state = current.state;
    for (const [policy, button] of buttons) {
      button.hidden = policy !== 'local' && !current.mpeEnabled;
      if (['reject', 'steal-oldest', 'manual', 'send-zone'].includes(policy)) button.setAttribute('aria-pressed', String(policy === current.policy || policy === current.configuration));
    }
    return current;
  } };
}
