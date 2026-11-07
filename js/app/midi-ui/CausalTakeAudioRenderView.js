import { createGraftTakeComparisonOwner } from './GraftTakeComparisonOwner.js';
import { createCapturedBodyComparisonOwner } from './CapturedBodyComparisonOwner.js';
import { createPreparedWavePrelisten } from './PreparedWavePrelisten.js';
import { createCausalTakeSeekOwner } from './CausalTakeSeekOwner.js';
import { NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineProfile.js';
import { validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { getOwnedSourceProfile, OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createCausalTakeAudioRenderer, CAUSAL_RENDER_SOURCES } from './CausalTakeAudioRender.js';
import { borrowCausalTake, retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';
import { requestExportFileHandle, deliverArtifactToFileHandle, deliverArtifactToAnchor } from '../export/ExportArtifact.js';
import { createInstrumentDisplayScheduler } from '../resources/InstrumentDisplayScheduler.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { prepareCausalEffectSelection } from './CausalEffectSelection.js';

export function createCausalTakeAudioRenderView({ document, window, journal, resourceBudget, jobs, audio = null, onPrelisten = null, getMaterialProvider = null, getSavedRack = () => null, displayScheduler = null, onStatus = () => {}, onHarvest = null } = {}) {
  if (typeof getSavedRack !== 'function') throw new TypeError('Saved effect defaults need a project reader.');
  let instrumentWorkspace = null, effectWorkspace = null, originalWorkspace = null, originalComparisonReference = null, comparisonOwner = null, bodyComparisonOwner = null, displayComparison = null;
  const retirement = createProcgenRetirementScope(), listeners = [], reads = new Set(), readFaults = new Set();
  const scheduler = displayScheduler || createInstrumentDisplayScheduler({ document, window, resourceBudget });
  let instrumentReference = null, instrumentSupported = false, instrumentError = null;
  let disposed = false, owner = null, source = null, loading = false, preparing = false, loadSerial = 0, readController = null, picker = false, delivery = null, deliveryTask = null, lastDelivery = null, displayedBundle = null;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const listen = (element, event, callback) => { element.addEventListener(event, callback); listeners.push(() => element.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-dialog studio-causal-render'; dialog.setAttribute('aria-label', 'Render causal take owned-source revoice');
  const title = node('h2', 'Render take · owned source revoice'), description = node('p', 'Creates a new local realization of immutable captured intent using default controls for the selected source. Live admission decisions, hardware timbre and the protected live master are outside this render. The live world and external MIDI stay under their existing owners.');
  const sourceText = node('p', 'Choose a saved causal take.'), limits = node('p', 'Up to 120 seconds of captured history and 64 MiB across files. Mid-held capture and missing source clocks require qualified reconstruction. A crop reconstructs earlier captured intents before emitting frame zero. Four-way graft comparisons allow up to sixteen seconds with one common tail policy and 64 MiB across the four files.');
  const fields = node('div'), actions = node('div'); actions.className = 'studio-sound-actions';
  const label = (text, input) => { const wrap = node('label', text); wrap.className = 'studio-field'; wrap.append(input); fields.append(wrap); return input; };
  const number = (name, value, max) => { const input = node('input'); input.type = 'number'; input.min = '0'; input.max = String(max); input.step = '0.001'; input.value = String(value); input.setAttribute('aria-label', name); return label(name, input); };
  const first = number('Start seconds from capture', 0, 120), last = number('End seconds from capture', 1, 120), tailSeconds = number('Maximum tail seconds', 4, 4);
  const select = (name, choices) => { const element = node('select'); element.setAttribute('aria-label', name); for (const [value, text] of choices) { const option = node('option', text); option.value = value; element.append(option); } return label(name, element); };
  const sourceModel = select('Render source model', CAUSAL_RENDER_SOURCES.map(source => [source.id, source.label])); sourceModel.value = 'worklet-sine';
  const instrumentInfo = node('p'); instrumentInfo.setAttribute('aria-label', 'Saved render instrument');
  const captureInstrument = raw => {
    if (raw || instrumentWorkspace) {
      instrumentWorkspace ||= createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-render-instrument', kind: 'render-instrument-reference', category: 'audio', bytes: 4096 });
      instrumentWorkspace.resize(raw ? 1048576 : 4096);
    }
    instrumentReference = null; instrumentSupported = false; instrumentError = null;
    if (raw) {
      try {
        instrumentReference = validateSoundContentReference(raw);
        const inventory = canonicalDataText(instrumentReference, { maxBytes: 65536, maxNodes: 8192 });
        instrumentWorkspace.resize(4096 + inventory.bytes.byteLength * 2 + inventory.nodes * 64);
        instrumentSupported = NATIVE_OFFLINE_SOURCE_IDS.includes(instrumentReference.engineRequirement.engineId) ? typeof globalThis.OfflineAudioContext === 'function' : OWNED_SOURCE_IDS.includes(instrumentReference.engineRequirement.engineId) && getOwnedSourceProfile(instrumentReference.engineRequirement.engineId).offlineRender;
      } catch (error) { instrumentReference = null; instrumentWorkspace.resize(4096); instrumentError = error.message; }
    }
    const previous = sourceModel.value; sourceModel.replaceChildren();
    for (const model of CAUSAL_RENDER_SOURCES) { const option = node('option', model.label); option.value = model.id; option.disabled = NATIVE_OFFLINE_SOURCE_IDS.includes(model.id) && typeof globalThis.OfflineAudioContext !== 'function'; sourceModel.append(option); }
    if (instrumentReference) {
      const definition = instrumentReference.definition, name = typeof definition.name === 'string' ? definition.name : instrumentReference.patchId;
      const option = node('option', 'Saved instrument · ' + name + ' @' + instrumentReference.revision + (instrumentSupported ? '' : ' · renderer unavailable'));
      option.value = 'saved-instrument'; option.disabled = !instrumentSupported; sourceModel.append(option);
    }
    sourceModel.value = previous === 'saved-instrument' && instrumentSupported || CAUSAL_RENDER_SOURCES.some(model => model.id === previous) ? previous : 'worklet-sine';
  };
  const rate = select('Render sample rate', [['44100', '44.1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz']]); rate.value = '48000';
  const tail = select('Render end policy', [['exact-crop', 'Exact crop'], ['bounded-natural', 'Captured releases with bounded tails'], ['boundary-release', 'Derive releases at the end boundary']]);
  const stems = node('input'); stems.type = 'checkbox'; stems.setAttribute('aria-label', 'Include all captured dry lane stems'); label('Include all captured dry lane stems (native: 15; owned: 16)', stems);
  const effect = select('New render effect', [['none', 'Dry source graph'], ['captured-controls', 'Captured FX commands · retained graph tails'], ['quarry-echo', 'Quarry Echo · authored static send'], ['quarry-duck', 'Quarry Duck · source-shaped echo return'], ['quarry-tape', 'Quarry Tape · authored static send'], ['quarry-tape-spring', 'Quarry Tape + Spring · shared echo and body'], ['quarry-hollow-spring', 'Hollow Spring · shared body'], ['quarry-stone-courtyard', 'Stone Courtyard · shared body'], ['quarry-crossed-gallery', 'Crossed Gallery · shared body'], ['saved-owner', 'Saved owner rack · new send amount']]);
  const effectSend = number('New render source send', 0.35, 0.65); effectSend.step = '0.01';
  const effectReturn = node('input'); effectReturn.type = 'checkbox'; effectReturn.checked = true; label('Include the simultaneous shared return WAV', effectReturn);
  const effectInfo = node('p'); effectInfo.setAttribute('aria-label', 'Effect render scope'); fields.append(effectInfo);
  const timingMode = select('Performance timing', [['captured-live', 'Captured causal groove'], ['literal', 'Original physical timing'], ['offline-bidirectional', 'Derived offline groove · earlier or later']]);
  const groovePadding = node('input'); groovePadding.type = 'checkbox'; groovePadding.checked = true; label('Extend a full take by its declared groove delay', groovePadding);
  fields.append(node('p', 'Start/end seconds refer to the output timeline. Physical source times stay in the take. Changing timing uses a new static effect realization; captured FX commands require captured causal groove.'));
  const restore = select('Range reconstruction', [['initial-owned-image', 'Captured owned sound image'], ['forward-preroll', 'Forward captured history'], ['owned-state-cut', 'Restore owned source + FX at range start (experimental)']]);
  const capturedRack = node('input'); capturedRack.type = 'checkbox'; label('Include the saved creative rack and captured controls', capturedRack);
  const seekPosition = number('Take seek cursor · seconds', 0, 120), seekWindow = number('Seek preview window · seconds', 1, 3), seekSlider = node('input'); seekSlider.type = 'range'; seekSlider.min = '0'; seekSlider.max = '120'; seekSlider.step = '0.001'; seekSlider.value = '0'; seekSlider.setAttribute('aria-label', 'Take seek cursor'); label('Captured take cursor', seekSlider);
  restore.value = 'forward-preroll';
  const seekOnRelease = node('input'); seekOnRelease.type = 'checkbox'; seekOnRelease.setAttribute('aria-label', 'Prelisten when releasing the take seek cursor'); label('Prelisten on cursor release · isolated short window', seekOnRelease);
  const seekInfo = node('output', 'Take seek is private. Stop or completion returns to the existing live performance.'); seekInfo.setAttribute('aria-label', 'Take seek reconstruction status'); fields.append(seekInfo);
  const status = node('output', 'Idle'); status.setAttribute('role', 'status'); const details = node('p'), deliveryStatus = node('output'); deliveryStatus.setAttribute('aria-label', 'Rendered file delivery');
  const file = node('select'); file.setAttribute('aria-label', 'Prepared rendered file');
  const say = text => { if (!disposed) { deliveryStatus.textContent = text; try { onStatus(text); } catch { /* Status does not own a prepared render. */ } } };
  const run = action => async () => { try { await action(); } catch (error) { say(error.message); } paint(); };
  const button = (text, callback) => { const element = node('button', text); element.type = 'button'; listen(element, 'click', callback); actions.append(element); return element; };
  const preparedBundle = () => displayComparison === 'body' ? bodyComparisonOwner?.getPrepared() : displayComparison ? comparisonOwner?.getPrepared() : owner?.getPrepared();
  const rendering = () => preparing || owner?.state().active || comparisonOwner?.state().active || bodyComparisonOwner?.state().active;
  const chosenEntry = () => { const bundle = preparedBundle(); return bundle && bundle === displayedBundle ? bundle.files.find(entry => entry.id === file.value) || null : null; };
  const chosen = () => chosenEntry()?.artifact || null;
  const prelisten = createPreparedWavePrelisten({ audio, resourceBudget, onState: () => surface.invalidate() });
  const seekOwner = audio ? createCausalTakeSeekOwner({ audio, journal, resourceBudget, jobs, getMaterialProvider, onState: () => surface.invalidate(), onReveal: () => { if (!disposed && !dialog.open) dialog.showModal(); } }) : null;
  const requestSeek = async () => {
    const captured = restore.value === 'initial-owned-image';
    if (!seekOwner || !source || (captured ? !source.ownedImageAvailable : source.unavailable) || loading || rendering() || picker || delivery) throw new Error('Choose a complete saved take and available isolated audio before seeking.');
    const saved = sourceModel.value === 'saved-instrument', model = CAUSAL_RENDER_SOURCES.find(model => model.id === sourceModel.value), selected = source, serial = loadSerial, selectedModel = sourceModel.value;
    if (!captured && (saved ? !instrumentReference || !instrumentSupported : !model)) throw new Error('Choose an available render source before seeking.');
    const sampleRate = captured ? source.ownedRate : Number(rate.value), startSeconds = Math.round(Number(seekPosition.value) * sampleRate) / sampleRate, seconds = Number(seekWindow.value), endSeconds = Math.min(120, captured ? source.ownedSeconds : source.seconds, startSeconds + seconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3 || !Number.isFinite(startSeconds) || startSeconds < 0 || endSeconds <= startSeconds) throw new Error('Choose a cursor inside the captured range and a preview window up to three seconds.');
    const effects = captured ? {} : prepareCausalEffectSelection({ preset: effect.value, send01: Number(effectSend.value), includeReturn: false, rack: effect.value === 'saved-owner' ? getSavedRack() : null, sampleRate });
    const receipt = await seekOwner.seek({ ...(captured ? {} : { definition: saved ? instrumentReference.definition : model.definition, materialReference: saved ? instrumentReference : null }), takeId: source.takeId, takeRevision: source.revision, sampleRate, startSeconds, endSeconds,
      timeTransformMode: timingMode.value, restorationMode: restore.value, includeRack: capturedRack.checked, ...effects, isCurrent: () => !disposed && serial === loadSerial && source === selected && sourceModel.value === selectedModel });
    if (receipt.status === 'superseded' || receipt.status === 'canceled') return receipt;
    say('Private seek prepared at ' + receipt.startSeconds.toFixed(3) + ' s using ' + receipt.restoration.mode + '. Original physical events and the live world are unchanged.'); return receipt;
  };
  const auditionSeek = button('Prelisten from take cursor', run(requestSeek)), stopSeek = button('Stop take seek preview', run(async () => { const receipt = seekOwner?.stop(); await receipt?.completion; if (receipt && receipt.outcome !== 'complete') throw new Error('Take seek retirement remains unresolved.'); }));
  const useSeekRange = button('Use cursor as render start', () => { if (!source || (restore.value === 'initial-owned-image' ? !source.ownedImageAvailable : source.unavailable) || rendering() || loading) return; first.value = seekPosition.value; if (Number(last.value) <= Number(first.value)) last.value = String(Math.min(restore.value === 'initial-owned-image' ? source.ownedSeconds : source.seconds, Number(first.value) + Number(seekWindow.value))); say('Render start set explicitly. Private seek did not restore or change the live world.'); paint(); });
  listen(seekSlider, 'input', () => { seekPosition.value = seekSlider.value; });
  listen(seekSlider, 'change', () => { seekPosition.value = seekSlider.value; if (seekOnRelease.checked) void run(requestSeek)(); });
  listen(seekPosition, 'change', () => { seekSlider.value = seekPosition.value; if (seekOnRelease.checked) void run(requestSeek)(); });
  listen(seekSlider, 'pointercancel', () => seekOwner?.stop());
  const listenPrepared = button('Prelisten selected WAV from start', run(async () => {
    const selected = chosenEntry(), bundle = preparedBundle(); if (!selected || rendering() || loading || picker || delivery) return;
    const previous = prelisten.stop(); await previous.completion; if (previous.outcome !== 'complete') throw new Error('The preceding WAV preview retains unresolved ownership.');
    const serial = loadSerial, receipt = await prelisten.play({ file: selected, level01: selected.previewGain01 ?? 1, source: { name: selected.label.slice(0, 256), kind: displayComparison === 'body' ? 'body-take-readout' : displayComparison ? 'graft-take-readout' : 'rendered-take-readout', revision: selected.manifest.pcmHash, sourceRef: selected.manifest.pcmHash },
      isCurrent: () => !disposed && serial === loadSerial && bundle === preparedBundle() && selected === chosenEntry(), onReveal: () => { if (!disposed && !dialog.open) dialog.showModal(); } });
    say(displayComparison === 'body' ? 'Playing the same captured phrase through this body with measured RMS attenuation on PRELISTEN. Raw WAV gain is unchanged. Listening acceptance remains unverified.' : 'Playing the selected aligned readout through PRELISTEN from frame zero. Fixed authored gain; cue level and 8 ms edge fades only. Audibility and listening acceptance remain unverified.'); return receipt;
  }));
  const stopPrelisten = button('Stop WAV prelisten', run(async () => { const receipt = prelisten.stop(); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('WAV preview retirement remains unresolved.'); }));
  const showPrelisten = button('Show PRELISTEN route', () => onPrelisten?.());
  const prepareCapturedWav = async () => {
    if (!source?.ownedImageAvailable || loading || rendering() || picker || delivery) return;
    const selected = source, serial = loadSerial; preparing = true; paint();
    try { await owner.prepareCaptured({ takeId: selected.takeId, takeRevision: selected.revision, startSeconds: Number(first.value), endSeconds: Number(last.value), includeRack: capturedRack.checked, isCurrent: () => !disposed && serial === loadSerial && source === selected });
      displayComparison = null; say(capturedRack.checked ? 'Captured owned sources and saved rack prepared at the original audio clock, including held state and control curves. Final master protection is excluded; live PCM equivalence awaits qualification.' : 'Captured owned dry sources prepared at the original audio clock. Creative rack and final protection are excluded; live PCM equivalence awaits qualification.');
    } finally { preparing = false; paint(); }
  };
  const renderButton = button('Prepare revoice WAV', run(async () => {
    if (restore.value === 'initial-owned-image') return prepareCapturedWav();
    if (!source || loading || rendering() || picker || delivery) return;
    const saved = sourceModel.value === 'saved-instrument', model = CAUSAL_RENDER_SOURCES.find(model => model.id === sourceModel.value);
    if (saved ? !instrumentReference || !instrumentSupported : !model) throw new Error('Choose an available render source.');
    preparing = true; paint();
    try {
      if (effect.value !== 'none') effectWorkspace ||= createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-render-effect-selection', kind: 'render-effect-selection', category: 'audio', bytes: 512 * 1024 });
      const effects = prepareCausalEffectSelection({ preset: effect.value, send01: Number(effectSend.value), includeReturn: effectReturn.checked, rack: effect.value === 'saved-owner' ? getSavedRack() : null, sampleRate: Number(rate.value) });
      await owner.prepare({ definition: saved ? instrumentReference.definition : model.definition, materialReference: saved ? instrumentReference : null, takeId: source.takeId, takeRevision: source.revision, sampleRate: Number(rate.value), startSeconds: Number(first.value), endSeconds: Number(last.value),
        tail: { mode: tail.value, maxSeconds: Number(tailSeconds.value) }, includeAllLaneStems: stems.checked, timeTransformMode: timingMode.value, extendGrooveOutput: groovePadding.checked, restorationMode: restore.value, ...effects });
      displayComparison = null; say('Rendered WAV files are prepared. Choose a file and a delivery action; the original take is unchanged.');
    } finally { preparing = false; paint(); }
  }));
  const capturedRender = button('Prepare captured owned sound · dry WAV', run(prepareCapturedWav));
  const harvest = button('Harvest selected file as seed', run(async () => {
    const entry = chosenEntry();
    if (!entry?.artifact.metadata().retained || !onHarvest || rendering() || loading || picker || delivery) return;
    dialog.close(); await onHarvest({ artifact: entry.artifact, manifest: entry.manifest });
  }));
  const keepOriginal = button('Keep saved instrument as comparison original', run(() => {
    if (!instrumentReference || !instrumentSupported || rendering() || loading || picker || delivery) return;
    originalWorkspace ||= createOwnedResourceReservation({ budget: resourceBudget, owner: 'causal-render-comparison-original', kind: 'explicit-original-instrument-reference', bytes: 1048576 });
    originalWorkspace.resize(1048576); const inventory = canonicalDataText(instrumentReference, { maxBytes: 65536, maxNodes: 8192 });
    originalComparisonReference = validateSoundContentReference(JSON.parse(inventory.text)); originalWorkspace.resize(4096 + inventory.bytes.length * 8);
    say('Comparison original pinned: ' + originalComparisonReference.patchId + ' @' + originalComparisonReference.revision + '. Open the graft instrument on the same take, then prepare the four readouts.');
  }));
  const compareGraft = button('Prepare four-way graft comparison', run(async () => {
    if (!source || source.unavailable || !originalComparisonReference || !instrumentReference || !instrumentSupported || loading || picker || delivery || rendering()) return;
    if (effect.value !== 'none') throw new Error('Choose Dry source graph for the four-way comparison. Compare an effects rack separately.');
    const serial = loadSerial, selected = source; preparing = true; paint();
    try {
      await comparisonOwner.prepare({ takeId: selected.takeId, takeRevision: selected.revision, originalReference: originalComparisonReference, graftReference: instrumentReference, sampleRate: Number(rate.value), startSeconds: Number(first.value), endSeconds: Number(last.value), tail: { mode: tail.value, maxSeconds: Number(tailSeconds.value) }, isCurrent: () => !disposed && serial === loadSerial && source === selected });
      displayComparison = 'graft'; say('Four aligned take readouts prepared at fixed authored gain: original, exciter only, body after excitation and full graft. Select a WAV for PRELISTEN, delivery or seed inspection. PRELISTEN permits sixteen seconds including tails. Listening qualification remains pending.');
    } finally { preparing = false; paint(); }
  }));
  const compareBodies = button('Compare recorded body revisions · same sine', run(async () => {
    if (!source || source.unavailable || loading || picker || delivery || rendering()) return;
    const serial = loadSerial, selected = source; preparing = true; paint();
    try {
      const previous = prelisten.stop(); await previous.completion; if (previous.outcome !== 'complete') throw new Error('The preceding preview retains its source.');
      if (disposed || serial !== loadSerial || source !== selected) throw new Error('Body comparison canceled.');
      await bodyComparisonOwner.prepare({ takeId: selected.takeId, takeRevision: selected.revision, sampleRate: Number(rate.value), startSeconds: Number(first.value), endSeconds: Number(last.value), tail: { mode: tail.value }, isCurrent: () => !disposed && serial === loadSerial && source === selected });
      displayComparison = 'body'; say('Body revisions prepared from the same captured phrase and sine source. PRELISTEN matches whole-file RMS by attenuation; raw WAV files keep their original gain. This is a new static body comparison, not the original live performance.');
    } finally { preparing = false; paint(); }
  }));
  compareBodies.title = 'Use an exact window of at most sixteen seconds, including the body decay. The take must contain two to four recorded modal body revisions.';
  const cancelRender = button('Cancel render', () => { loadSerial++; owner.cancel(); comparisonOwner.cancel(); bodyComparisonOwner.cancel(); });
  const download = button('Download selected WAV', run(() => {
    const artifact = chosen(); if (!artifact || rendering() || loading || picker || delivery) return;
    const result = deliverArtifactToAnchor(artifact, { document, windowRef: window }); lastDelivery = result;
    say(result.state === 'delivery-requested' ? 'Download requested. Browser completion is unacknowledged; the prepared WAV remains available.' : `Download ${result.state}: ${result.errorKind || result.evidence}.`);
  }));
  const save = button('Save selected WAV…', run(async () => {
    const artifact = chosen(); if (!artifact || rendering() || loading || picker || delivery) return;
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
  const discard = button('Discard prepared WAVs', run(() => { if (rendering() || loading || picker || delivery) return; const receipt = preparedBundle()?.discard();
    say(receipt?.outcome === 'partial' ? 'Prepared file retirement is unresolved.' : 'Prepared WAVs discarded; the original take is unchanged.'); }));
  const close = () => { loadSerial++; readController?.abort(); owner.cancel(); comparisonOwner.cancel(); bodyComparisonOwner.cancel(); prelisten.stop(); seekOwner?.stop(); delivery?.abort(); dialog.close(); };
  button('Close', close); listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  function paint() {
    if (disposed || !owner || !comparisonOwner || !bodyComparisonOwner) return;
    const capturedPolicy = restore.value === 'initial-owned-image';
    if (capturedPolicy && source?.ownedRate) rate.value = String(source.ownedRate);
    seekPosition.max = seekSlider.max = String(Math.min(120, (capturedPolicy ? source?.ownedSeconds : source?.seconds) ?? 120));
    const rendered = owner.state(), graft = comparisonOwner.state(), body = bodyComparisonOwner.state(), comparison = body.active ? body : graft.active ? graft : displayComparison === 'body' ? body : graft, preview = prelisten.state(), current = comparison.active ? comparison : rendered.active ? rendered : displayComparison ? comparison : rendered, busy = preparing || rendered.active || graft.active || body.active || preview.active, bundle = preparedBundle();
    sourceText.textContent = source ? `${source.takeName} · revision ${source.revision} · ${source.hash.slice(0, 16)} · ${source.seconds == null ? 'capture clock unavailable' : source.seconds.toFixed(3) + ' captured physical seconds'}${source.ownedSeconds != null ? ' · ' + source.ownedSeconds.toFixed(3) + ' owned audio seconds' : ''}` : loading ? 'Reading saved take boundaries…' : 'No selected saved take.';
    if (bundle !== displayedBundle) { displayedBundle = bundle; file.replaceChildren(); for (const entry of bundle?.files || []) { const option = node('option', entry.label); option.value = entry.id; file.append(option); } }
    const artifact = chosen()?.metadata();
    status.textContent = loading ? 'Reading take' : preparing && !rendered.active && !comparison.active ? 'Preparing render' : preview.active ? 'PRELISTEN · ' + preview.phase : `${current.phase}${current.progress ? ` · ${current.progress.completedUnits.toLocaleString()} / ${current.progress.totalUnits.toLocaleString()} frames` : ''}`;
    listenPrepared.disabled = !audio || busy || loading || picker || !!delivery || !artifact?.retained || !!preview.unresolvedRetirement || chosenEntry()?.manifest.frames > chosenEntry()?.manifest.sampleRate * 16;
    stopPrelisten.disabled = !preview.active; showPrelisten.disabled = !onPrelisten;
    const seek = seekOwner?.state(), seekReady = !!seekOwner && !['stopping', 'retirement-unknown'].includes(seek.phase) && !!source && (capturedPolicy ? source.ownedImageAvailable : !source.unavailable) && !loading && !rendering() && !picker && !delivery && (capturedPolicy || !(sourceModel.value === 'saved-instrument' && !instrumentSupported));
    auditionSeek.disabled = !seekReady; stopSeek.disabled = !seek?.active && !seek?.playing && !seek?.retainedCandidates; useSeekRange.disabled = !seekReady; seekPosition.disabled = seekSlider.disabled = seekWindow.disabled = seekOnRelease.disabled = !seekReady;
    seekInfo.textContent = seek?.error || (seek?.last ? 'Private seek · ' + seek.phase + ' · ' + seek.last.startSeconds.toFixed(3) + ' s · ' + seek.last.restoration.mode + ' · ' + seek.last.sampleRate + ' Hz. Captured history is reconstructed before this window; exact PCM equivalence remains separately qualified.' : 'Private seek · ' + (seek?.phase || 'audio unavailable') + '. Stop or completion returns to the existing live performance; Use cursor changes only the explicit render range.');
    instrumentInfo.textContent = instrumentError || (instrumentReference ? 'Saved instrument ' + instrumentReference.patchId + ' @' + instrumentReference.revision + ' · ' + instrumentReference.assetHashes.length + ' local source references. ' + (!instrumentSupported ? 'Its offline renderer is unavailable in this browser or source profile.' : sourceModel.value === 'saved-instrument' ? 'The next render uses its saved defaults and available recorded physical controls.' : 'Select Saved instrument to use this revision; the current source choice uses its own default controls.') : 'Open this dialog with a saved lane instrument to use its exact revision.');
    details.textContent = current.error || (bundle?.manifest.mode === 'captured-owned-source-image-and-actual-command-history' ? 'Captured owned sound · ' + bundle.manifest.restoration.initialHeldVoices + ' initially held voices restored without invented onsets · ' + bundle.manifest.frames.toLocaleString() + ' stereo frames at original ' + bundle.manifest.sampleRate + ' Hz. ' + (bundle.manifest.realization.creativeRack?.schema ? 'Saved creative rack state and captured controls included; final protection excluded.' : 'Creative rack and final protection excluded.') + ' PCM equivalence remains unqualified.' : capturedPolicy && source?.ownedImageAvailable ? 'Choose an audio-clock crop. Captured source images continue their held voices and actual command history at the original sample rate. Choose dry output or include its saved creative rack and captured controls.' : source?.unavailable) || (bundle?.manifest.schema === 'lemmings-captured-body-comparison/v1' ? `${bundle.files.length} recorded body revisions · same captured phrase and sine source · RMS-matched PRELISTEN. Raw WAV files retain original gain. Published defaults replace captured gestures; listening acceptance is unverified.` : bundle?.manifest.schema === 'lemmings-graft-take-comparison/v1' ? `Four readouts of ${bundle.manifest.takeId} @${bundle.manifest.takeRevision} · ${bundle.manifest.frames.toLocaleString()} common stereo frames at ${bundle.manifest.sampleRate} Hz. Fixed authored gain; no loudness normalization. Original: ${originalComparisonReference?.patchId || 'explicit pinned reference'}. Listening qualification pending.` : bundle ? `Prepared ${bundle.manifest.engineRequirement.engineId} from ${bundle.manifest.takeId} · ${bundle.manifest.frames.toLocaleString()} stereo frames at ${bundle.manifest.sampleRate} Hz · ${bundle.manifest.tail.mode} · ${bundle.files.length} file(s). Master protection is excluded.${bundle.manifest.timing?.groove ? ' Groove offset max ' + bundle.manifest.timing.groove.maximumOutputDisplacementMs.toFixed(2) + ' ms; RMS ' + bundle.manifest.timing.groove.rmsOutputDisplacementMs.toFixed(2) + ' ms; output padding ' + Number(bundle.manifest.timing.outputPaddingSeconds || 0).toFixed(3) + ' s.' : ''}` :
      'Choose a range and prepare. Rendering does not enable live audio or audition the result.');
    capturedRender.disabled = loading || busy || !source?.ownedImageAvailable || !!rendered.unresolvedRetirement || picker || !!delivery;
    capturedRack.disabled = busy || loading || !source?.ownedImageAvailable; capturedRender.textContent = capturedRack.checked ? 'Prepare captured sound + rack WAV' : 'Prepare captured owned dry WAV';
    renderButton.textContent = capturedPolicy ? capturedRender.textContent : 'Prepare revoice WAV';
    renderButton.disabled = loading || busy || !source || (capturedPolicy ? !source.ownedImageAvailable : !!source.unavailable || sourceModel.value === 'saved-instrument' && !instrumentSupported) || !!(rendered.unresolvedRetirement || comparison.unknownRetirement) || picker || !!delivery;
    keepOriginal.disabled = busy || loading || picker || !!delivery || !instrumentReference || !instrumentSupported;
    compareGraft.disabled = busy || loading || picker || !!delivery || !source || !!source.unavailable || !originalComparisonReference || !instrumentSupported || !(instrumentReference?.definition.parameters?.graftModeCount > 0) || !!comparison.unknownRetirement || effect.value !== 'none';
    compareBodies.disabled = busy || loading || picker || !!delivery || !source || !!source.unavailable || !!body.unknownRetirement || !!graft.unknownRetirement || tail.value !== 'exact-crop';
    cancelRender.disabled = !preparing && !rendered.active && !comparison.active; first.disabled = last.disabled = sourceModel.disabled = rate.disabled = tail.disabled = stems.disabled = busy || loading;
    const selectedEngine = sourceModel.value === 'saved-instrument' ? instrumentReference?.engineRequirement.engineId : sourceModel.value;
    const nativeRestore = !capturedPolicy && (NATIVE_OFFLINE_SOURCE_IDS.includes(selectedEngine) || effect.value === 'captured-controls');
    sourceModel.disabled ||= capturedPolicy; rate.disabled ||= capturedPolicy; tail.disabled ||= capturedPolicy; stems.disabled ||= capturedPolicy;
    const hasEffects = effect.value !== 'none';
    effect.disabled = busy || loading || capturedPolicy; effectReturn.disabled = busy || loading || !hasEffects; effectSend.disabled = effectReturn.disabled || effect.value === 'captured-controls';
    effectInfo.textContent = !hasEffects ? 'Dry source graph. No creative effect graph is added.' :
      effect.value === 'captured-controls' ? 'Revoices captured controls with cleared initial memory. Changing owned bodies retain recorded input ramps and bounded tails, with at most two graphs at once. Older transitions without timing evidence, native convolution, external donors and body-only lifecycle commands may be unavailable. This does not reconstruct original live PCM.' : 'Creates a new realization with a constant authored send. Live effect gestures are not replayed. Dry lanes and shared return come from one full graph; final protection is excluded. Native convolution bodies require their offline adapter.';
    tailSeconds.max = hasEffects ? '30' : '4'; if (Number(tailSeconds.value) > Number(tailSeconds.max)) tailSeconds.value = tailSeconds.max;
    restore.disabled = busy || loading; for (const option of restore.options) { if (option.value === 'owned-state-cut') option.disabled = nativeRestore; else if (option.value === 'initial-owned-image') option.disabled = !source?.ownedImageAvailable; } if (nativeRestore && restore.value === 'owned-state-cut') restore.value = 'forward-preroll';
    tailSeconds.disabled = busy || loading || tail.value === 'exact-crop'; file.disabled = busy || loading || picker || !!delivery || !bundle;
    const ready = !!(artifact || chosen()?.metadata())?.retained;
    harvest.disabled = !ready || !onHarvest || busy || loading || picker || !!delivery;
    download.disabled = !ready || busy || loading || picker || !!delivery; save.disabled = download.disabled || typeof window.showSaveFilePicker !== 'function';
    cancelSave.disabled = !delivery; discard.disabled = !bundle || busy || loading || picker || !!delivery;
  }
  const surface = scheduler.register({ id: 'causal-render-dialog', element: dialog, intervalMs: 50, write: paint, onError: say });
  owner = createCausalTakeAudioRenderer({ journal, resourceBudget, jobs, getMaterialProvider, onState: () => surface.invalidate() });
  comparisonOwner = createGraftTakeComparisonOwner({ journal, resourceBudget, jobs, getMaterialProvider, onState: () => surface.invalidate() });
  bodyComparisonOwner = createCapturedBodyComparisonOwner({ journal, resourceBudget, jobs, onState: () => surface.invalidate() });
  for (const control of [sourceModel, effect, effectSend, rate, restore, timingMode, capturedRack]) listen(control, 'change', () => { seekOwner?.stop(); paint(); });
  listen(file, 'change', () => { prelisten.stop(); paint(); }); listen(tail, 'change', paint);
  dialog.append(title, description, sourceText, limits, fields, instrumentInfo, status, details, file, deliveryStatus, actions);
  (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ async open({ takeId, instrumentRef = null } = {}) {
    if (disposed) return; if (readFaults.size) throw new Error('Take metadata reader retirement remains unresolved.');
    owner.cancel(); comparisonOwner.cancel(); bodyComparisonOwner.cancel(); prelisten.stop(); seekOwner?.stop(); captureInstrument(instrumentRef);
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
        const ownedClock = manifest.stopBoundaryState?.['owned-audio-clock'];
        const ownedSeconds = ownedClock && Number.isSafeInteger(ownedClock.frames) && [44100, 48000, 96000].includes(ownedClock.sampleRate) ? ownedClock.frames / ownedClock.sampleRate : null;
        const ownedImageAvailable = ['finalized', 'partial'].includes(manifest.state) && !manifest.prefix && !!manifest.boundaryState?.['owned-audio'] && ownedSeconds > 0 && manifest.coverage?.available?.stateKinds?.includes('owned-source-commands') && !manifest.coverage.gaps.some(gap => ['all', 'owned-source-commands', 'owned-audio'].includes(gap.kind));
        source = Object.freeze({ takeId: manifest.takeId, takeName: manifest.takeName, revision: manifest.revision, hash: manifest.canonicalHash, seconds, unavailable, ownedSeconds, ownedImageAvailable, ownedRate: ownedClock?.sampleRate || null });
        if (ownedImageAvailable && unavailable) restore.value = 'initial-owned-image'; else if (!ownedImageAvailable && restore.value === 'initial-owned-image') restore.value = 'forward-preroll';
        first.value = '0'; seekPosition.value = seekSlider.value = '0'; last.value = String(Math.min(10, ownedImageAvailable ? ownedSeconds : seconds ?? 1)); first.max = last.max = String(Math.min(120, Math.max(seconds || 0, ownedSeconds || 0) || 120)); seekPosition.max = seekSlider.max = String(Math.min(120, seconds ?? 120));
      } finally { try { retireCausalRead(loan); } catch (error) { readFaults.add({ loan, error }); throw error; } }
    })(); reads.add(work);
    try { await work; } catch (error) { if (!disposed && serial === loadSerial && !controller.signal.aborted) say(error.message); }
    finally { reads.delete(work); if (serial === loadSerial) { loading = false; paint(); } }
  }, state: () => Object.freeze({ render: owner.state(), preparing, comparison: comparisonOwner.state(), prelisten: prelisten.state(), seek: seekOwner?.state() || null, comparisonVisible: !!displayComparison, comparisonKind: displayComparison, bodyComparison: bodyComparisonOwner.state(), originalComparison: originalComparisonReference ? { patchId: originalComparisonReference.patchId, revision: originalComparisonReference.revision, definitionHash: originalComparisonReference.definitionHash } : null, selectedTake: source, sourceModel: sourceModel.value, effectPreset: effect.value, delivery: lastDelivery, pickingFile: picker, writing: !!delivery, unresolvedMetadata: readFaults.size, instrument: instrumentReference ? { patchId: instrumentReference.patchId, revision: instrumentReference.revision, engineId: instrumentReference.engineRequirement.engineId, supported: instrumentSupported } : null }),
  suspend() { readController?.abort(); owner.cancel(); comparisonOwner.cancel(); bodyComparisonOwner.cancel(); prelisten.stop(); seekOwner?.stop(); delivery?.abort(); },
  dispose() {
    if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; loadSerial++; readController?.abort(); delivery?.abort();
    const pendingDelivery = deliveryTask, cueRetirement = prelisten.dispose();
    const retireRender = async renderer => { await cueRetirement.completion; if (cueRetirement.outcome !== 'complete') throw new Error('Rendered sources remain pinned behind unresolved PRELISTEN retirement.'); return renderer.dispose(); };
    return retirement.retire([{ name: 'render-owner', run: () => retireRender(owner) }, { name: 'graft-comparison-owner', run: () => retireRender(comparisonOwner) }, { name: 'body-comparison-owner', run: () => retireRender(bodyComparisonOwner) }, { name: 'accepted-metadata', run: () => Promise.allSettled([...reads]) },
      { name: 'metadata-reader-faults', run: async () => { await Promise.allSettled([...reads]); if (readFaults.size) throw new Error('Take metadata reader retirement remains unresolved.'); } },
      { name: 'render-wav-prelisten', run: () => prelisten.dispose() }, { name: 'take-seek-prelisten', run: () => seekOwner?.dispose() },
      { name: 'accepted-delivery', run: () => pendingDelivery?.catch(() => {}) }, { name: 'render-surface', run: () => surface.dispose() },
      { name: 'render-display-scheduler', run: () => { if (!displayScheduler) return scheduler.dispose(); } },
      ...listeners.splice(0).map((remove, index) => ({ name: 'render-view-listener-' + index, run: remove })),
      { name: 'render-comparison-reference', run: async () => { const receipt = await retireRender(comparisonOwner); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Comparison reference remains owned by an unresolved render.'); originalComparisonReference = null; originalWorkspace?.release(); } },
      { name: 'render-instrument-reference', run: () => { instrumentReference = null; instrumentWorkspace?.release(); } },
      { name: 'render-effect-selection', run: async () => { const receipt = await retireRender(owner); await receipt.completion; if (receipt.outcome !== 'complete') throw new Error('Effect selection remains owned by an unresolved render.'); effectWorkspace?.release(); effectWorkspace = null; } },
      { name: 'render-dialog', run: () => { dialog.close(); dialog.remove(); } }]);
  }
  });
}
