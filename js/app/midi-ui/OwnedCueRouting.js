import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';

const routeFailures = new WeakSet();
const failure = message => { const error = Object.assign(new Error(message), { name: 'CueRouteError' }); routeFailures.add(error); return error; };
const publicFailure = error => routeFailures.has(error) ? error : failure({
  NotAllowedError: 'Cue output permission was declined. Choose the device again when ready.',
  AbortError: 'Cue output selection was canceled.', NotFoundError: 'The selected cue output is no longer available.',
  NotSupportedError: 'The selected cue output is unsupported by this browser.', SecurityError: 'Browser policy blocked the selected cue output.'
}[error?.name] || 'Selected cue output failed. Choose the device again or use an explicit rehearsal route.');
const summary = receipt => receipt ? Object.freeze({ state: receipt.state, outcome: receipt.outcome }) : null;
let cueRouteSerial = 0;

// Device identifiers and native handles never leave this owner's closures.
export function createOwnedCueRouting({ context, masterInput, resources, createElement, mediaDevices, onChange = () => {} } = {}) {
  if (!context?.createGain || !masterInput || !resources?.reserve || typeof createElement !== 'function' || typeof onChange !== 'function') throw new TypeError('Invalid cue graph owner.');
  const retirement = createProcgenRetirementScope(), pending = new Set(), uncertain = new Set();
  let disposed = false, generation = 0, revision = 0, current = null, selectedMode = 'muted', level = 0.5, active = false, graphLease, input, fader, ceiling;
  let message = 'Choose an explicit prelisten route.', graphError = null;
  const state = () => Object.freeze({ schema: 'lemmings-monitor-route/v1', revision, state: disposed ? 'disposed' : pending.size ? 'preparing' :
    current?.invalid ? 'requires-revalidation' : current ? active ? 'playing-route' : 'ready' : graphError ? 'failed' : 'muted',
  mode: current?.mode || selectedMode, selectedMode, muted: !active || !current || !!current.invalid, cueGain: level,
  captureTap: 'post-protection-shared-browser-master', cueIncludedInMasterCapture: current?.mode === 'rehearsal',
  physicalSeparation: current?.mode === 'separate-device' ? 'selected-device-unverified-acoustics' : 'not-claimed',
  latency: current?.mode === 'separate-device' ? 'asynchronous-secondary-output-unmeasured' : 'shared-context-output',
  phaseSynchronous: current?.mode !== 'separate-device', pendingNativeOperations: pending.size, unresolvedRetirement: uncertain.size,
  message, retirement: summary(retirement.getReceipt()),
  capabilities: Object.freeze({ separateDevice: !!context.createMediaStreamDestination && !!mediaDevices?.selectAudioOutput,
    verifiedMultichannel: false, rehearsal: true }) });
  const report = () => { try { onChange(state()); } catch { /* Views do not own monitor routing. */ } };
  const setGain = () => {
    if (!fader) return;
    const value = active && current && !current.invalid && context.state === 'running' ? level * (current.mode === 'separate-device' ? 0.15 : 1) : 0;
    fader.gain.cancelScheduledValues?.(context.currentTime); fader.gain.setValueAtTime(value, context.currentTime);
  };
  const mute = reason => { active = false; setGain(); if (reason) message = reason; report(); };
  const invalidate = reason => { if (!current || disposed) return; current.invalid = true; revision++; mute(reason); };
  const onContextState = () => { if (context.state !== 'running') invalidate('Audio context changed. Revalidate the prelisten route.'); };
  const onDeviceChange = () => invalidate('Output device configuration changed. Prelisten is muted until revalidated.');
  const retireRoute = route => {
    if (!route) return null;
    if (route.retirement.getReceipt()) return route.retirement.getReceipt();
    let nativeReceipt;
    const receipt = route.retirement.retire([
      { name: 'route-listeners', run: () => { for (const [type, callback] of route.listeners) route.element?.removeEventListener(type, callback); route.listeners.length = 0; } },
      { name: 'native-route', run: () => nativeReceipt = createProcgenRetirementScope().retire([
        { name: 'route-edge', run: () => { if (route.connected) { ceiling.disconnect(route.destination); route.connected = false; } } },
        { name: 'media-pause', run: () => route.element?.pause() },
        { name: 'media-source', run: () => { if (route.element) { route.element.srcObject = null; route.element.removeAttribute?.('src'); route.element.load?.(); } } },
        ...[...(route.destination?.stream?.getTracks?.() || [])].map((track, index) => ({ name: 'cue-track-' + index, run: () => track.stop() })),
        { name: 'media-node', run: () => { if (route.mode === 'separate-device') route.destination?.disconnect(); } }
      ]) },
      { name: 'route-reservation', run: () => releaseAudioResourceAfterRetirement(route.lease, nativeReceipt) }
    ]);
    if (receipt.outcome !== 'complete') uncertain.add(route);
    return receipt;
  };
  const ensureGraph = () => {
    if (input) return;
    graphLease = resources.reserve({ kind: 'cue-graph', owner: 'prelisten', bytes: 4097 * 4, estimateBytes: 64 * 1024 });
    try {
      input = context.createGain(); fader = context.createGain(); fader.gain.value = 0; ceiling = context.createWaveShaper();
      const curve = new Float32Array(4097);
      for (let index = 0; index < curve.length; index++) { const sample = index * 2 / (curve.length - 1) - 1; curve[index] = Math.tanh(sample * 1.25) * 0.7; }
      ceiling.curve = curve; input.connect(fader); fader.connect(ceiling);
      context.addEventListener?.('statechange', onContextState); mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    } catch (error) {
      graphError = error;
      const receipt = createProcgenRetirementScope().retire([
        { name: 'cue-input', run: () => input?.disconnect() }, { name: 'cue-fader', run: () => fader?.disconnect() }, { name: 'cue-ceiling', run: () => ceiling?.disconnect() }
      ]);
      try { releaseAudioResourceAfterRetirement(graphLease, receipt); } catch { uncertain.add({}); }
      throw error;
    }
  };
  const prepare = ({ mode, selectOutput } = {}) => {
    if (disposed || uncertain.size || graphError || !['rehearsal', 'separate-device'].includes(mode) || context.state !== 'running' || pending.size >= 2) return Promise.reject(failure('Prelisten routing is unavailable.'));
    if (mode === 'separate-device' && (!context.createMediaStreamDestination || !mediaDevices?.selectAudioOutput)) return Promise.reject(failure('This browser cannot select a separate cue output.'));
    selectedMode = mode; const epoch = ++generation; mute('Preparing the selected prelisten route.');
    let selection;
    // Called inside the routing button gesture; no microphone permission request.
    try { selection = mode === 'separate-device' ? (selectOutput || (() => mediaDevices.selectAudioOutput()))() : null; }
    catch (error) { selection = Promise.reject(error); }
    const operation = { epoch, promise: null }; pending.add(operation); report();
    operation.promise = (async () => {
      let candidate = null;
      try {
        const selected = await selection;
        if (disposed || generation !== epoch) throw failure('Prelisten route selection was superseded.');
        ensureGraph();
        const lease = resources.reserve({ kind: 'cue-output-route', owner: 'prelisten', estimateBytes: mode === 'separate-device' ? 256 * 1024 : 4096 });
        candidate = { id: ++cueRouteSerial, mode, lease, element: null, destination: null, connected: false, listeners: [], retirement: createProcgenRetirementScope(), invalid: false };
        if (mode === 'separate-device') {
          if (!selected || selected.kind !== 'audiooutput' || typeof selected.deviceId !== 'string' || !selected.deviceId ||
              ['default', 'communications'].includes(selected.deviceId)) throw failure('Select a concrete separate output; the default device is not a private cue route.');
          candidate.element = createElement('audio');
          if (typeof candidate.element?.setSinkId !== 'function') throw failure('This browser cannot route a media element to the selected cue device.');
          candidate.destination = context.createMediaStreamDestination(); candidate.element.srcObject = candidate.destination.stream;
          candidate.element.autoplay = false; candidate.element.muted = false; candidate.element.volume = 1;
          await candidate.element.setSinkId(selected.deviceId);
          if (candidate.element.sinkId !== selected.deviceId) throw failure('The selected cue sink was not acknowledged.');
          if (disposed || generation !== epoch || context.state !== 'running') throw failure('Cue selection changed before output readiness.');
          await candidate.element.play();
          const acceptedRoute = candidate;
          const invalid = () => { if (current === acceptedRoute) invalidate('Cue output changed or stopped. Revalidate before prelisten.'); };
          for (const type of ['error', 'pause', 'ended', 'sinkchange']) { candidate.element.addEventListener(type, invalid); candidate.listeners.push([type, invalid]); }
        } else candidate.destination = masterInput;
        if (disposed || generation !== epoch || context.state !== 'running') throw failure('Cue readiness belongs to a retired operation.');
        const previous = current; current = null;
        const retired = retireRoute(previous);
        if (retired?.outcome !== 'complete' && retired) throw failure('Previous cue output retirement is unresolved.');
        ceiling.connect(candidate.destination); candidate.connected = true; current = candidate; candidate = null; revision++;
        message = mode === 'rehearsal' ? 'Rehearsal on live output. Included in master capture.' :
          'Selected separate device ready. Physical socket isolation is unverified; secondary buffering is asynchronous.';
        return Object.freeze({ schema: 'lemmings-monitor-route-commit/v1', state: 'ready', mode, revision,
          cueIncludedInMasterCapture: mode === 'rehearsal', physicalSeparation: mode === 'separate-device' ? 'selected-device-unverified-acoustics' : 'not-claimed' });
      } catch (error) {
        const retired = retireRoute(candidate);
        const safe = publicFailure(error);
        if (!disposed && generation === epoch) { message = safe.message; if (current) current.invalid = true; }
        if (retired?.outcome !== 'complete' && retired) uncertain.add(candidate);
        throw safe;
      } finally { pending.delete(operation); report(); }
    })(); return operation.promise;
  };
  const stop = () => { generation++; mute('Prelisten stopped. The live master continues.'); return state(); };
  return Object.freeze({ state, prepare, stop,
    getInput() { if (disposed || !current || current.invalid || uncertain.size || pending.size || context.state !== 'running') throw failure('Choose and prepare a prelisten route first.'); return input; },
    activate() {
      if (disposed || !current || current.invalid || pending.size || uncertain.size || context.state !== 'running') throw failure('Prelisten route is not ready.');
      active = true; setGain(); report(); return state();
    }, setLevel(value) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Invalid cue gain.'); level = value; setGain(); report(); },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; stop(); const prior = current; current = null;
      let graphReceipt;
      return retirement.retire([
        { name: 'accepted-route-preparation', run: async () => { await Promise.allSettled([...pending].map(operation => operation.promise)); if (uncertain.size) throw failure('Cue preparation retirement is unresolved.'); } },
        { name: 'selected-route', run: () => retireRoute(prior) },
        { name: 'cue-listeners', run: () => { context.removeEventListener?.('statechange', onContextState); mediaDevices?.removeEventListener?.('devicechange', onDeviceChange); } },
        { name: 'cue-graph', run: () => graphReceipt = createProcgenRetirementScope().retire([
          { name: 'input', run: () => input?.disconnect() }, { name: 'fader', run: () => fader?.disconnect() }, { name: 'ceiling', run: () => ceiling?.disconnect() }
        ]) },
        { name: 'cue-graph-reservation', run: () => releaseAudioResourceAfterRetirement(graphLease, graphReceipt) }
      ]);
    }
  });
}
