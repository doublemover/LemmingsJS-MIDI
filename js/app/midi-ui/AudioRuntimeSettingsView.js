const milliseconds = seconds => Number.isFinite(seconds) ? (seconds * 1000).toFixed(1) + ' ms' : 'unknown';
const durationMs = value => Number.isFinite(value) ? value.toFixed(1) + ' ms' : 'unknown';
const correlationFreshness = { 'context-not-running': 'audio is stopped or suspended', 'hidden-or-unknown': 'page is hidden or visibility is unknown',
  'context-changed-or-unavailable': 'waiting for the current audio context', unavailable: 'not yet correlated', available: 'current observation', 'stale-or-invalid': 'observation is stale or invalid' };
const outcomeText = result => {
  if (result?.requiresEnable) return 'Audio settings applied. Enable browser audio to continue; held notes and old queues were stopped.';
  const failure = { NotAllowedError: 'The browser did not allow output selection. Review speaker permissions and retry.',
    NotFoundError: 'That audio output is unavailable. Choose another output or use the default.',
    InvalidAccessError: 'The browser could not open that output. Choose another output or use the default.',
    OutputRetirementUnconfirmed: 'The previous output has not confirmed it stopped. Stop audio and retry.',
    ContextRetirementUnconfirmed: 'The previous audio context has not confirmed it closed. Stop audio and retry.',
    OutputSelectionUnconfirmed: 'The browser did not confirm this output. Review the output and retry.' }[result?.errorCode];
  return { unchanged: 'Audio settings are unchanged.', unsupported: 'This browser cannot select that output. The current output is kept.', busy: 'Finish the current audio change first.',
    retired: 'The audio owner is closed.', canceled: 'Audio change canceled. Review the current output before enabling audio.',
    failed: failure || 'Audio change failed. Review the output before enabling audio.' }[result?.status] || 'Audio settings are unavailable.';
};

