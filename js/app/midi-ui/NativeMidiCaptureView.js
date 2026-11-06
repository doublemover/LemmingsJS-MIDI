import { nativeUmpCaptureBlob } from '../../midi/native/NativeUmpCapture.js';

export function createNativeMidiCaptureView({ document, container, routes, getGrant, getGroup = () => 0, onStatus }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Record submitted native output'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls); container.append(root);
  const removers = [], buttons = [];
  let disposed = false, busy = false, prepared = null, preparation = null, selectionRevision = 0;
  const field = (text, node) => { const label = element('label'); label.className = 'midi-field'; label.append(element('span', text), node); node.setAttribute('aria-label', text); controls.append(label); return node; };
  const select = (text, choices) => { const node = field(text, element('select')); for (const [value, title] of choices) { const option = element('option', title); option.value = value; node.append(option); } return node; };
  const check = text => { const node = field(text, element('input')); node.type = 'checkbox'; return node; };
  const metadataPolicy = select('Clip time and score metadata', [['fixed-seconds-omit-tempo-meter', 'Preserve SDK time in seconds; omit tempo/meter with a loss report'], ['strict-original-context', 'Retain source tempo/meter only at qualified Clip boundaries']]);
  const scope = select('Clip group scope', [['single-captured-grant', 'All groups of this captured output'], ['selected-group', 'Only the Group selected above']]);
  const declareTempo = check('Supply a declared initial tempo if no captured initial tempo exists'), initialTempo = field('Declared initial tempo (BPM)', element('input')); initialTempo.type = 'number'; initialTempo.min = '1.4'; initialTempo.max = '1000000'; initialTempo.value = '120';
  const incomplete = check('Explicitly export incomplete / unknown note boundaries'), relative = check('Explicitly retain baseline-dependent raw relative controllers');
  const clipStatus = element('output'); clipStatus.setAttribute('role', 'status'); root.append(clipStatus);
  const releasePrepared = () => { if (prepared) { prepared.release(); prepared = null; } };
  const download = (bytes, type, filename) => { const url = URL.createObjectURL(new Blob([bytes], { type })), link = element('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); };
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
    prepareClip.disabled ||= state.accepting || !state.count || state.retainedSnapshots > 0; saveClip.disabled ||= !prepared; saveManifest.disabled ||= !prepared; discardClip.disabled ||= !prepared;
    initialTempo.disabled = metadataPolicy.value !== 'strict-original-context' || !declareTempo.checked; declareTempo.disabled = metadataPolicy.value !== 'strict-original-context';
    const report = prepared?.report; clipStatus.textContent = report ? report.packets + ' accepted SDK packets · ' + (report.incomplete ? 'incomplete source explicitly selected' : 'closed observed note range') + ' · ' + report.scope + (report.group == null ? '' : ', group ' + (report.group + 1)) + ' · maximum timing projection error ' + report.quantization.maximumTimingErrorUs.toFixed(3) + 'µs · ' + report.exclusions.tempoPackets + ' tempo and ' + report.exclusions.meterPackets + ' meter packets omitted · ' + report.exclusions.setupOrUnsupportedPackets + ' setup/unsupported packets excluded · ' + report.relativeReplay : 'Prepare a standard MIDI2 Clip from this exact submitted source using the declared projection. Original SDK capture remains separate.';
  };
  const button = (text, action) => {
    const node = element('button', text); node.type = 'button'; controls.append(node); buttons.push(node);
    const handler = async () => { if (busy || disposed) return; busy = true; render(); try { await action(); } catch (error) { onStatus(error.message); } finally { busy = false; render(); } };
    node.addEventListener('click', handler); removers.push(() => node.removeEventListener('click', handler)); return node;
  };
  const start = button('Start a native output recording', () => { routes.startOutputCapture(getGrant()); onStatus('Recording exact SDK observations for this native output. Existing voices make the opening boundary unknown.'); });
  const stop = button('Stop native output recording', () => { routes.stopOutputCapture(); onStatus('Native output recording stopped at the observation boundary. No future release was added to the recording.'); });
  const clear = button('Discard native output recording', () => { releasePrepared(); routes.outputCapture.clear(); });
  const save = button('Save exact native SDK capture', async () => {
    const lease = await routes.outputCapture.snapshot({ isCurrent: () => !disposed });
    try {
      if (disposed) return;
      const blob = nativeUmpCaptureBlob(lease.snapshot), url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = 'lemmings-native-sdk-output.nativeump'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0); onStatus('Saved exact SDK words, acceptance flags and native call intervals. This is an observation artifact, not a standards MIDI Clip.');
    } finally { lease.release(); }
  });
  const prepareClip = button('Prepare submitted MIDI2 Clip', async () => {
    releasePrepared(); const selected = selectionRevision, selectedGroup = getGroup(); preparation = new AbortController();
    try { const artifact = await routes.exportSubmittedClip({ sourceLayer: 'driver-submitted', timeProjection: 'native-SDK-call-start', metadataPolicy: metadataPolicy.value, scope: scope.value, group: selectedGroup, ...(declareTempo.checked ? { initialTempoBpm: Number(initialTempo.value) } : {}), allowIncomplete: incomplete.checked, allowBaselineDependentRelative: relative.checked }, { signal: preparation.signal, current: () => !disposed && selected === selectionRevision && (scope.value !== 'selected-group' || getGroup() === selectedGroup), onProgress: progress => { clipStatus.textContent = 'Preparing submitted Clip · ' + progress.completedUnits + '/' + progress.totalUnits; } }); if (disposed || selected !== selectionRevision || scope.value === 'selected-group' && getGroup() !== selectedGroup) { artifact.release(); return; } prepared = artifact; onStatus('Submitted Clip prepared. Review its coverage, scope, timing and loss report before saving.'); }
    finally { preparation = null; }
  });
  const saveClip = button('Save prepared MIDI2 Clip', () => download(prepared.bytes, 'application/octet-stream', 'lemmings-native-submitted.midi2'));
  const saveManifest = button('Save Clip attribution and loss report', () => download(prepared.manifestBytes, 'application/json', 'lemmings-native-submitted.midi2.json'));
  const discardClip = button('Discard prepared Clip', releasePrepared);
  for (const node of [metadataPolicy, scope, declareTempo, initialTempo, incomplete, relative]) { const handler = () => { selectionRevision++; preparation?.abort(); releasePrepared(); if (metadataPolicy.value === 'strict-original-context') scope.value = 'selected-group'; render(); }; node.addEventListener('change', handler); removers.push(() => node.removeEventListener('change', handler)); }
  const unsubscribe = routes.outputCapture.subscribe(render); render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; preparation?.abort(); releasePrepared(); unsubscribe(); for (const remove of removers) remove(); root.remove(); } });
}
