import { MidiEventRouter } from '../../midi/MidiEventRouter.js';
import { cloneSafeObject } from '../../util/safeObject.js';
import { createBrowserNotePreview } from './browserNotePreview.js';

const localConfig = (source) => {
  const config = cloneSafeObject(source) || {};
  const scrub = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      if (key === 'outputId') value[key] = null;
      else scrub(value[key]);
    }
  };
  scrub(config);
  config.enabled = true;
  return config;
};

const createLocalGamePreview = ({ getLemmings = () => null, getConfig = () => ({}), immutableConfig = false, onStateChange, audio = createBrowserNotePreview() } = {}) => {
  let router = null;
  let attachedView = null;
  let generation = 0;
  let configKey = null;
  let sourceConfig = null;
  let status = 'off';
  let message = 'Browser preview is off.';
  let disposed = false;
  let disposePromise = null;

  const getState = () => ({
    status,
    message,
    enabled: status === 'live' && audio.getState().enabled,
    audio: audio.getState()
  });
  const report = (nextStatus, nextMessage) => {
    status = nextStatus;
    message = nextMessage;
    try { onStateChange?.(getState()); } catch { /* A UI error must not keep the monitor attached. */ }
  };
  const detach = () => {
    if (attachedView?.midiPreviewRouter === router) attachedView.setMidiPreviewRouter(null);
    attachedView = null;
    router?.dispose();
    router = null;
    configKey = null;
    sourceConfig = null;
  };
  const stop = () => {
    generation += 1;
    status = disposed ? 'disposed' : 'off';
    detach();
    audio.stop();
    if (!disposed) report('off', 'Browser preview is off.');
  };
  const syncConfig = () => {
    if (!router || disposed) return false;
    const source = getConfig();
    if (immutableConfig && source === sourceConfig) return false;
    const config = localConfig(source);
    const nextKey = JSON.stringify(config);
    sourceConfig = source;
    if (nextKey === configKey) return false;
    router.scheduler.allNotesOff();
    router.setMapping(config);
    configKey = nextKey;
    return true;
  };
  const unsubscribe = audio.subscribe?.(state => {
    if (status !== 'live' || state.enabled || disposed) return;
    generation += 1;
    detach();
    report('error', state.message || 'Browser audio stopped. Enable preview again.');
  });
  const start = async () => {
    if (disposed) return false;
    const view = getLemmings();
    if (view?.midiAvailable === false) return false;
    if (status === 'live' && attachedView === view && audio.getState().enabled) {
      syncConfig();
      return true;
    }
    stop();
    const request = generation;
    report('starting', 'Starting browser preview…');
    if (!view || typeof view.setMidiPreviewRouter !== 'function' || view._midiPreviewDisposed) {
      report('error', 'The game is not ready for browser preview.');
      return false;
    }
    try {
      // Invoke unlock before awaiting anything so the click still authorizes browser audio.
      const ready = audio.enable();
      if (view.midiEnabled) await view.setMidiEnabled(false);
      if (!await ready) {
        if (!disposed && request === generation) report('error', audio.getState().message);
        return false;
      }
      if (disposed || request !== generation) return false;
      if (getLemmings() !== view || view._midiPreviewDisposed) {
        audio.stop();
        report('error', 'The game changed while audio was starting. Try preview again.');
        return false;
      }
      const source = getConfig();
      const config = localConfig(source);
      router = new MidiEventRouter(config);
      router.setOutput(audio.output);
      router.setOutputs([audio.output]);
      configKey = JSON.stringify(config);
      sourceConfig = source;
      attachedView = view;
      view.setMidiPreviewRouter(router, stop);
      report('live', 'Listening to game notes in the browser. No MIDI is sent.');
      return true;
    } catch {
      if (!disposed && request === generation) {
        detach();
        audio.stop();
        report('error', 'Browser preview could not start. Try again.');
      }
      return false;
    }
  };
  const dispose = () => {
    if (disposePromise) return disposePromise;
    disposed = true;
    unsubscribe?.();
    stop();
    report('disposed', 'Browser preview is closed.');
    disposePromise = Promise.resolve(audio.dispose());
    return disposePromise;
  };
  return { start, stop, panic: stop, dispose, syncConfig, getState, audio };
};

export { createLocalGamePreview };