/** Compact controls for the main AudioContext, separate from the private cue route. */
export function createAudioRuntimeSettingsView({ document, readSnapshot, configure, chooseOutput, useDefault, resetLatency }) {
  let disposed = false, busy = false, dirty = false, configKey = null;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const write = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const element = node('details'); element.className = 'studio-audio-runtime';
  const summary = node('summary', 'Browser audio settings'), form = node('div'); form.className = 'studio-audio-runtime-controls';
  const profile = node('select'), rate = node('select'), readout = node('p'), detail = node('p'), status = node('output');
  const breakdown = node('details'), simulation = node('p'), queue = node('p'), dsp = node('p'), correlation = node('p'), playback = node('p');
  breakdown.className = 'studio-audio-latency-breakdown'; breakdown.append(node('summary', 'Latency breakdown'), simulation, queue, dsp, correlation, playback);
  profile.setAttribute('aria-label', 'Audio latency profile'); rate.setAttribute('aria-label', 'Preferred audio sample rate'); status.setAttribute('aria-live', 'polite');
  for (const [value, label] of [['performance', 'Performance · interactive hint'], ['balanced', 'Balanced hint'], ['robust', 'Robust · playback hint']]) { const option = node('option', label); option.value = value; profile.append(option); }
  for (const [value, label] of [['', 'Device-compatible sample rate'], ['44100', 'Prefer 44.1 kHz'], ['48000', 'Prefer 48 kHz'], ['96000', 'Prefer 96 kHz']]) { const option = node('option', label); option.value = value; rate.append(option); }
  const label = (name, control) => { const value = node('label', name + ' '); value.append(control); return value; };
  const apply = node('button', 'Apply audio settings'), choose = node('button', 'Choose main output'), defaults = node('button', 'Use default output'), reset = node('button', 'Reset latency interval');
  const controls = [profile, rate, apply, choose, defaults, reset]; for (const control of [apply, choose, defaults, reset]) control.type = 'button';
  const markDirty = () => { dirty = true; }; profile.addEventListener('change', markDirty); rate.addEventListener('change', markDirty);
  const render = () => {
    if (disposed) return;
    const snapshot = readSnapshot(); element.hidden = !snapshot; if (!snapshot) return;
    const observation = snapshot.observation, config = observation?.config, nextKey = JSON.stringify(config);
    if (config && !dirty && nextKey !== configKey) { profile.value = config.latencyProfile; rate.value = config.preferredSampleRate === null ? '' : String(config.preferredSampleRate); configKey = nextKey; }
    const pending = busy || snapshot.transition.pending;
    for (const control of controls) control.disabled = pending;
    choose.disabled ||= !snapshot.chooserAvailable || observation?.outputSelection.setSinkIdAvailable !== true;
    defaults.disabled ||= observation?.outputSelection.setSinkIdAvailable !== true && observation?.contextState !== 'not-created' && config?.sinkPreference !== 'explicit-device' && observation?.outputSelection.actualSink !== 'silent';
    reset.disabled ||= observation?.playbackStats.availability !== 'available';
    write(readout, 'Actual rate: ' + (observation?.actualSampleRate == null ? 'not created' : (observation.actualSampleRate / 1000).toFixed(1) + ' kHz') +
      '; context: ' + (observation?.contextState || 'unknown') + '; output: ' + (observation?.outputSelection.actualSink || 'unknown') +
      '. Browser base estimate: ' + milliseconds(observation?.baseLatencySeconds) + '; device estimate: ' + milliseconds(observation?.outputLatencySeconds) + '.');
    write(detail, 'Estimates are separate and are not acoustic latency. Profile hints may be ignored; a rate/profile change rebuilds the context. Re-enable audio after applying. ' +
      (observation?.contextState === 'not-created' ? 'Enable browser audio before choosing an output.' : snapshot.chooserAvailable && observation?.outputSelection.setSinkIdAvailable ? 'Choosing an output uses the browser permission dialog.' : 'Output selection is unavailable here; the current/default output is kept.') +
      ' Playback statistics: ' + (observation?.playbackStats.availability || 'not observed') + ', ' + (observation?.playbackStats.freshness || 'not observed') + '.');
    const latency = snapshot.breakdown, statistics = observation?.playbackStats.metrics;
    write(simulation, 'Simulation tick interval: ' + durationMs(latency?.simulation.quantizationMs) + (latency?.simulation.state === 'paused' ? ' (paused)' : '') + '. Configured quantization bound; delayed callbacks can take longer.');
    write(queue, 'Physical audio presentation hold: ' + durationMs(latency?.queue.configuredLeadMs) + '. Separate from MIDI clock lookahead.');
    write(dsp, 'Shared mix lookahead: ' + durationMs(latency?.dsp.masterLookaheadMs) + '; effect paths: ' + durationMs(latency?.dsp.effectLatencyMs) +
      (latency?.dsp.effectState === 'no-effect-route' ? ' (no effect rack)' : latency?.dsp.effectState === 'declared' ? ' (declared maximum across parallel active/tailing routes)' : ' (unmeasured or unavailable)') + '.');
    const method = latency?.correlation.method === 'output-timestamp' ? 'browser output timestamp' : latency?.correlation.method === 'context-correlation-with-reported-latency' ? 'context correlation with browser estimates' : 'unavailable';
    write(correlation, 'Visual/audio correlation: ' + method + '; ' + (correlationFreshness[latency?.correlation.freshness] || 'not yet observed') + '; observation age: ' + durationMs(latency?.correlation.ageMs) + '; sampling uncertainty: ' + durationMs(latency?.correlation.uncertaintyMs) + '.');
    write(playback, statistics ? 'Browser playback reports: mean/min/max ' + milliseconds(statistics.averageLatency) + ' / ' + milliseconds(statistics.minimumLatency) + ' / ' + milliseconds(statistics.maximumLatency) +
      '; cumulative underruns: ' + statistics.underrunEvents + ' (' + milliseconds(statistics.underrunDuration) + ' across ' + statistics.totalDuration.toFixed(1) + ' s reported playback). ' +
      'Reset changes the latency interval only. These reports do not identify which application caused a glitch.' : 'Browser playback values are unavailable or not yet observed.');
  };
  const run = async action => {
    if (disposed || busy) return;
    busy = true;
    status.textContent = 'Applying audio settings…';
    try {
      // Call before rendering/awaiting to preserve output-chooser user activation.
      const pending = action(); render(); const result = await pending;
      if (!disposed) { status.textContent = outcomeText(result); if (result?.requiresEnable || result?.status === 'unchanged') dirty = false; }
    } catch { if (!disposed) status.textContent = 'Audio settings could not be applied. Review the current output.'; }
    finally { busy = false; if (!disposed) render(); }
  };
  apply.addEventListener('click', () => { void run(() => configure({ latencyProfile: profile.value, preferredSampleRate: rate.value ? Number(rate.value) : null })); });
  choose.addEventListener('click', () => { void run(chooseOutput); }); defaults.addEventListener('click', () => { void run(useDefault); });
  reset.addEventListener('click', () => { if (!disposed && !busy) { status.textContent = resetLatency() ? 'Latency interval reset. Cumulative underruns are kept; new interval statistics may take a second.' : 'Latency interval reset is unavailable.'; render(); } });
  form.append(label('Profile', profile), label('Rate preference', rate), apply, choose, defaults, reset, readout, detail, breakdown,
    node('p', 'If playback drops out, try Robust and enable audio again. For persistent lag, compare a wired output. Profile hints may be ignored; these separate values do not establish an acoustic total.'), status); element.append(summary, form); render();
  return Object.freeze({ element, render, dispose() { disposed = true; element.remove(); } });
}
