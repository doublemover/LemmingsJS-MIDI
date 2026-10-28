import { prepareCircuitWorkshopPack } from './CircuitWorkshopPreparation.js';
import { readStagedDrumKit } from './DrumKitReference.js';
import { CIRCUIT_WORKSHOP_VARIANTS } from '../../midi/content/CircuitWorkshopProfile.js';
import { NATIVE_SOUND_COLLECTIONS } from '../procgen/workstation/NativeSoundCollections.js';
import { NATIVE_OFFLINE_SOURCE_IDS } from './NativeOfflineDriver.js';
import { getOwnedSourceProfile, OWNED_SOURCE_IDS } from './OwnedSourceProfiles.js';
import { getProceduralSoundMaterial } from '../../midi/content/ProceduralSoundMaterial.js';
import { prepareSoundContentPack, planSoundContentSelection } from '../../midi/content/SoundContentPack.js';
import { createSoundContentArchiver } from './SoundContentArchive.js';
import { createSoundContentReader } from './SoundContentReader.js';
import { createSoundContentRegistry } from './SoundContentRegistry.js';
import { stagePreparedSoundContent } from './SoundContentPreparedStage.js';
import { createSoundContentInstallation } from './SoundContentInstallation.js';
import { createSoundContentRenderReferences } from './SoundContentRenderReference.js';
import { getNativeInstrumentCatalog, NATIVE_FM_PARAMETERS } from './NativeInstrumentSchema.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { readBrowserBuildResponse } from '../../runtime/BrowserGenerationService.js';
import { deliverArtifactToAnchor, requestExportFileHandle, deliverArtifactToFileHandle } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const FACTORY_SOURCE = NATIVE_SOUND_COLLECTIONS.find(entry => entry.id === 'native').source;
const FM_FORGE_SOURCE = NATIVE_SOUND_COLLECTIONS.find(entry => entry.id === 'fm-forge').source;
const MATERIAL_SOURCE = NATIVE_SOUND_COLLECTIONS.find(entry => entry.id === 'struck-materials').source;
const PLUCK_SOURCE = NATIVE_SOUND_COLLECTIONS.find(entry => entry.id === 'plucked-garden').source;
const CHOIR_SOURCE = NATIVE_SOUND_COLLECTIONS.find(entry => entry.id === 'artificial-choir').source;
const BIOME_SOURCE = new URL('../../../content/sounds/granular-biomes.json', import.meta.url);
const WIND_SOURCE = new URL('../../../content/sounds/wind-bodies.json', import.meta.url);
const FRICTION_SOURCE = new URL('../../../content/sounds/friction-bodies.json', import.meta.url);
const TEXTURE_SOURCE = new URL('../../../content/sounds/procedural-textures.json', import.meta.url);
const TACTILE_SOURCE = new URL('../../../content/sounds/tactile-contacts.json', import.meta.url);
const SPECTRUM_SOURCE = NATIVE_SOUND_COLLECTIONS.find(entry => entry.id === 'liquid-drawbars').source;
const failure = message => Object.assign(new Error(message), { name: 'SoundContentError' });

