import { createOwnedMasterCapture } from './OwnedMasterCapture.js';
import { requestExportFileHandle, deliverArtifactToFileHandle } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createMasterCaptureView({ document, window, preview, resourceBudget, onHarvest = null, onStatus = () => {} } = {}) {
  const listeners = [], retirement = createProcgenRetirementScope();
  let disposed = false, delivery = null, picker = false, deliveryReceipt = null, owner;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const listen = (element, event, callback) => { element.addEventListener(event, callback); listeners.push(() => element.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-master-capture'; dialog.setAttribute('aria-labelledby', 'masterCaptureTitle');
  const title = node('h2', 'Record browser master'); title.id = 'masterCaptureTitle';
  const description = node('p', 'Records the shared browser master after protection, including live-output rehearsal. The separate cue bus is excluded. External MIDI audio, microphones and device acoustics are outside this recording.');
  const memory = node('p', 'PCM is held in memory until saved or discarded. Closing the browser can lose it. Missing frames are marked in the WAV manifest and use zero placeholders.');
  const duration = node('select'); duration.setAttribute('aria-label', 'Maximum audio capture duration');
  for (const seconds of [30, 60, 120, 300]) { const option = node('option', `${seconds} seconds`); option.value = seconds; duration.append(option); }
  duration.value = '60';
  const status = node('output', 'Enable browser audio, then start capture.'); status.setAttribute('role', 'status');
  const details = node('p'), deliveryStatus = node('p'), actions = node('div'); actions.className = 'studio-sound-actions';
  const say = message => { if (!disposed) { deliveryStatus.textContent = message; try { onStatus(message); } catch { /* Status cannot retire a recording. */ } } };
  const run = action => async () => { try { await action(); } catch (error) { say(error.message); } render(); };
  const button = (label, callback) => { const element = node('button', label); element.type = 'button'; listen(element, 'click', callback); actions.append(element); return element; };
  const start = button('Start master capture', run(() => owner.start({ seconds: Number(duration.value) })));
  const stop = button('Stop capture', run(() => owner.stop()));
  const save = button('Save captured WAV', run(async () => {
    const artifact = owner.state().artifact;
    if (!artifact?.metadata().retained || picker || delivery) return;
    picker = true; render();
    let selected;
    try { selected = await requestExportFileHandle(artifact, { windowRef: window }); }
    finally { picker = false; render(); }
    if (disposed || artifact !== owner.state().artifact || !artifact.metadata().retained) return;
    if (selected.state !== 'selected') { say(selected.state === 'canceled' ? 'Save canceled. Captured PCM remains available.' : `Save unavailable: ${selected.errorKind}. Captured PCM remains available.`); return; }
    const controller = new AbortController(); delivery = controller; render();
    try {
      deliveryReceipt = await deliverArtifactToFileHandle(artifact, selected.handle, { signal: controller.signal,
        onProgress: bytes => { if (!disposed) deliveryStatus.textContent = `Writing ${bytes.toLocaleString()} bytes…`; } });
      say(deliveryReceipt.state === 'close-acknowledged' ? 'WAV stream closed successfully. Captured PCM remains available for another save.' :
        `WAV delivery ${deliveryReceipt.state}: ${deliveryReceipt.errorKind}. Captured PCM remains available.`);
    } finally { if (delivery === controller) delivery = null; render(); }
  }));
  const harvest = button('Harvest sound seed', run(async () => {
    const snapshot = owner.state(); if (!snapshot.artifact?.metadata().retained || !onHarvest || delivery || picker) return;
    dialog.close(); await onHarvest({ artifact: snapshot.artifact, manifest: snapshot.manifest });
  }));
  const cancel = button('Cancel save', () => delivery?.abort());
  const discard = button('Discard captured PCM', run(() => { delivery?.abort(); owner.discard(); say('Captured PCM discarded.'); }));
  button('Close', () => { void owner.stop(); dialog.close(); });
  const render = () => {
    if (disposed || !owner) return;
    const snapshot = owner.state(), active = ['preparing', 'recording', 'stopping'].includes(snapshot.state), artifact = snapshot.artifact?.metadata();
    start.disabled = active || !!artifact?.retained || snapshot.unresolvedOwnership || !preview.getState().enabled;
    harvest.disabled = active || !artifact?.retained || !onHarvest || picker || !!delivery;
    stop.disabled = !active; duration.disabled = active;
    save.disabled = !artifact?.retained || picker || !!delivery || typeof window.showSaveFilePicker !== 'function';
    discard.disabled = active || !artifact?.retained || picker; cancel.disabled = !delivery;
    status.textContent = `${snapshot.state} · ${snapshot.sampleRate ? snapshot.sampleRate + ' Hz stereo' : 'original context sample rate'} · ` +
      `${snapshot.frames.toLocaleString()} source frames · ${snapshot.capturedFrames.toLocaleString()} received frames`;
    const manifest = snapshot.manifest;
    details.textContent = snapshot.error || (manifest ? `${manifest.state}: ${manifest.stopReason}. ${manifest.gaps.length} indexed gap(s). ` +
      `${manifest.terminalAcknowledged ? 'End frame acknowledged.' : 'Coverage after the received prefix is unknown.'}` +
      (manifest.clockDiscontinuity ? ` Render clock expected ${manifest.clockDiscontinuity.expectedFrame}, received ${manifest.clockDiscontinuity.actualFrame} (${manifest.clockDiscontinuity.frames} frames).` : '') :
      snapshot.state === 'preparing' ? 'Preparing bounded storage and the local capture processor…' : 'Start does not enable audio or open any MIDI device.');
    if (artifact?.retained && typeof window.showSaveFilePicker !== 'function') deliveryStatus.textContent = 'This browser does not provide streaming file saves. Keep this page open; exporting a full recording requires that capability.';
  };
  owner = createOwnedMasterCapture({ preview, resourceBudget, AudioWorkletNodeType: window.AudioWorkletNode, onChange: render });
  const unhook = preview.subscribe?.(render);
  listen(dialog, 'cancel', event => { event.preventDefault(); void owner.stop(); dialog.close(); });
  dialog.append(title, description, memory, duration, status, details, deliveryStatus, actions); document.body.append(dialog);
  return Object.freeze({ open() { if (disposed) return; render(); if (!dialog.open) dialog.showModal(); },
    state: () => Object.freeze({ capture: owner.state(), delivery: deliveryReceipt, pickingFile: picker, writing: !!delivery }),
    suspend() { delivery?.abort(); return owner.stop('context-interrupted'); },
    dispose() {
      if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; delivery?.abort();
      return retirement.retire([{ name: 'capture', run: () => owner.dispose() }, { name: 'audio-observer', run: () => unhook?.() },
        ...listeners.splice(0).map((remove, index) => ({ name: 'capture-listener-' + index, run: remove })),
        { name: 'dialog', run: () => { dialog.close(); dialog.remove(); } }]);
    }
  });
}
