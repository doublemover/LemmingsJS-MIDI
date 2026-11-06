import { nativeUmpCaptureBlob } from '../../midi/native/NativeUmpCapture.js';

export function createNativeMidiCaptureView({ document, container, routes, getGrant, onStatus }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Record submitted native output'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls); container.append(root);
  const removers = [], buttons = [];
  let disposed = false, busy = false;
  const status = element('output'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status,
    element('p', 'This recording contains actual accepted and unconfirmed SDK calls for one selected native output. It preserves native call intervals and packet words, including configuration/SysEx data. It does not prove receiver or acoustic output. Saving this exact capture uses the application’s binary capture format; MIDI Clip export is a separate projection.'));
  const render = () => {
    if (disposed) return; const state = routes.outputCapture.state(), target = routes.grantState(getGrant());
    for (const button of buttons) button.disabled = busy;
    start.disabled ||= !target || target.direction !== 'output' || state.accepting || state.count > 0 || state.retainedSnapshots > 0;
    stop.disabled = !state.accepting; clear.disabled ||= state.accepting || state.retainedSnapshots > 0 || !state.capture; save.disabled ||= state.accepting || !state.count || state.retainedSnapshots > 0;
    status.textContent = (state.accepting ? 'Recording' : state.capture ? 'Stopped' : 'No native recording') + (state.capture ? ' · native output ' + state.capture.grant + ' · connection ' + state.capture.session : '') +
      ' · ' + state.count + '/' + state.maximumRecords + ' SDK packets · ' + state.unconfirmed + ' unconfirmed · ' + state.dropped + ' omitted · ' + state.retainedBytes + ' reserved capture bytes' +
      (state.latest?.reason ? ' · ' + state.latest.reason : '');
  };
  const button = (text, action) => {
    const node = element('button', text); node.type = 'button'; controls.append(node); buttons.push(node);
    const handler = async () => { if (busy || disposed) return; busy = true; render(); try { await action(); } catch (error) { onStatus(error.message); } finally { busy = false; render(); } };
    node.addEventListener('click', handler); removers.push(() => node.removeEventListener('click', handler)); return node;
  };
  const start = button('Start a native output recording', () => { routes.startOutputCapture(getGrant()); onStatus('Recording exact SDK observations for this native output. Existing voices make the opening boundary unknown.'); });
  const stop = button('Stop native output recording', () => { routes.stopOutputCapture(); onStatus('Native output recording stopped at the observation boundary. No future release was added to the recording.'); });
  const clear = button('Discard native output recording', () => routes.outputCapture.clear());
  const save = button('Save exact native SDK capture', async () => {
    const lease = await routes.outputCapture.snapshot({ isCurrent: () => !disposed });
    try {
      const blob = nativeUmpCaptureBlob(lease.snapshot), url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = 'lemmings-native-sdk-output.nativeump'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0); onStatus('Saved exact SDK words, acceptance flags and native call intervals. This is an observation artifact, not a standards MIDI Clip.');
    } finally { lease.release(); }
  });
  const unsubscribe = routes.outputCapture.subscribe(render); render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; unsubscribe(); for (const remove of removers) remove(); root.remove(); } });
}