export function createSoundContentLibrary({ document, window, audio, resourceBudget, jobs = backgroundJobService, onApply, onStatus = () => {}, monitor = null } = {}) {
  if (!document?.createElement || !resourceBudget || typeof onApply !== 'function') throw new TypeError('Invalid sound library surface.');
  const reader = createSoundContentReader({ resourceBudget, jobs }), archiver = createSoundContentArchiver({ resourceBudget, jobs });
  const registry = createSoundContentRegistry({ indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, resourceBudget });
  const installation = createSoundContentInstallation({ audio, registry, onReveal: () => { if (!disposed && !dialog.open) { monitor?.mount(dialog); dialog.showModal(); } } });
  const renderReferences = createSoundContentRenderReferences({ resourceBudget, jobs, getMaterialProvider: () => audio.getSoundMaterialProvider() });
  const retirement = createProcgenRetirementScope(), listeners = [], factoryFaults = new Map();
  let stage = null, current = null, disposed = false, selection = null, artifact = null, pageCursor = null, installed = false, sequence = 0;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const on = (element, event, callback) => { element.addEventListener(event, callback); listeners.push(() => element.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-sound-library'; dialog.setAttribute('aria-labelledby', 'soundLibraryTitle');
  const title = node('h2', 'Sound library'); title.id = 'soundLibraryTitle';
  const status = node('p', 'Import an instrument or prepare the original oscillator recipes.'); status.setAttribute('role', 'status'); status.setAttribute('aria-label', 'Sound library status');
  const summary = node('p'), modelInfo = node('p'), select = node('select'); select.setAttribute('aria-label', 'Saved instrument revision');
  const gesture = node('select'), gestureLabel = node('label', 'Audition sample gesture'); gesture.setAttribute('aria-label', 'Audition sample gesture'); gestureLabel.append(gesture);
  let gestureSource = null;
  modelInfo.setAttribute('aria-label', 'Instrument source model');
  const credits = node('ul'), rights = node('input'); rights.type = 'checkbox';
  const reviewLabel = node('label'); reviewLabel.append(rights, document.createTextNode(' I reviewed redistribution permission for these exact listed dependencies.'));
  const controls = node('div'); controls.className = 'studio-sound-actions';
  const button = (label, action) => { const element = node('button', label); element.type = 'button'; on(element, 'click', action); controls.append(element); return element; };
  const setStatus = message => { if (!disposed) { status.textContent = message; try { onStatus(message); } catch { /* Status does not own content. */ } } };
  const check = operation => { operation.controller.signal.throwIfAborted(); if (disposed || current !== operation) throw failure('Sound library operation source changed.'); };
  const run = work => {
    if (disposed || current || factoryFaults.size) return Promise.resolve(null);
    const operation = { controller: new AbortController(), sequence: ++sequence }; current = operation; render();
    operation.promise = Promise.resolve().then(() => work(operation)).catch(error => { if (error.drumKitOwnership) factoryFaults.set(operation.sequence, { receipt: error.retirement, ownership: error.drumKitOwnership }); setStatus(error?.message || 'Sound library operation failed.'); return null; })
      .finally(() => { if (current === operation) current = null; render(); }); return operation.promise;
  };
  const reviewRights = entry => rights.checked ? { decision: 'allow', receiptId: 'local-visible-review:' + sequence,
    contentHash: entry.contentHash, rightsHash: entry.rightsHash } : { decision: 'unknown' };
  const selectedPlan = () => {
    if (!stage || !selection) return null; const lease = stage.borrow();
    try { return planSoundContentSelection(lease.prepared, [selection], { availableHashes: lease.metadata.assetHashes, reviewRights }); } finally { lease.release(); }
  };
  const publish = (next, operation) => {
    try { check(operation); } catch (error) { next.discard(); throw error; }
    stage?.discard(); stage = next; installed = false; rights.checked = false; selection = null; select.replaceChildren();
    const lease = stage.borrow();
    try { for (const patch of lease.prepared.patches) { const name = patch.archivedDefinition.name;
      const option = node('option', typeof name === 'string' ? name + ' · ' + patch.identity : patch.identity); option.value = patch.identity; select.append(option); }
    } finally { lease.release(); }
    selection = select.value || null; render();
  };
  const stageDefinitions = async (prepared, operation) => {
    return stagePreparedSoundContent({ prepared, archiver, reader, engineDescriptors: (await getNativeInstrumentCatalog()).descriptors,
      signal: operation.controller.signal, isCurrent: () => current === operation && !disposed, stageIsCurrent: () => !disposed });
  };
  const prepareFactory = (source, name) => run(async operation => {
    let parsed = null, compiled = null, next = null; setStatus('Compiling ' + name + ' recipes…');
    try {
      const catalog = await getNativeInstrumentCatalog(); check(operation);
      if (!catalog.descriptors.length) throw failure('Factory compilation needs an immutable browser build with pinned renderer artifacts.');
      parsed = await jobs.compute({ kind: 'parse-json', ownerId: 'sound-library-source', ownerEpoch: operation.sequence, sourceRevision: source.href,
        inputBytes: 128 * 1024, maxBytes: 128 * 1024, estimatedPeakBytes: 32 * 1048576, deadlineMs: 15000,
        signal: operation.controller.signal, budgetAdapter: resourceBudget, isCurrent: () => current === operation && !disposed,
        prepareInput: async () => new TextDecoder('utf-8', { fatal: true }).decode(await readBrowserBuildResponse(await window.fetch(source,
          { signal: operation.controller.signal, credentials: 'same-origin' }), 128 * 1024, operation.controller.signal)) });
      compiled = await jobs.compute({ kind: 'compile-sound-content', ownerId: 'sound-library-compile', ownerEpoch: operation.sequence, sourceRevision: source.href,
        inputBytes: parsed.receipt.inputBytes, maxBytes: 4 * 1048576, estimatedPeakBytes: 64 * 1048576, deadlineMs: 30000,
        signal: operation.controller.signal, budgetAdapter: resourceBudget, isCurrent: () => current === operation && !disposed, prepareInput: () => parsed.value });
      check(operation); const prepared = await prepareSoundContentPack(compiled.value.pack, { engineDescriptors: catalog.descriptors, signal: operation.controller.signal });
      if (prepared.contentHash !== compiled.value.contentHash) throw failure('Compiled factory content changed before staging.');
      next = await stageDefinitions(prepared, operation);
    } finally {
      const releaseJob = job => { if (!job) return; job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw failure('Factory computation retirement is unresolved.'); };
      const receipt = createProcgenRetirementScope().retire([{ name: 'compiled-factory', run: () => releaseJob(compiled) }, { name: 'parsed-factory', run: () => releaseJob(parsed) }]);
      if (receipt.outcome !== 'complete') { factoryFaults.set(operation.sequence, { receipt, parsed, compiled }); next?.discard(); throw Object.assign(failure('Factory source retirement is unresolved.'), { retirement: receipt }); }
    }
    publish(next, operation); setStatus(name + ' definitions staged. Audition a revision before installing or applying it.');
  });
  const prepareCircuit = () => run(async operation => {
    try {
      const result = await prepareCircuitWorkshopPack({ variant: circuitVariant.value, jobs, reader, resourceBudget, signal: operation.controller.signal, isCurrent: () => current === operation && !disposed, stageIsCurrent: () => !disposed, onProgress: progress => { if (current === operation && !disposed) setStatus('Preparing original Circuit Workshop sources' + (progress.voiceId ? ' · ' + progress.voiceId : '') + '…'); } });
      publish(result.stage, operation); setStatus(result.name + ': ' + result.voices + ' original fixed-source articulations prepared. Audition this exact revision, save its material, then Apply. ROOM remains a separate shared send; the printed-room variant is explicitly baked into these sources. Listening and device qualification are pending.');
    } catch (error) { if (error.circuitWorkshopOwnership) factoryFaults.set(operation.sequence, { receipt: error.retirement, ownership: error.circuitWorkshopOwnership }); throw error; }
  });
  const circuitVariant = node('select'); circuitVariant.setAttribute('aria-label', 'Circuit Workshop prepared-source variant');
  for (const [id, variant] of Object.entries(CIRCUIT_WORKSHOP_VARIANTS)) { const option = node('option', variant.name); option.value = id; circuitVariant.append(option); } controls.append(circuitVariant);
  const circuitFactory = button('Prepare Circuit Workshop · fixed-source edition', prepareCircuit);
  const factory = button('Prepare factory instruments', () => prepareFactory(FACTORY_SOURCE, 'Factory'));
  const fmFactory = button('Prepare FM Forge', () => prepareFactory(FM_FORGE_SOURCE, 'FM Forge'));
  const materialFactory = button('Prepare struck materials', () => prepareFactory(MATERIAL_SOURCE, 'Struck materials'));
  const pluckFactory = button('Prepare plucked garden', () => prepareFactory(PLUCK_SOURCE, 'Plucked garden'));
  const biomeFactory = button('Prepare synthetic granular biomes', () => prepareFactory(BIOME_SOURCE, 'Synthetic granular biomes'));
  const windFactory = button('Prepare breath / wind bodies', () => prepareFactory(WIND_SOURCE, 'Breath and modal wind bodies'));
  const frictionFactory = button('Prepare bowed / friction bodies', () => prepareFactory(FRICTION_SOURCE, 'Bowed and friction bodies'));
  const textureFactory = button('Prepare procedural material textures', () => prepareFactory(TEXTURE_SOURCE, 'Procedural material textures'));
  const tactileFactory = button('Prepare original tactile contacts', () => prepareFactory(TACTILE_SOURCE, 'Original tactile contacts'));
  const choirFactory = button('Prepare artificial choir', () => prepareFactory(CHOIR_SOURCE, 'Artificial choir'));
  const spectrumFactory = button('Prepare liquid tables / drawbars', () => prepareFactory(SPECTRUM_SOURCE, 'Liquid tables and additive drawbars'));
  const importInput = node('input'); importInput.type = 'file'; importInput.accept = '.lemmings-sound,application/vnd.lemmings.sound-pack'; importInput.setAttribute('aria-label', 'Import sound archive');
  on(importInput, 'change', () => { const file = importInput.files?.[0]; importInput.value = ''; if (!file) return;
    void run(async operation => { const catalog = await getNativeInstrumentCatalog(); check(operation); setStatus('Verifying local sound archive…');
      const next = await reader.stageArchive(file, { engineDescriptors: catalog.descriptors, signal: operation.controller.signal, isCurrent: () => !disposed });
      publish(next, operation); setStatus('Archive staged. Inspect requirements and credits before audition or installation.'); });
  });
  const audition = button('Audition controls', () => {
    if (current || factoryFaults.size || !stage || !selection) return;
    const operation = { controller: new AbortController(), sequence: ++sequence }; current = operation; render();
    // Invoke before yielding so the explicit click reaches AudioContext creation/resume.
    setStatus('Preparing the selected instrument and local source for control audition…');
    operation.promise = installation.audition(stage, selection, { signal: operation.controller.signal, sampleGesture: gesture.value || null }).then(() =>
      setStatus('Control audition completed. Physical-take and listening qualification remain separate.')).catch(error => setStatus(error.message))
      .finally(() => { if (current === operation) current = null; render(); });
  });
  const compareSource = mode => {
    if (current || factoryFaults.size || !stage || !selection) return;
    const operation = { controller: new AbortController(), sequence: ++sequence }; current = operation; render();
    setStatus('Preparing dry ' + mode + ' source comparison locally…');
    operation.promise = installation.audition(stage, selection, { signal: operation.controller.signal, sourceMode: mode }).then(receipt =>
      setStatus('Dry ' + mode + ' source comparison completed' + (receipt.sourceComparison.truncated ? ' (first 8 seconds)' : '') + '. Audition instrument controls before Apply.'))
      .catch(error => setStatus(error.message)).finally(() => { if (current === operation) current = null; render(); });
  };
  const originalSource = button('Compare original source (up to 8s)', () => compareSource('original'));
  const sourceRegion = button('Compare source region (up to 8s)', () => compareSource('region'));
  const stop = button('Stop / cancel' , () => { current?.controller.abort(failure('Sound operation canceled.')); installation.stop(); });
  const install = button('Install auditioned pack', () => run(async operation => { await installation.install(stage, { signal: operation.controller.signal, isCurrent: () => current === operation && !disposed });
    check(operation); installed = true; setStatus('Pack installed. Apply remains a separate command.'); }));
  const referenceInstall = button('Keep as reference', () => run(async operation => { await installation.install(stage, { referenceOnly: true, signal: operation.controller.signal, isCurrent: () => current === operation && !disposed });
    check(operation); installed = true; setStatus('Reference pack installed. Missing engines and material remain explicit requirements.'); }));
  const apply = button('Apply to selected lane', () => {
    if (current?.previewLease) {
      try { current.previewLease.commit(); setStatus('Preview committed as one musical edit.'); }
      catch (error) { setStatus(error.message); }
      finally { current?.controller.abort(failure('Preview gesture finished.')); }
      return;
    }
    return run(async operation => { let candidate = installation.applyCandidate(stage, selection); check(operation); const drumKit = await readStagedDrumKit(stage, selection, { signal: operation.controller.signal, resourceBudget }); check(operation); if (drumKit) candidate = Object.freeze({ ...candidate, reference: Object.freeze({ ...candidate.reference, drumKit }) });
      await onApply(candidate, { signal: operation.controller.signal }); check(operation); setStatus('Instrument applied to the selected lane.'); });
  });
  const hold = button('Hold to preview incoming events', () => {});
  hold.setAttribute('aria-label', 'Hold Space, Enter or pointer to preview this instrument on incoming physical events; release to restore');
  const releasePreview = () => { if (current?.mode === 'lane-preview') current.controller.abort(failure('Sound preview released.')); };
  const startPreview = () => {
    if (disposed || current || factoryFaults.size || !installed || !stage || !selection) return;
    let candidate; try { candidate = installation.applyCandidate(stage, selection); } catch (error) { setStatus(error.message); return; }
    const operation = { mode: 'lane-preview', controller: new AbortController(), sequence: ++sequence, previewLease: null }; current = operation;
    const released = new Promise(resolve => operation.controller.signal.addEventListener('abort', resolve, { once: true }));
    hold.setAttribute('aria-pressed', 'true'); render();
    operation.promise = Promise.resolve().then(async () => { const drumKit = await readStagedDrumKit(stage, selection, { signal: operation.controller.signal, resourceBudget }); check(operation); if (drumKit) candidate = Object.freeze({ ...candidate, reference: Object.freeze({ ...candidate.reference, drumKit }) }); return onApply(candidate, { signal: operation.controller.signal, hold: true }); }).then(async lease => {
      operation.previewLease = lease; check(operation); render(); setStatus('Previewing current incoming events. Release restores the prior sound. Apply commits once; held voices retain their onset renderer.'); await released;
    }).catch(error => { if (!operation.controller.signal.aborted) setStatus(error.message); }).finally(async () => {
      const receipt = operation.previewLease?.cancel(); if (receipt?.completion) await receipt.completion;
      if (current === operation) current = null; hold.setAttribute('aria-pressed', 'false'); render();
    });
  };
  on(hold, 'pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); hold.focus(); hold.setPointerCapture?.(event.pointerId); startPreview(); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) on(hold, event, releasePreview);
  on(hold, 'keydown', event => { if (![' ', 'Enter'].includes(event.key)) return; event.preventDefault(); if (!event.repeat) startPreview(); });
  on(hold, 'keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); releasePreview(); } });
  on(window, 'blur', releasePreview);
  const assetResponse = async (file, { signal }) => {
    const source = stage.borrow(); let encoded = null, assetReader = null, finished = false;
    const release = () => { if (!finished) { finished = true;
      const receipt = createProcgenRetirementScope().retire([{ name: 'asset-reader', run: () => assetReader?.releaseLock() },
        { name: 'stage-consumer', run: () => source.release() }, { name: 'stored-asset', run: () => encoded?.release() }]);
      if (receipt.outcome !== 'complete') throw Object.assign(failure('Sound material source cleanup is incomplete.'), { retirement: receipt });
    } };
    try {
      let blob = source.assetBlob(file.sha256) || (encoded = await registry.loadAsset(file.sha256, file.bytes, { signal }))?.blob;
      if (!blob && getProceduralSoundMaterial(file)) { encoded = await audio.getSoundMaterialProvider().borrowEncoded(file, { signal }); blob = encoded.blob; }
      signal.throwIfAborted(); if (!blob) throw failure('Required material is unavailable locally: ' + file.path);
      assetReader = blob.stream().getReader();
      const body = new globalThis.ReadableStream({
        async pull(controller) { try { const item = await assetReader.read(); if (item.done) { controller.close(); release(); } else controller.enqueue(item.value); }
        catch (error) { controller.error(error); release(); } },
        async cancel(reason) { try { await assetReader.cancel(reason); } finally { release(); } }
      }, { highWaterMark: 0 });
      return new globalThis.Response(body, { headers: { 'Content-Length': String(file.bytes), 'Content-Type': file.mediaType } });
    } catch (error) { release(); throw error; }
  };
  const prepareExport = mode => run(async operation => {
    const lease = stage.borrow(); let result;
    try { result = await archiver.prepareExport({ prepared: lease.prepared, selection: [selection], mode, reviewRights,
      readAsset: assetResponse, signal: operation.controller.signal, isCurrent: () => current === operation && !disposed }); check(operation);
    artifact?.discard(); artifact = result.artifact; setStatus('Selected ' + mode + ' file prepared. Choose a delivery action.'); }
    catch (error) { result?.artifact.discard(); throw error; } finally { lease.release(); }
  });
  const referenceExport = button('Prepare reference export', () => prepareExport('reference-only'));
  const portableExport = button('Prepare selected material', () => prepareExport('portable'));
  const renderRate = node('select'); renderRate.setAttribute('aria-label', 'Rendered reference sample rate');
  for (const rate of [44100, 48000, 96000]) { const option = node('option', rate + ' Hz'); option.value = String(rate); renderRate.append(option); }
  renderRate.value = '48000'; controls.append(renderRate);
  const renderAudio = button('Render controls WAV', () => run(async operation => {
    const result = await renderReferences.prepare(stage, selection, { sampleRate: Number(renderRate.value), sampleGesture: gestureLabel.hidden ? null : gesture.value, signal: operation.controller.signal,
      isCurrent: () => current === operation && !disposed });
    try { check(operation); artifact?.discard(); artifact = result.artifact;
      setStatus('Control reference WAV prepared at ' + result.manifest.sampleRate + ' Hz. Source, engine and tails are embedded; this is not a physical-take or listening qualification.'); }
    catch (error) { result.artifact.discard(); throw error; }
  }));
  const download = button('Download prepared file', () => { try { const receipt = deliverArtifactToAnchor(artifact, { document, windowRef: window }); setStatus(receipt.state === 'delivery-requested' ? 'Download requested; completion is not acknowledged by this browser action.' : 'Download: ' + receipt.state); } catch (error) { setStatus(error.message); } });
  const save = button('Save prepared file…', () => {
    if (!artifact || current) return;
    const pending = requestExportFileHandle(artifact, { windowRef: window });
    void run(async operation => { const handle = await pending; check(operation); const receipt = await deliverArtifactToFileHandle(artifact, handle, { signal: operation.controller.signal }); setStatus('File delivery: ' + receipt.state + '.'); });
  });
  const list = node('div'), archivedToggle = node('input'); archivedToggle.type = 'checkbox';
  const archivedLabel = node('label'); archivedLabel.append(archivedToggle, document.createTextNode(' Include archived packs'));
  const browse = button('Browse installed packs', () => refresh(null)), more = button('More installed packs', () => refresh(pageCursor));
  on(archivedToggle, 'change', () => refresh(null));
  const refresh = after => run(async operation => {
    const page = await registry.listPacks({ after, includeArchived: archivedToggle.checked, signal: operation.controller.signal }); check(operation); pageCursor = page.next; list.replaceChildren();
    for (const entry of page.entries) {
      const row = node('p'), choose = node('button', entry.name + ' · ' + entry.version + (entry.archived ? ' · archived' : '')); choose.type = 'button';
      choose.addEventListener('click', () => run(async sourceOperation => { const lease = await registry.loadPack(entry.id, { engineDescriptors: (await getNativeInstrumentCatalog()).descriptors, signal: sourceOperation.controller.signal });
        if (!lease) throw failure('Installed sound manifest is missing.');
        try { const next = await stageDefinitions(lease.prepared, sourceOperation); publish(next, sourceOperation);
          await installation.acknowledgeInstalled(next, { signal: sourceOperation.controller.signal }); check(sourceOperation); installed = true; setStatus('Installed definitions staged. Re-audition before Apply.'); }
        finally { lease.release(); }
      }));
      const archive = node('button', entry.archived ? 'Restore' : 'Archive'); archive.type = 'button'; archive.addEventListener('click', () => run(async sourceOperation => {
        await registry.setArchived(entry.id, !entry.archived, { signal: sourceOperation.controller.signal }); check(sourceOperation);
        choose.disabled = !entry.archived; archive.disabled = true; choose.textContent = entry.name + ' · ' + entry.version + (entry.archived ? ' · restored' : ' · archived');
        setStatus(entry.archived ? 'Pack restored to browsing.' : 'Pack archived. Project material is retained and recoverable.');
      })); row.append(choose, archive); list.append(row);
    }
  });
  const close = button('Close', () => dialog.close());
  on(dialog, 'close', () => { current?.controller.abort(failure('Sound library closed.')); installation.stop(); monitor?.mountHome(); });
  on(select, 'change', () => { selection = select.value; rights.checked = false; render(); }); on(rights, 'change', () => render());
  dialog.append(title, status, importInput, summary, select, gestureLabel, modelInfo, reviewLabel, credits, controls, archivedLabel, list); document.body.append(dialog);
  function render() {
    if (disposed) return; const busy = !!current || !!factoryFaults.size; let plan = null;
    try { plan = selectedPlan(); } catch { /* Expired stages expose their unavailable state through controls. */ }
    const metadata = stage?.metadata(); summary.textContent = metadata ? metadata.retained ? metadata.name + ' · ' + metadata.patches.length + ' saved revisions · ' + metadata.assetHashes.length + ' included assets' :
      'Stage expired. Import or prepare the instrument again.' : 'No instrument staged.';
    if (plan?.unavailableEngines.length) summary.textContent += ' Required renderer: ' + plan.unavailableEngines.map(entry => entry.state).join(', ') + '.';
    if (plan?.missingReferences.length || plan?.missingAssetBytes.length) summary.textContent += ' Missing material: ' + (plan.missingReferences.length + plan.missingAssetBytes.length) + ' references.';
    const ready = !!plan, auditioned = ready && !!installation.getAudition(stage, selection);
    let renderable = false, localProceduralMaterial = false, sourceComparable = false, sampleMap = null, sampleMapSource = null; modelInfo.textContent = '';
    if (ready) { const lease = stage.borrow(); try { const patch = lease.prepared.patches.find(entry => entry.identity === selection);
      sourceComparable = patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-granular' && patch.definition.sampleRefs.length === 1;
      localProceduralMaterial = !!patch?.definition?.sampleRefs?.length && patch.definition.sampleRefs.every(ref => lease.prepared.pack.files.some(file => file.sha256 === ref.sha256 && getProceduralSoundMaterial(file)));
      renderable = patch?.state === 'definition-admitted' && (NATIVE_OFFLINE_SOURCE_IDS.includes(patch.definition.engineId) || OWNED_SOURCE_IDS.includes(patch.definition.engineId) && getOwnedSourceProfile(patch.definition.engineId).controlReferenceRender);
      if (patch?.state === 'definition-admitted' && ['native-sample', 'worklet-sample'].includes(patch.definition.engineId)) {
        const map = patch.definition.sampleMap, chosen = installation.getAudition(stage, selection)?.sourceSelections?.[0]?.selection;
        sampleMap = map; sampleMapSource = patch.definitionHash;
        modelInfo.textContent = 'Sample instrument: ' + map.articulations.map(entry => entry.name).join(', ') + ' · ' + map.zones.length +
          ' mapped regions. The authored pitch and velocity ranges apply; playback speed changes pitch and duration.' +
          (patch.definition.engineId === 'worklet-sample' ? ' Owned source pool: ' + patch.definition.voicePolicy.maxVoices + ' declared voices including release tails; source and workspace quotas apply. Forward, reverse and explicit source-frame position controls use the same prepared reader in live and offline playback. Position control auditions use an authored outbound/return program, not physical motion. Listening and real-time capacity qualification are pending.' : '') +
          (chosen ? ' Last control selection: ' + chosen.zoneId + ' · alternate ' + (chosen.alternateIndex + 1) + '/' + chosen.alternates + (chosen.neutralFallback ? ' · declared neutral fallback.' : '.') : '');
      }
      if (patch?.definition?.tags?.includes('circuit-workshop')) modelInfo.textContent += ' Fixed prepared drum pitches keep GM articulation separate from tuning. WEIGHT is source low-pass, SNAP is host attack and METAL is velocity brightness contrast. ROOM requires a separate shared send; small-room-print contains finite recorded taps. No commercial drum-machine emulation or listening qualification is claimed.';
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'native-fm') {
        const parameters = Object.fromEntries(Object.entries(NATIVE_FM_PARAMETERS).map(([id, parameter]) => [id, parameter.default])); Object.assign(parameters, patch.definition.parameters);
        modelInfo.textContent = 'Patch model: ' + (parameters.dualPair ? 'four' : 'two') + ' operator sources · carrier/modulator ' + parameters.carrierRatio + ':' + parameters.modulatorRatio +
          ' · index ' + parameters.indexStart + ' → ' + parameters.indexEnd + ' over ' + parameters.indexSeconds + ' s · bend ±' + parameters.maxBendCents +
          ' cents. Register limits are estimates; spectral/listening qualification is pending. Feedback and effect sends are unavailable.';
      }
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'native-modal') {
        const parameters = patch.definition.parameters;
        modelInfo.textContent = 'Patch model: ' + (parameters.modeCount ?? 4) + ' authored damped-sine modes · body T60 ' + (parameters.bodyT60Seconds ?? 0.5) +
          ' s · site gain blend ' + (parameters.strikePosition01 ?? 0) + '. This is an original musical impulse-response design. Material tags, geometric pickup and PCM/listening qualification remain separate.';
      }
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-pluck') {
        const parameters = patch.definition.parameters;
        modelInfo.textContent = 'Patch model: seeded fractional-delay string · pick ' + parameters.pluckPosition01 + ' · target string T60 ' + parameters.stringT60Seconds +
          ' s · body mix ' + parameters.bodyMix01 + '. Live profile: 50–2000 Hz onset, ±200 cent bends, 44.1/48/96 kHz. Pitch/decay/listening qualification is pending; exact restore is unavailable. Fixed control WAVs and causal revoice use this same kernel.';
      }
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-choir') {
        const parameters = patch.definition.parameters;
        modelInfo.textContent = 'Patch model: artificial three-band formants · vowel ' + parameters.vowel01 + ' · size ' + parameters.sizeRatio +
          ' · breath ' + parameters.breath01 + '. Actor-seeded breath and a phase-aligned harmonic bank share one owned gate. Live profile: eight voices, 50–2000 Hz onset, ±200 cent bends, 44.1/48/96 kHz. Spectral/listening qualification is pending; exact restore is unavailable. Fixed control WAVs and causal revoice use this same kernel.';
      }
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-spectrum' && patch.definition.parameters.sourceMode === 2) {
        const p = patch.definition.parameters;
        modelInfo.textContent = 'Circular spectrum: octave period 2 · lattice reference ' + (p.circularReferenceHz ?? 55) + ' Hz · spectral center ' + (p.circularCenterHz ?? 700) +
          ' Hz · Gaussian amplitude width ' + (p.circularWidthOctaves ?? 1.2) + ' octaves · one cycle per ' + (p.circularPixelsPerCycle ?? 512) +
          (p.circularControlMode === 2 ? ' qualified directed-route arc pixels, referenced to the first admitted endpoint. A matching route articulation is required; unknown route order or segment precision is declined.' : p.circularControlMode === 1 ? ' world pixels on the declared contact axis. Each onset uses an observed contact coordinate; no motion is inferred between contacts.' : ' canonical signed-axis world pixels. Rests preserve distance phase;') + ' Active oscillator phases survive wraps. Carrier oscillation continues only within the original held voice. Other periods are unavailable. Route mode uses completed endpoint projections, not a reconstructed path between writes. Listening, band-edge and real-time qualification are pending.';
      }
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-granular') {
        const parameters = patch.definition.parameters;
        modelInfo.textContent = 'Patch model: one pinned local WAV per cloud · ' + parameters.grainMilliseconds + ' ms Hann grains at ' + parameters.densityHz +
          '/s · source position hold ' + (parameters.freezePosition ? 'on' : 'off') + '. Eight clouds, 16 grain slots per cloud, 32 births per 128 audio frames. Shared source quotas apply. Linear resampling, stereo and dense scenes await qualification; exact restore is unavailable. Fixed control WAVs use the same pinned source; causal rendering requires its saved material reference.';
      }
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-spectrum' && patch.definition.parameters.sourceMode !== 2) {
        const parameters = patch.definition.parameters;
        modelInfo.textContent = 'Patch model: ' + (parameters.sourceMode ? parameters.partialCount + ' authored additive partials' : '16 phase-aligned spectral frames') +
          ' · FLOW ' + parameters.scan01 + ' · BODY ' + parameters.body01 + ' · EDGE ' + parameters.edge01 +
          '. Live profile: eight slots, 20–2000 Hz onset, ±200 cent bends, 44.1/48/96 kHz; shared source quotas also apply. Completed world height offsets FLOW over the declared 0–512 pixel domain. Dry source only: shared SPACE sends, resonance/drive, PWM and exact restore are unavailable. Fixed control WAVs and causal revoice use this same kernel. Spectral/alias/listening qualification is pending.';
      }
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-texture') modelInfo.textContent = 'Procedural material texture: actual signed-axis travel visits actor-seeded spatial cells. No sample loop, audio-time birth clock or additional semantic attacks. Motion ends new births; admitted finite bursts and positive body/filter state decay. Eight source slots, 32 children per source and 32 admitted births per absolute 128-frame bucket. GRAIN/DRAG/SHADE/BODY affect new voices only. Control audition moves eight authored pixels in 40 ms, then rests; it is not a physical take. Exact kernel-state cuts are implemented; arbitrary live restoration and PCM equivalence remain unqualified. Alias, pulse statistics, device cost and listening remain unqualified.';
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-wind') modelInfo.textContent = 'Original experimental modal wind: a held gesture and pressure drive a private nonlinear port. At zero pressure no source work enters; the body can relax. AIR, BITE, LENGTH and LEAK affect later bodies; held channel pressure ramps the active source. LENGTH is acoustic-model size and never route length. Overblown Branch permits one hysteretic register change per gesture. Two slots share existing admission. Stability, pitch, register, aliasing, device cost and listening remain unqualified.';
      if (patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-friction') modelInfo.textContent = 'Bowed / friction body: actual signed travel supplies the gesture, while the body reacts through its own friction contact. At rest no new bow work enters and the body relaxes. DRAG, PRESS, EDGE and BODY affect later voices; pitch tunes each body at onset. Live pitch bending is unavailable. Two source slots share the existing sound quota. Control audition moves 78 authored pixels over 650 ms, then rests; it is not a physical take. Model stability, pitch, aliasing, device cost and listening remain unqualified.';
      const realization = lease.prepared.pack.compilation?.realizationGroups?.find(group => group.profiles.some(profile => profile.patchIdentity === selection)), profile = realization?.profiles.find(profile => profile.patchIdentity === selection);
      if (realization && profile) modelInfo.textContent += ' Authored realization ' + profile.id + ' · ' + realization.profiles.length + ' explicit profile(s). ' + (realization.singleProfileLimit || profile.changedAudibleProperties.join(' ')) + ' Preserved invariant claims: ' + profile.preservedInvariants.join(', ') + '. Device cost, listening and numerical equivalence are unqualified; automatic quality substitution is unavailable.';
    } finally { lease.release(); } }
    for (const element of [circuitFactory, circuitVariant, factory, fmFactory, materialFactory, pluckFactory, choirFactory, spectrumFactory, biomeFactory, tactileFactory, textureFactory, frictionFactory, windFactory, importInput, select, rights, browse, more, archivedToggle]) element.disabled = busy;
    if (gestureSource !== sampleMapSource) {
      gestureSource = sampleMapSource; gesture.replaceChildren();
      for (const entry of sampleMap?.articulations || []) { const option = node('option', entry.name); option.value = entry.id; gesture.append(option); }
      gesture.value = sampleMap?.neutralArticulationId || '';
    }
    gestureLabel.hidden = !sampleMap; gesture.disabled = busy || !sampleMap;
    audition.disabled = busy || !ready || !!plan?.missingReferences.length || !!plan?.unavailableEngines.length || !!plan?.missingAssetBytes.length && !installed && !localProceduralMaterial;
    originalSource.disabled = sourceRegion.disabled = audition.disabled || !sourceComparable;
    stop.disabled = !current; install.disabled = busy || !auditioned; referenceInstall.disabled = busy || !ready;
    hold.disabled = busy && current?.mode !== 'lane-preview' || !installed || !auditioned;
    apply.disabled = busy && !current?.previewLease || !installed || !auditioned; referenceExport.disabled = busy || !ready;
    portableExport.disabled = busy || !ready || plan.portability === 'reference-only' || !!plan.unavailableEngines.length;
    renderAudio.disabled = busy || !renderable || !!plan?.missingReferences.length || !!plan?.missingAssetBytes.length && !localProceduralMaterial && !installed; renderRate.disabled = busy || !renderable;
    download.disabled = busy || !artifact?.metadata().retained; save.disabled = download.disabled || typeof window.showSaveFilePicker !== 'function';
    more.hidden = !pageCursor; close.disabled = false; credits.replaceChildren();
    if (plan) for (const entry of plan.credits) credits.append(node('li', entry.subject + ' · ' + (entry.rights.creator || 'creator unknown') + ' · ' + entry.rights.licenseId + ' · redistribution ' + entry.redistribution));
  }
  render();
  return Object.freeze({ open() { if (!disposed && !dialog.open) { monitor?.mount(dialog); render(); dialog.showModal(); } },
    state: () => Object.freeze({ staged: stage?.metadata() || null, selection, busy: !!current, factoryRetirementUnknown: factoryFaults.size, installed, artifact: artifact?.metadata() || null }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; const pending = current?.promise; current?.controller.abort(failure('Sound library retired.'));
      return retirement.retire([{ name: 'audition', run: () => installation.dispose() }, { name: 'archive-owner', run: () => archiver.dispose() },
        { name: 'render-reference-owner', run: () => renderReferences.dispose() },
        ...[...factoryFaults].map(([id, fault]) => ({ name: 'factory-retirement-' + id, run: () => fault.receipt })),
        { name: 'reader-owner', run: () => reader.dispose() }, { name: 'stage', run: () => stage?.discard() }, { name: 'artifact', run: () => artifact?.discard() },
        { name: 'artifact-digest', run: () => artifact?.digest() },
        { name: 'current-source', run: async () => { await pending;
          if (factoryFaults.size || reader.diagnostics().unknownRetirement || archiver.diagnostics().unknownRetirement || registry.diagnostics().unknownRetirement) throw failure('Sound library source ownership is still unresolved.'); } },
        { name: 'registry', run: () => registry.close() }, ...listeners.map((remove, index) => ({ name: 'listener-' + index, run: remove })),
        { name: 'surface', run: () => { monitor?.mountHome(); dialog.remove(); } }]); }
  });
}
