import { MidiEventRouter } from '../../midi/MidiEventRouter.js';
import { cloneSafeObject } from '../../util/safeObject.js';

const audibilityKey = config => JSON.stringify({ enabled: config.enabled, mpe: config.mpe, defaultChannel: config.defaultChannel,
  sfx: Object.entries(config.sfx || {}).map(([id, source]) => [id, source?.disabled, source?.channel, source?.outputId, source?.trackId]),
  triggers: Object.entries(config.triggers || {}).map(([id, source]) => [id, source?.disabled, source?.channel, source?.outputId, source?.trackId]),
  ensemble: config.ensemble ? { enabled: config.ensemble.enabled, sourceTrackId: config.ensemble.sourceTrackId,
    roles: config.ensemble.roles?.map(role => [role.trackId, role.disabled, role.track?.channel, role.track?.outputId]) } : null });

// Both destinations lower the existing project through one game-event router.
// Permission is requested only by explicit discovery or activation.
const createProcgenMidiOutput = ({ local, getView, getConfig, getWebMidi, backend = 'synth', canActivate = () => true, onStateChange = () => {}, onDevicesChange = () => {} }) => {
  let selected = backend === 'midi' ? 'midi' : 'synth', outputId = null, output = null, reviewedName = null;
  let router = null, attached = null, capture = null, generation = 0, disposed = false;
  let configKey = null, audibleKey = null;
  let status = 'off', message = 'MIDI output is off.', permission = 'unknown', failureKind = null, discovery = null, discoverySerial = 0;
  const stateListeners = new Set();
  const devices = () => Array.from(getWebMidi()?.outputs || []).filter(port => port.state !== 'disconnected');
  const failureMessage = error => 'MIDI output failed: ' + error + '. Check the device and connect again.';
  const getState = (compact = false) => {
    if (selected === 'synth') {
      const state = compact && local.getOperationalState ? local.getOperationalState() : local.getState(); return { ...state, selectedBackend: selected,
        backend: state.enabled ? 'local-browser-audio' : 'no-active-output', outputId: null, outputName: null, outputGeneration: generation };
    }
    const error = router?.scheduler?.lastOutputError, permissionLost = !!output && !getWebMidi()?.enabled, nextStatus = error || permissionLost ? 'error' : status, available = devices();
    return { status: nextStatus, message: error ? failureMessage(error) : permissionLost ? 'MIDI access is no longer granted. Discover again, then reactivate the reviewed destination.' : message, enabled: ['live', 'suspended'].includes(nextStatus), selectedBackend: selected,
      backend: error || permissionLost ? 'midi-output-error' : ['live', 'suspended'].includes(status) ? 'web-midi' : 'no-active-output',
      outputId: output?.id || null, outputName: output?.name || null, selectedOutputId: outputId, outputGeneration: generation,
      failureKind: error ? 'api-send' : permissionLost ? 'permission-revoked' : failureKind, selectedOutputName: available.find(port => port.id === outputId)?.name || reviewedName, discoveredOutputCount: available.length,
      midiPermission: !getWebMidi() || getWebMidi().supported === false ? 'unavailable' : getWebMidi().enabled ? 'granted' : permission, audio: compact && local.audio.getOperationalState ? local.audio.getOperationalState() : local.audio.getState() };
  };
  const notifyState = () => {
    const state = Object.freeze(getState());
    try { onStateChange(state); } catch { /* Presentation cannot retain a MIDI connection. */ }
    for (const listener of [...stateListeners]) { try { listener(state); } catch { /* Subscribers cannot block route ownership. */ } }
  };
  const report = (next, text, kind = null) => { status = next; message = text; failureKind = kind; notifyState(); };
  const detach = () => { if (attached?.midiPreviewRouter === router) attached.setMidiPreviewRouter(null); router?.dispose(); router = null; attached = null; configKey = null; audibleKey = null; };
  const stop = () => { generation++; discoverySerial++; discovery = null; if (permission === 'requesting') permission = 'unknown'; detach(); output = null; local.stop(); report('off', selected === 'midi' ? 'MIDI output is off.' : 'Browser preview is off.'); };
  // Called by the existing metrics cadence; status reads themselves never mutate playback.
  const syncStatus = () => {
    if (selected !== 'midi' || !router || !router.scheduler?.lastOutputError && getWebMidi()?.enabled) return false;
    const error = router.scheduler?.lastOutputError; generation++; detach(); output = null;
    report('error', error ? failureMessage(error) : 'MIDI access is no longer granted. Discover again, then reactivate the reviewed destination.', error ? 'api-send' : 'permission-revoked'); return true;
  };
  const mapping = () => {
    const config = cloneSafeObject(getConfig()) || {};
    const scrub = value => { if (!value || typeof value !== 'object') return; for (const key of Object.keys(value)) { if (key === 'outputId') value[key] = null; else scrub(value[key]); } };
    scrub(config); config.enabled = true; return config;
  };
  const attach = view => {
    const config = mapping(); router = new MidiEventRouter(config); configKey = JSON.stringify(config); audibleKey = audibilityKey(config);
    router.setCapture(capture); router.setOutput(output); router.setOutputs([output]);
    attached = view; view.setMidiPreviewRouter(router);
    if (syncStatus()) return false;
    report('live', 'Sending game notes to ' + (output.name || output.id) + '. Browser synth is off.'); return true;
  };
  const refreshDevices = () => {
    const ports = devices(); onDevicesChange(ports, outputId);
    if (output && !ports.some(port => port.id === output.id)) { stop(); report('error', 'MIDI device disconnected. Choose a connected output and activate again.', 'destination-missing'); }
    return ports;
  };
  const validView = view => view && !view._midiPreviewDisposed && typeof view.setMidiPreviewRouter === 'function';
  const discover = () => {
    if (disposed || selected !== 'midi') return Promise.resolve([]);
    if (discovery) return discovery;
    if (output && !getWebMidi()?.enabled) syncStatus();
    const webMidi = getWebMidi(), request = ++discoverySerial, sourceGeneration = generation;
    if (!webMidi || webMidi.supported === false) { permission = 'unavailable'; report('error', 'Web MIDI is unavailable. Choose browser listening.', 'unsupported'); return Promise.resolve([]); }
    const active = !!output;
    if (!webMidi.enabled) permission = 'requesting';
    if (!active) report('discovering', 'Discovering MIDI outputs. No destination is activated.'); else notifyState();
    const operation = (async () => {
      try {
        if (!webMidi.enabled) await webMidi.enable({ sysex: false });
        if (disposed || request !== discoverySerial || sourceGeneration !== generation || selected !== 'midi') return [];
        if (!webMidi.enabled) { permission = 'error'; report('error', 'MIDI access did not become available. Review host permission before retrying.', 'discovery'); return []; }
        permission = 'unknown';
        const available = refreshDevices();
        if (request !== discoverySerial || sourceGeneration !== generation) return available;
        if (outputId && !available.some(port => port.id === outputId)) { report('error', 'The reviewed MIDI destination is unavailable. Choose a connected output.', 'destination-missing'); return available; }
        if (!output) report(outputId ? 'selected' : 'needs-selection', !available.length ? 'No MIDI outputs discovered. Connect a device and discover again.' :
          outputId ? 'Review the selected MIDI destination, then activate it.' : 'Choose a named MIDI output, then activate that destination.');
        return available;
      } catch (error) {
        if (!disposed && request === discoverySerial && sourceGeneration === generation && selected === 'midi') {
          permission = error?.name === 'NotAllowedError' ? 'denied' : 'error';
          if (!output) report('error', permission === 'denied' ? 'MIDI permission denied. Check browser permissions or choose browser listening.' : 'MIDI discovery failed: ' + (error?.message || 'check device access.'), permission === 'denied' ? 'permission-denied' : 'discovery');
          else notifyState();
        }
        return [];
      }
    })();
    discovery = operation; operation.finally(() => { if (discovery === operation) discovery = null; }); return operation;
  };
  const start = async () => {
    if (disposed) return false;
    if (selected === 'synth') return local.start();
    if (!outputId) { await discover(); return false; }
    if (!canActivate()) return false;
    stop(); const request = generation, destination = outputId, webMidi = getWebMidi(), view = getView();
    if (!webMidi || webMidi.supported === false) { permission = 'unavailable'; report('error', 'Web MIDI is unavailable. Choose browser listening.', 'unsupported'); return false; }
    if (!validView(view)) { report('error', 'The game is not ready. Activate the selected destination after loading.', 'world-unavailable'); return false; }
    report('starting', 'Activating the selected MIDI destination.');
    try {
      if (!webMidi.enabled) { permission = 'requesting'; await webMidi.enable({ sysex: false }); }
      if (disposed || request !== generation || selected !== 'midi' || outputId !== destination) return false;
      if (!canActivate()) { report('selected', 'Activation was not published. Review the current performance state before routing.'); return false; }
      if (getView() !== view || !validView(view)) { report('error', 'The game changed while MIDI was connecting. Activate again after loading.', 'world-changed'); return false; }
      if (!webMidi.enabled) { permission = 'error'; report('error', 'MIDI access did not become available. Review host permission before retrying.', 'activation'); return false; }
      permission = 'unknown';
      const ports = refreshDevices(); output = ports.find(port => port.id === destination) || null;
      if (!output) { report('error', 'No selected MIDI output is connected. Choose a connected destination and activate it.', 'destination-missing'); return false; }
      reviewedName = output.name || output.id; onDevicesChange(ports, outputId); return attach(view);
    } catch (error) {
      if (!disposed && request === generation) {
        detach(); output = null; permission = error?.name === 'NotAllowedError' ? 'denied' : 'error';
        report('error', permission === 'denied' ? 'MIDI permission denied. Check browser permissions or choose browser listening.' : 'MIDI could not connect: ' + (error?.message || 'check device access.'), permission === 'denied' ? 'permission-denied' : 'activation');
      }
      return false;
    }
  };
  const suspendGame = () => {
    if (selected === 'synth') return local.suspendGame();
    if (['starting', 'discovering'].includes(status)) { stop(); report('off', 'MIDI connection canceled while the game changed. Connect again when ready.'); return false; }
    if (syncStatus()) return false;
    if (status !== 'live') return status === 'suspended';
    generation++; detach(); report('suspended', 'MIDI will resume with the current game.'); return true;
  };
  const resumeGame = async () => {
    if (disposed) return false;
    if (selected === 'synth') return local.resumeGame();
    if (status !== 'suspended') return false;
    if (!getWebMidi()?.enabled) { stop(); report('error', 'MIDI access is no longer enabled. Connect again.'); return false; }
    if (!refreshDevices().some(port => port.id === output?.id)) return false;
    const view = getView(); if (!validView(view)) return false;
    try { return attach(view); } catch (error) { detach(); output = null; report('error', 'MIDI could not resume: ' + (error?.message || 'connect again.')); return false; }
  };
  const disconnected = () => refreshDevices();
  getWebMidi()?.addListener?.('disconnected', disconnected); getWebMidi()?.addListener?.('connected', disconnected);
  return { audio: local.audio, start, discover, stop, panic: stop, getState, getOperationalState: () => Object.freeze(getState(true)), syncStatus, suspendGame, resumeGame, refreshDevices,
    localStateChanged: () => { if (selected === 'synth') notifyState(); },
    subscribe(listener) { if (disposed || typeof listener !== 'function') return () => {}; if (!stateListeners.has(listener) && stateListeners.size >= 32) throw new Error('Output state subscription capacity exceeded.'); stateListeners.add(listener); return () => stateListeners.delete(listener); },
    setBackend(value) { const next = value === 'midi' ? 'midi' : 'synth'; if (next !== selected) { stop(); selected = next; report('off', next === 'midi' ? 'MIDI output is off. Connect to start.' : 'Browser preview is off.'); } },
    setOutputId(id) { const next = typeof id === 'string' && id ? id : null; if (next === outputId) return; stop(); outputId = next; reviewedName = devices().find(port => port.id === next)?.name || next; report(next ? 'selected' : 'needs-selection', next ? 'MIDI destination selected. Activate it to start output.' : 'Choose a named MIDI output before activation.'); onDevicesChange(devices(), outputId); },
    setCapture(value) { capture = value; local.setCapture(value); router?.setCapture(value); },
    syncConfig() {
      if (selected === 'synth') return local.syncConfig();
      if (!router || syncStatus()) return false;
      const config = mapping(), nextKey = JSON.stringify(config);
      if (nextKey === configKey) return false;
      const nextAudible = audibilityKey(config);
      if (nextAudible !== audibleKey) router.scheduler.allNotesOff({ preserveRateHistory: true });
      router.setMapping(config); configKey = nextKey; audibleKey = nextAudible; return true;
    },
    dispose() { disposed = true; stop(); stateListeners.clear(); getWebMidi()?.removeListener?.('disconnected', disconnected); getWebMidi()?.removeListener?.('connected', disconnected); return local.dispose(); }
  };
};
export { createProcgenMidiOutput };
