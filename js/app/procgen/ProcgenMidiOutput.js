import { MidiEventRouter } from '../../midi/MidiEventRouter.js';
import { cloneSafeObject } from '../../util/safeObject.js';

const audibilityKey = config => JSON.stringify({ enabled: config.enabled, mpe: config.mpe, defaultChannel: config.defaultChannel,
  sfx: Object.entries(config.sfx || {}).map(([id, source]) => [id, source?.disabled, source?.channel, source?.outputId, source?.trackId]),
  triggers: Object.entries(config.triggers || {}).map(([id, source]) => [id, source?.disabled, source?.channel, source?.outputId, source?.trackId]),
  ensemble: config.ensemble ? { enabled: config.ensemble.enabled, sourceTrackId: config.ensemble.sourceTrackId,
    roles: config.ensemble.roles?.map(role => [role.trackId, role.disabled, role.track?.channel, role.track?.outputId]) } : null });

// Both destinations lower the existing project through one game-event router.
// Permission is requested only by start(), from the explicit Connect action.
const createProcgenMidiOutput = ({ local, getView, getConfig, getWebMidi, backend = 'synth', onStateChange = () => {}, onDevicesChange = () => {} }) => {
  let selected = backend === 'midi' ? 'midi' : 'synth', outputId = null, output = null;
  let router = null, attached = null, capture = null, generation = 0, disposed = false;
  let configKey = null, audibleKey = null;
  let status = 'off', message = 'MIDI output is off.';
  const devices = () => Array.from(getWebMidi()?.outputs || []).filter(port => port.state !== 'disconnected');
  const failureMessage = error => 'MIDI output failed: ' + error + '. Check the device and connect again.';
  const getState = () => {
    if (selected === 'synth') {
      const state = local.getState(); return { ...state, selectedBackend: selected,
        backend: state.enabled ? 'local-browser-audio' : 'no-active-output', outputId: null, outputName: null };
    }
    const error = router?.scheduler?.lastOutputError, nextStatus = error ? 'error' : status;
    return { status: nextStatus, message: error ? failureMessage(error) : message, enabled: ['live', 'suspended'].includes(nextStatus), selectedBackend: selected,
      backend: error ? 'midi-output-error' : ['live', 'suspended'].includes(status) ? 'web-midi' : 'no-active-output',
      outputId: output?.id || null, outputName: output?.name || null, audio: local.audio.getState() };
  };
  const report = (next, text) => { status = next; message = text; onStateChange(getState()); };
  const detach = () => { if (attached?.midiPreviewRouter === router) attached.setMidiPreviewRouter(null); router?.dispose(); router = null; attached = null; configKey = null; audibleKey = null; };
  const stop = () => { generation++; detach(); output = null; local.stop(); report('off', selected === 'midi' ? 'MIDI output is off.' : 'Browser preview is off.'); };
  // Called by the existing metrics cadence; status reads themselves never mutate playback.
  const syncStatus = () => {
    if (selected !== 'midi' || !router?.scheduler?.lastOutputError) return false;
    const error = router.scheduler.lastOutputError; generation++; detach(); output = null; report('error', failureMessage(error)); return true;
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
    if (output && !ports.some(port => port.id === output.id)) { stop(); report('error', 'MIDI device disconnected. Choose a connected output and connect again.'); }
    return ports;
  };
  const validView = view => view && !view._midiPreviewDisposed && typeof view.setMidiPreviewRouter === 'function';
  const start = async () => {
    if (disposed) return false;
    if (selected === 'synth') return local.start();
    stop(); const request = generation, webMidi = getWebMidi(), view = getView();
    if (!webMidi) { report('error', 'Web MIDI is unavailable. Use browser listening or a browser with Web MIDI.'); return false; }
    if (!validView(view)) { report('error', 'The game is not ready. Connect again when it has loaded.'); return false; }
    report('starting', 'Connecting MIDI output.');
    try {
      if (!webMidi.enabled) await webMidi.enable({ sysex: false });
      if (disposed || request !== generation || selected !== 'midi') return false;
      if (getView() !== view || !validView(view)) { report('error', 'The game changed while MIDI was connecting. Connect again after loading.'); return false; }
      const ports = refreshDevices(); output = outputId ? ports.find(port => port.id === outputId) : ports[0];
      if (!output) { report('error', 'No selected MIDI output is connected. Connect a device and try again.'); return false; }
      outputId = output.id; onDevicesChange(ports, outputId);
      return attach(view);
    } catch (error) {
      if (!disposed && request === generation) { detach(); output = null; report('error', error?.name === 'NotAllowedError' ? 'MIDI permission denied. Check browser permissions or choose browser listening.' : 'MIDI could not connect: ' + (error?.message || 'check your device and browser permissions.')); }
      return false;
    }
  };
  const suspendGame = () => {
    if (selected === 'synth') return local.suspendGame();
    if (status === 'starting') { stop(); report('off', 'MIDI connection canceled while the game changed. Connect again when ready.'); return false; }
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
  getWebMidi()?.addListener?.('disconnected', disconnected);
  return { audio: local.audio, start, stop, panic: stop, getState, syncStatus, suspendGame, resumeGame, refreshDevices,
    localStateChanged: () => { if (selected === 'synth') onStateChange(getState()); },
    setBackend(value) { const next = value === 'midi' ? 'midi' : 'synth'; if (next !== selected) { stop(); selected = next; report('off', next === 'midi' ? 'MIDI output is off. Connect to start.' : 'Browser preview is off.'); } },
    setOutputId(id) { if (id === outputId) return; stop(); outputId = id || null; report('off', 'MIDI device selected. Connect to start.'); },
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
    dispose() { disposed = true; stop(); getWebMidi()?.removeListener?.('disconnected', disconnected); return local.dispose(); }
  };
};
export { createProcgenMidiOutput };
