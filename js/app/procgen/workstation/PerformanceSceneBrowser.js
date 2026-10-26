import { inspectSceneStationRehearsal } from './SceneStationPolicy.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createPerformanceSceneBrowser({ document, window, registry, loader, unavailableReason = null, getLiveScene = () => null, onSavedTakes = () => {}, keepPreparedOnClose = () => false, canTeachScene = () => false, onLesson = null, onStatus = () => {} } = {}) {
  if (!document?.createElement || !registry?.page || !loader?.select || !loader?.state) throw new TypeError('The scene browser requires metadata pages and the existing candidate owner.');
  const listeners = [], rowListeners = [], retirement = createProcgenRetirementScope(); let disposed = false, selection = null, selectedManifest = null, page = null, offset = 0, opener = null, busy = false;
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const listen = (target, event, handler, rows = false) => { target.addEventListener(event, handler); (rows ? rowListeners : listeners).push(() => target.removeEventListener(event, handler)); };
  const dialog = node('dialog'), title = node('h2', 'Playable physical scores'), live = node('p'), qualification = node('p', 'Prepare builds a separate candidate; Load fresh replaces the world and sound and leaves transport paused. Rehearse renders six seconds of actual private-world traffic through the selected Prelisten route. CURRENT and NEXT stay unchanged. Rehearsal on live output is included in master capture; a separate-device cue is excluded. Render and listening qualification remain pending.');
  title.id = 'performanceSceneTitle'; dialog.className = 'studio-dialog studio-scene-browser'; dialog.setAttribute('aria-labelledby', title.id);
  const filters = node('div'), search = node('input'); search.type = 'search'; search.setAttribute('aria-label', 'Search physical scores'); filters.append(search);
  const select = (label, entries) => { const wrapper = node('label', label), input = node('select'); input.setAttribute('aria-label', label); for (const [value, text] of entries) { const option = node('option', text); option.value = value; input.append(option); } wrapper.append(input); filters.append(wrapper); return input; };
  const mechanism = select('Physical mechanism', [['', 'All mechanisms'], ...['crossing', 'work', 'flight', 'encounter', 'travel', 'contact', 'terrain', 'cooperation'].map(value => [value, value])]);
  const density = select('Density', [['', 'All densities'], ['sparse', 'Sparse'], ['medium', 'Medium'], ['dense', 'Dense']]);
  const lesson = select('Lesson level', [['', 'All lesson levels'], ...Array.from({ length: 6 }, (_, value) => [String(value), String(value)])]);
  const rows = node('div'), details = node('section'), paging = node('div'), actions = node('div'), status = node('output'); rows.setAttribute('role', 'listbox'); rows.setAttribute('aria-label', 'Scene versions'); details.setAttribute('aria-label', 'Selected physical score'); status.setAttribute('role', 'status');
  const say = text => { if (disposed) return; status.textContent = text; try { onStatus(text); } catch {} };
  const run = action => async () => { if (disposed || busy) return; busy = true; refresh(); try { await action(); } catch (error) { say(error.message); } finally { busy = false; refresh(); } };
  const button = (parent, text, action) => { const value = node('button', text); value.type = 'button'; listen(value, 'click', action); parent.append(value); return value; };
  const chosen = row => selection?.id === row.id && selection?.version === row.version && selection?.hash === row.hash;
  const showDetails = () => {
    details.replaceChildren(); if (!selection) { details.append(node('p', 'No score selected.')); return; }
    details.append(node('h3', 'PREVIEW · ' + selection.title));
    if (!selectedManifest) { details.append(node('p', selection.reason || 'This scene version is inspectable but unsupported.')); return; }
    details.append(node('p', selectedManifest.description), node('p', selectedManifest.cost.lanes + ' lanes · at most ' + selectedManifest.cost.maximumVoices + ' authored voices · ' + selectedManifest.cost.sharedBodies + ' shared bodies. Actual source-pool admission is checked during preparation.'));
    const landmarks = node('ol');
    for (const landmark of selectedManifest.expectedLandmarks) landmarks.append(node('li', landmark.observationKind + ' · ' + landmark.sourceObjectId + ': ' + landmark.consequence + ' ' + landmark.help));
    details.append(landmarks);
    if (selectedManifest.physicalControls.length) { const controls = node('ul'); for (const control of selectedManifest.physicalControls) controls.append(node('li', control.label + ': ' + control.minimum + '–' + control.maximum + ' ' + control.unit + ' · ' + control.scope)); details.append(controls); }
    const requirements = node('details'), summary = node('summary', 'Source versions, required capabilities and credits'); requirements.append(summary);
    for (const requirement of selectedManifest.requirements.required) requirements.append(node('p', requirement.description + ' · ' + requirement.kind + '/' + requirement.id + ' r' + requirement.revision));
    requirements.append(node('p', selectedManifest.sourceVersion.id + ' r' + selectedManifest.sourceVersion.revision + ' · build ' + selectedManifest.sourceVersion.hash));
    for (const credit of selectedManifest.credits) requirements.append(node('p', credit.name + ' · ' + credit.role)); details.append(requirements);
  };
  const choose = row => {
    if (disposed) return; selection = row; selectedManifest = null;
    try { if (row.supported) { selectedManifest = registry.resolve(row); loader.select(selectedManifest); } else void loader.cancel().catch(error => say(error.message)); }
    catch (error) { say(error.message); }
    for (const child of rows.children) child.setAttribute('aria-selected', child.dataset?.sceneKey === row.id + ':' + row.version ? 'true' : 'false');
    showDetails(); refresh();
  };
  const renderPage = () => {
    for (const remove of rowListeners.splice(0)) remove(); rows.replaceChildren();
    page = registry.page({ query: search.value, mechanism: mechanism.value || null, density: density.value || null, lessonLevel: lesson.value === '' ? null : Number(lesson.value), offset, limit: 24 });
    if (!page.rows.length) { rows.append(node('p', unavailableReason || 'No scenes match these filters.')); selection = selectedManifest = null; void loader.cancel().catch(error => say(error.message)); showDetails(); }
    for (const row of page.rows) {
      const entry = node('button', row.title + (row.cost ? ' · ' + row.cost.lanes + ' lanes / ' + row.cost.maximumVoices + ' voice bound' : '') + ' · ' + (row.supported ? 'requirements unchecked' : 'unsupported version'));
      entry.type = 'button'; entry.setAttribute('role', 'option'); entry.setAttribute('aria-selected', chosen(row) ? 'true' : 'false'); entry.dataset.sceneKey = row.id + ':' + row.version;
      listen(entry, 'click', () => choose(row), true); rows.append(entry);
    }
    previous.disabled = offset === 0; next.disabled = page.nextOffset === null;
    pageLabel.textContent = page.total ? (offset + 1) + '–' + Math.min(offset + page.rows.length, page.total) + ' of ' + page.total : '0 scenes';
    if (page.rows.length && !page.rows.some(chosen)) choose(page.rows[0]); refresh();
  };
  const previous = button(paging, 'Previous scores', () => { offset = Math.max(0, offset - 24); renderPage(); });
  const pageLabel = node('output'); paging.append(pageLabel); const next = button(paging, 'Next scores', () => { if (page.nextOffset !== null) { offset = page.nextOffset; renderPage(); } });
  const prepare = button(actions, 'Prepare fresh', run(async () => { if (!selectedManifest) return; loader.select(selectedManifest); const result = await loader.prepare(); say(result.status === 'ready' ? 'Candidate ready. Inspect the changed scope, then use Load fresh.' : 'Required source or capabilities are unavailable. The live world remains active.'); }));
  const load = button(actions, 'Load fresh · stopped replacement', run(async () => { const result = await loader.apply(); say(result.status === 'committed' ? 'Scene loaded paused. Enable local audio explicitly, then perform a real physical intervention.' : 'Scene replacement canceled.'); }));
  const rehearse = button(actions, 'Rehearse locally', run(() => loader.rehearse())); rehearse.disabled = true; rehearse.title = 'Enable browser audio and select a Prelisten route first. This creates a new private physical phrase, not a recording of CURRENT.';
  const stationRehearsal = button(actions, 'Rehearse with private work stations', run(() => loader.rehearse({ authoredStations: true }))); stationRehearsal.hidden = true; stationRehearsal.title = 'Explicitly arms one-shot skill stations only in the private rehearsal copy. CURRENT and NEXT feedback state is unchanged.';
  const learn = typeof onLesson === 'function' ? button(actions, 'Learn this physical cause', run(async () => { const scene = selectedManifest; if (!scene || !canTeachScene(scene)) return; await loader.cancel(); if (selectedManifest !== scene) return; if (dialog.open) dialog.close(); await onLesson(scene); })) : null;
  const stopRehearsal = button(actions, 'Stop rehearsal', () => { void loader.stopPreview().catch(error => say(error.message)); });
  button(actions, 'Cancel preparation', () => { void loader.cancel().catch(error => say(error.message)); });
  button(actions, 'Open saved takes', run(async () => { await loader.cancel(); if (dialog.open) dialog.close(); await onSavedTakes(); }));
  const close = async () => { if (dialog.open) dialog.close(); if (keepPreparedOnClose() && loader.state().canApply) await loader.stopPreview(); else await loader.cancel(); opener?.focus?.(); };
  button(actions, 'Close', () => { void close().catch(error => say(error.message)); }); listen(dialog, 'cancel', event => { event.preventDefault(); void close().catch(error => say(error.message)); });
  for (const input of [search, mechanism, density, lesson]) listen(input, input === search ? 'input' : 'change', () => { offset = 0; renderPage(); });
  listen(rows, 'keydown', event => { if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !page?.rows.length) return; event.preventDefault(); const at = page.rows.findIndex(chosen), index = event.key === 'Home' ? 0 : event.key === 'End' ? page.rows.length - 1 : Math.max(0, Math.min(page.rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1))); choose(page.rows[index]); rows.children[index]?.focus(); });
  function refresh() {
    if (disposed) return; const state = loader.state(), active = getLiveScene(); live.textContent = 'LIVE · ' + (active?.title || 'Current physical world');
    if (learn) learn.disabled = busy || !selectedManifest || !canTeachScene(selectedManifest);
    prepare.disabled = busy || !selectedManifest || state.retirementUnknown || state.disposed; load.disabled = busy || !state.prepared || state.phase !== 'ready' || !state.canApply;
    rehearse.disabled = busy || !state.previewAvailable || !state.canApply || !!state.preview; stationRehearsal.hidden = !inspectSceneStationRehearsal(selectedManifest).available; stationRehearsal.disabled = rehearse.disabled || stationRehearsal.hidden; stopRehearsal.disabled = !state.preview;
    if (state.error) status.textContent = state.error.message;
    else if (state.pending || ['world-source', 'world-assets', 'world-geometry', 'sound-assets', 'sound-compile', 'resource-admission'].includes(state.phase)) status.textContent = 'Preparing: ' + state.phase + '. Live world retained.';
    else if (state.preview) status.textContent = state.preview.state === 'preparing' ? 'Rehearsal: capturing a bounded checkpoint, simulating a private world and rendering its observed intents. CURRENT and NEXT stay unchanged.' : (state.preview.playing ? 'Playing private rehearsal' : 'Rehearsal ended') + ' · ' + state.preview.ticks + ' observed ticks · ' + (state.preview.cueIncludedInMasterCapture ? 'live output; included in master capture.' : 'separate-device cue; excluded from master capture.') + ' Stop rehearsal releases its prepared preview.';
    else if (state.prepared) status.textContent = 'Ready: replaces world, sound and physical mappings; transport will be paused. Local audio and recording are not enabled by the scene.';
    if (state.preview?.stations) status.textContent += ' Private stations: ' + state.preview.stations.requested + ' requested, ' + state.preview.stations.applied + ' applied, ' + state.preview.stations.rejected + ' rejected and ' + state.preview.stations.pendingAtPrefixEnd + ' pending at the prefix boundary. Live feedback state is unchanged.';
    const proof = state.prepared?.preflight;
    if (proof?.missingOptional.length) status.textContent += ' Optional unavailable: ' + proof.missingOptional.map(entry => entry.dependency.description).join(', ');
  }
  dialog.append(title, live, qualification, filters, rows, paging, details, actions, status); (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  return Object.freeze({ open() { if (disposed) return; opener = document.activeElement; renderPage(); if (!dialog.open) dialog.showModal(); search.focus(); }, refresh, suspend: close,
    dispose() { return retirement.retire([{ name: 'scene-browser', run: async () => { disposed = true; try { await loader.cancel(); } finally { for (const remove of [...rowListeners, ...listeners]) remove(); dialog.remove(); } } }]); } });
}
