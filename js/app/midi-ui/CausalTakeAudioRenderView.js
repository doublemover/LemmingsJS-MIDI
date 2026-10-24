import { createCausalTakeAudioRenderer } from './CausalTakeAudioRender.js';
import { borrowCausalTake, retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';
import { requestExportFileHandle, deliverArtifactToFileHandle, deliverArtifactToAnchor } from '../export/ExportArtifact.js';
import { createInstrumentDisplayScheduler } from '../resources/InstrumentDisplayScheduler.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createCausalTakeAudioRenderView({ document, window, journal, resourceBudget, jobs, displayScheduler = null, onStatus = () => {} } = {}) {
  const retirement = createProcgenRetirementScope(), listeners = [], reads = new Set(), readFaults = new Set();
  const scheduler = displayScheduler || createInstrumentDisplayScheduler({ document, window, resourceBudget });
  let disposed = false, owner = null, source = null, loading = false, loadSerial = 0, readController = null, picker = false, delivery = null, deliveryTask = null, lastDelivery = null, displayedBundle = null;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const listen = (element, event, callback) => { element.addEventListener(event, callback); listeners.push(() => element.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-causal-render'; dialog.setAttribute('aria-label', 'Render causal take sine revoice');
  const title = node('h2', 'Render take · sine revoice'), description = node('p', 'Creates a new local sine realization of immutable captured intent. Live admission decisions, hardware timbre and the protected live master are outside this render. The live world and external MIDI stay under their existing owners.');
  const sourceText = node('p', 'Choose a saved causal take.'), limits = node('p', 'Up to 120 seconds of captured history and 64 MiB across files. Mid-held capture and missing source clocks require qualified reconstruction. A crop silently reconstructs earlier captured intents before emitting frame zero.');
  const fields = node('div'), actions = node('div'); actions.className = 'studio-sound-actions';
  const label = (text, input) => { const wrap = node('label', text); wrap.className = 'studio-field'; wrap.append(input); fields.append(wrap); return input; };
  const number = (name, value, max) => { const input = node('input'); input.type = 'number'; input.min = '0'; input.max = String(max); input.step = '0.001'; input.value = String(value); input.setAttribute('aria-label', name); return label(name, input); };
  const first = number('Start seconds from capture', 0, 120), last = number('End seconds from capture', 1, 120), tailSeconds = number('Maximum tail seconds', 4, 4);
  const select = (name, choices) => { const element = node('select'); element.setAttribute('aria-label', name); for (const [value, text] of choices) { const option = node('option', text); option.value = value; element.append(option); } return label(name, element); };
  const rate = select('Render sample rate', [['44100', '44.1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz']]); rate.value = '48000';
  const tail = select('Render end policy', [['exact-crop', 'Exact crop'], ['bounded-natural', 'Captured releases with bounded tails'], ['boundary-release', 'Derive releases at the end boundary']]);
  const stems = node('input'); stems.type = 'checkbox'; stems.setAttribute('aria-label', 'Include all captured dry lane stems'); label('Include all captured dry lane stems (up to 16)', stems);
  const status = node('output', 'Idle'); status.setAttribute('role', 'status'); const details = node('p'), deliveryStatus = node('output'); deliveryStatus.setAttribute('aria-label', 'Rendered file delivery');
  const file = node('select'); file.setAttribute('aria-label', 'Prepared rendered file');
  const say = text => { if (!disposed) { deliveryStatus.textContent = text; try { onStatus(text); } catch { /* Status does not own a prepared render. */ } } };
  const run = action => async () => { try { await action(); } catch (error) { say(error.message); } paint(); };
  const button = (text, callback) => { const element = node('button', text); element.type = 'button'; listen(element, 'click', callback); actions.append(element); return element; };
  const chosen = () => owner?.getPrepared()?.files.find(entry => entry.id === file.value)?.artifact || null;
  const renderButton = button('Prepare sine revoice WAV', run(async () => {
    if (!source || loading) return;
    await owner.prepare({ takeId: source.takeId, takeRevision: source.revision, sampleRate: Number(rate.value), startSeconds: Number(first.value), endSeconds: Number(last.value),
      tail: { mode: tail.value, maxSeconds: Number(tailSeconds.value) }, includeAllLaneStems: stems.checked });
    say('Rendered WAV files are prepared. Choose a file and a delivery action; the original take is unchanged.');
  }));
  const cancelRender = button('Cancel render', () => owner.cancel());
  const download = button('Download selected WAV', run(() => {
    const artifact = chosen(); if (!artifact || picker || delivery) return;
    const result = deliverArtifactToAnchor(artifact, { document, windowRef: window }); lastDelivery = result;
    say(result.state === 'delivery-requested' ? 'Download requested. Browser completion is unacknowledged; the prepared WAV remains available.' : `Download ${result.state}: ${result.errorKind || result.evidence}.`);
  }));
  const save = button('Save selected WAV…', run(async () => {
    const artifact = chosen(); if (!artifact || picker || delivery) return;
    const serial = loadSerial; picker = true; paint(); let selected;
    try { selected = await requestExportFileHandle(artifact, { windowRef: window }); } finally { picker = false; paint(); }
    if (disposed || serial !== loadSerial || artifact !== chosen() || !artifact.metadata().retained) return;
    if (selected.state !== 'selected') { say(selected.state === 'canceled' ? 'Save canceled. The prepared WAV remains available.' : `Save unavailable: ${selected.errorKind}.`); return; }
    const controller = new AbortController(); delivery = controller; paint();
    deliveryTask = deliverArtifactToFileHandle(artifact, selected.handle, { signal: controller.signal,
      onProgress: bytes => { if (!disposed) deliveryStatus.textContent = `Writing ${bytes.toLocaleString()} bytes…`; } });
    try { lastDelivery = await deliveryTask; say(lastDelivery.state === 'close-acknowledged' ? 'WAV stream closed successfully. The prepared file remains available for retry.' :
      `WAV delivery ${lastDelivery.state}: ${lastDelivery.errorKind}. The prepared file remains available.`); }
    finally { if (delivery === controller) { delivery = null; deliveryTask = null; } paint(); }
  }));
  const cancelSave = button('Cancel file save', () => delivery?.abort());
  const discard = button('Discard prepared WAVs', run(() => { delivery?.abort(); const receipt = owner.getPrepared()?.discard();
    say(receipt?.outcome === 'partial' ? 'Prepared file retirement is unresolved.' : 'Prepared WAVs discarded; the original take is unchanged.'); }));
  const close = () => { loadSerial++; readController?.abort(); owner.cancel(); delivery?.abort(); dialog.close(); };
  button('Close', close); listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  function paint() {
    if (disposed || !owner) return;
    const current = owner.state(), busy = current.active, bundle = owner.getPrepared(), artifact = chosen()?.metadata();
    sourceText.textContent = source ? `${source.takeName} · revision ${source.revision} · ${source.hash.slice(0, 16)} · ${source.seconds == null ? 'capture clock unavailable' : source.seconds.toFixed(3) + ' captured seconds'}` : loading ? 'Reading saved take boundaries…' : 'No selected saved take.';
    if (bundle !== displayedBundle) { displayedBundle = bundle; file.replaceChildren(); for (const entry of bundle?.files || []) { const option = node('option', entry.label); option.value = entry.id; file.append(option); } }
    status.textContent = loading ? 'Reading take' : `${current.phase}${current.progress ? ` · ${current.progress.completedUnits.toLocaleString()} / ${current.progress.totalUnits.toLocaleString()} frames` : ''}`;
    details.textContent = current.error || source?.unavailable || (bundle ? `Prepared source ${bundle.manifest.takeId} · ${bundle.manifest.frames.toLocaleString()} stereo frames at ${bundle.manifest.sampleRate} Hz · ${bundle.manifest.tail.mode} · ${bundle.files.length} file(s). Master protection is excluded.` :
      'Choose a range and prepare. Rendering does not enable live audio or audition the result.');
    renderButton.disabled = loading || busy || !source || !!source.unavailable || !!current.unresolvedRetirement || picker || !!delivery;
    cancelRender.disabled = !busy; first.disabled = last.disabled = rate.disabled = tail.disabled = stems.disabled = busy || loading;
    tailSeconds.disabled = busy || loading || tail.value === 'exact-crop'; file.disabled = busy || picker || !!delivery || !bundle;
    const ready = !!(artifact || chosen()?.metadata())?.retained;
    download.disabled = !ready || busy || picker || !!delivery; save.disabled = download.disabled || typeof window.showSaveFilePicker !== 'function';
    cancelSave.disabled = !delivery; discard.disabled = !bundle || busy || picker;
  }
  const surface = scheduler.register({ id: 'causal-render-dialog', element: dialog, intervalMs: 50, write: paint, onError: say });
  owner = createCausalTakeAudioRenderer({ journal, resourceBudget, jobs, onState: () => surface.invalidate() });
  listen(file, 'change', paint); listen(tail, 'change', paint);
  dialog.append(title, description, sourceText, limits, fields, status, details, file, deliveryStatus, actions);
  (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ async open({ takeId } = {}) {
    if (disposed) return; if (readFaults.size) throw new Error('Take metadata reader retirement remains unresolved.');
    const serial = ++loadSerial; readController?.abort(); const controller = readController = new AbortController();
    loading = true; source = null; if (!dialog.open) dialog.showModal(); paint();
    let work; work = (async () => {
      const loan = await borrowCausalTake(journal, takeId, { signal: controller.signal });
      try {
        if (disposed || controller.signal.aborted || serial !== loadSerial) return;
        const manifest = loan.value, origin = manifest.boundaryState?.sourceTimeMs, end = manifest.stopBoundaryState?.sourceTimeMs;
        const seconds = Number.isFinite(origin) && Number.isFinite(end) && end >= origin ? (end - origin) / 1000 : null;
        const unavailable = !['finalized', 'partial'].includes(manifest.state) ? 'Finish recording this take before rendering.' :
          seconds == null ? 'This take lacks an exact captured source-clock boundary. Qualified history reconstruction is required.' : seconds <= 0 ? 'This take has no source-clock duration to render.' :
            !Array.isArray(manifest.boundaryState?.voices) || manifest.boundaryState.voices.length ? 'This take begins with unknown or held voices. Qualified onset/state history is required.' : null;
        source = Object.freeze({ takeId: manifest.takeId, takeName: manifest.takeName, revision: manifest.revision, hash: manifest.canonicalHash, seconds, unavailable });
        first.value = '0'; last.value = String(Math.min(10, seconds ?? 1)); first.max = last.max = String(Math.min(120, seconds ?? 120));
      } finally { try { retireCausalRead(loan); } catch (error) { readFaults.add({ loan, error }); throw error; } }
    })(); reads.add(work);
    try { await work; } catch (error) { if (!disposed && serial === loadSerial && !controller.signal.aborted) say(error.message); }
    finally { reads.delete(work); if (serial === loadSerial) { loading = false; paint(); } }
  }, state: () => Object.freeze({ render: owner.state(), selectedTake: source, delivery: lastDelivery, pickingFile: picker, writing: !!delivery, unresolvedMetadata: readFaults.size }),
  suspend() { readController?.abort(); owner.cancel(); delivery?.abort(); },
  dispose() {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; loadSerial++; readController?.abort(); delivery?.abort();
    const pendingDelivery = deliveryTask;
    return retirement.retire([{ name: 'render-owner', run: () => owner.dispose() }, { name: 'accepted-metadata', run: () => Promise.allSettled([...reads]) },
      { name: 'metadata-reader-faults', run: async () => { await Promise.allSettled([...reads]); if (readFaults.size) throw new Error('Take metadata reader retirement remains unresolved.'); } },
      { name: 'accepted-delivery', run: () => pendingDelivery?.catch(() => {}) }, { name: 'render-surface', run: () => surface.dispose() },
      { name: 'render-display-scheduler', run: () => { if (!displayScheduler) return scheduler.dispose(); } },
      ...listeners.splice(0).map((remove, index) => ({ name: 'render-view-listener-' + index, run: remove })),
      { name: 'render-dialog', run: () => { dialog.close(); dialog.remove(); } }]);
  }
  });
}
