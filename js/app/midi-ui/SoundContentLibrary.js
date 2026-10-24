import { prepareSoundContentPack, planSoundContentSelection } from '../../midi/content/SoundContentPack.js';
import { createSoundContentArchiver } from './SoundContentArchive.js';
import { createSoundContentReader } from './SoundContentReader.js';
import { createSoundContentRegistry } from './SoundContentRegistry.js';
import { createSoundContentInstallation } from './SoundContentInstallation.js';
import { createSoundContentRenderReferences } from './SoundContentRenderReference.js';
import { getNativeInstrumentCatalog, NATIVE_FM_PARAMETERS } from './NativeInstrumentSchema.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { readBrowserBuildResponse } from '../../runtime/BrowserGenerationService.js';
import { deliverArtifactToAnchor, requestExportFileHandle, deliverArtifactToFileHandle } from '../export/ExportArtifact.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const FACTORY_SOURCE = new URL('../../../content/sounds/native.json', import.meta.url);
const FM_FORGE_SOURCE = new URL('../../../content/sounds/fm-forge.json', import.meta.url);
const MATERIAL_SOURCE = new URL('../../../content/sounds/struck-materials.json', import.meta.url);
const failure = message => Object.assign(new Error(message), { name: 'SoundContentError' });

export function createSoundContentLibrary({ document, window, audio, resourceBudget, jobs = backgroundJobService, onApply, onStatus = () => {}, monitor = null } = {}) {
  if (!document?.createElement || !resourceBudget || typeof onApply !== 'function') throw new TypeError('Invalid sound library surface.');
  const reader = createSoundContentReader({ resourceBudget, jobs }), archiver = createSoundContentArchiver({ resourceBudget, jobs });
  const registry = createSoundContentRegistry({ indexedDB: window.indexedDB, keyRange: window.IDBKeyRange, resourceBudget });
  const installation = createSoundContentInstallation({ audio, registry, onReveal: () => { if (!disposed && !dialog.open) { monitor?.mount(dialog); dialog.showModal(); } } });
  const renderReferences = createSoundContentRenderReferences({ resourceBudget, jobs });
  const retirement = createProcgenRetirementScope(), listeners = [], factoryFaults = new Map();
  let stage = null, current = null, disposed = false, selection = null, artifact = null, pageCursor = null, installed = false, sequence = 0;
  const node = (tag, text) => { const element = document.createElement(tag); if (text != null) element.textContent = text; return element; };
  const on = (element, event, callback) => { element.addEventListener(event, callback); listeners.push(() => element.removeEventListener(event, callback)); };
  const dialog = node('dialog'); dialog.className = 'studio-sound-library'; dialog.setAttribute('aria-labelledby', 'soundLibraryTitle');
  const title = node('h2', 'Sound library'); title.id = 'soundLibraryTitle';
  const status = node('p', 'Import an instrument or prepare the original oscillator recipes.'); status.setAttribute('role', 'status'); status.setAttribute('aria-label', 'Sound library status');
  const summary = node('p'), modelInfo = node('p'), select = node('select'); select.setAttribute('aria-label', 'Saved instrument revision');
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
    operation.promise = Promise.resolve().then(() => work(operation)).catch(error => { setStatus(error?.message || 'Sound library operation failed.'); return null; })
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
    const result = await archiver.prepareExport({ prepared, selection: prepared.patches.map(patch => patch.identity), mode: 'reference-only',
      signal: operation.controller.signal, isCurrent: () => current === operation && !disposed });
    const lease = result.artifact.borrow(); let next = null;
    try { next = await reader.stageArchive(lease.blob, { engineDescriptors: (await getNativeInstrumentCatalog()).descriptors,
      signal: operation.controller.signal, isCurrent: () => !disposed }); return next; }
    catch (error) { next?.discard(); throw error; }
    finally {
      const receipt = createProcgenRetirementScope().retire([{ name: 'factory-export-reader', run: () => lease.release() },
        { name: 'factory-export-artifact', run: () => result.artifact.discard() }, { name: 'factory-export-digest', run: () => result.artifact.digest() }]);
      await receipt.completion;
      if (receipt.outcome !== 'complete') { next?.discard(); throw Object.assign(failure('Factory archive source retirement is unresolved.'), { retirement: receipt }); }
    }
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
  const factory = button('Prepare factory instruments', () => prepareFactory(FACTORY_SOURCE, 'Factory'));
  const fmFactory = button('Prepare FM Forge', () => prepareFactory(FM_FORGE_SOURCE, 'FM Forge'));
  const materialFactory = button('Prepare struck materials', () => prepareFactory(MATERIAL_SOURCE, 'Struck materials'));
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
    operation.promise = installation.audition(stage, selection, { signal: operation.controller.signal }).then(() =>
      setStatus('Control audition completed. Physical-take and listening qualification remain separate.')).catch(error => setStatus(error.message))
      .finally(() => { if (current === operation) current = null; render(); });
  });
  const stop = button('Stop / cancel', () => { current?.controller.abort(failure('Sound operation canceled.')); installation.stop(); });
  const install = button('Install auditioned pack', () => run(async operation => { await installation.install(stage, { signal: operation.controller.signal, isCurrent: () => current === operation && !disposed });
    check(operation); installed = true; setStatus('Pack installed. Apply remains a separate command.'); }));
  const referenceInstall = button('Keep as reference', () => run(async operation => { await installation.install(stage, { referenceOnly: true, signal: operation.controller.signal, isCurrent: () => current === operation && !disposed });
    check(operation); installed = true; setStatus('Reference pack installed. Missing engines and material remain explicit requirements.'); }));
  const apply = button('Apply to selected lane', () => run(async operation => { const candidate = installation.applyCandidate(stage, selection); check(operation);
    await onApply(candidate, { signal: operation.controller.signal }); check(operation); setStatus('Instrument applied to the selected lane.'); }));
  const assetResponse = async (file, { signal }) => {
    const source = stage.borrow(); let encoded = null, assetReader = null, finished = false;
    const release = () => { if (!finished) { finished = true;
      const receipt = createProcgenRetirementScope().retire([{ name: 'asset-reader', run: () => assetReader?.releaseLock() },
        { name: 'stage-consumer', run: () => source.release() }, { name: 'stored-asset', run: () => encoded?.release() }]);
      if (receipt.outcome !== 'complete') throw Object.assign(failure('Sound material source cleanup is incomplete.'), { retirement: receipt });
    } };
    try {
      const blob = source.assetBlob(file.sha256) || (encoded = await registry.loadAsset(file.sha256, file.bytes, { signal }))?.blob;
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
    const result = await renderReferences.prepare(stage, selection, { sampleRate: Number(renderRate.value), signal: operation.controller.signal,
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
  dialog.append(title, status, importInput, summary, select, modelInfo, reviewLabel, credits, controls, archivedLabel, list); document.body.append(dialog);
  function render() {
    if (disposed) return; const busy = !!current || !!factoryFaults.size; let plan = null;
    try { plan = selectedPlan(); } catch { /* Expired stages expose their unavailable state through controls. */ }
    const metadata = stage?.metadata(); summary.textContent = metadata ? metadata.retained ? metadata.name + ' · ' + metadata.patches.length + ' saved revisions · ' + metadata.assetHashes.length + ' included assets' :
      'Stage expired. Import or prepare the instrument again.' : 'No instrument staged.';
    if (plan?.unavailableEngines.length) summary.textContent += ' Required renderer: ' + plan.unavailableEngines.map(entry => entry.state).join(', ') + '.';
    if (plan?.missingReferences.length || plan?.missingAssetBytes.length) summary.textContent += ' Missing material: ' + (plan.missingReferences.length + plan.missingAssetBytes.length) + ' references.';
    const ready = !!plan, auditioned = ready && !!installation.getAudition(stage, selection);
    let renderable = false; modelInfo.textContent = '';
    if (ready) { const lease = stage.borrow(); try { const patch = lease.prepared.patches.find(entry => entry.identity === selection);
      renderable = patch?.state === 'definition-admitted' && patch.definition.engineId === 'worklet-sine';
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
      } } finally { lease.release(); } }
    for (const element of [factory, fmFactory, materialFactory, importInput, select, rights, browse, more, archivedToggle]) element.disabled = busy;
    audition.disabled = busy || !ready || !!plan?.missingReferences.length || !!plan?.unavailableEngines.length || !!plan?.missingAssetBytes.length;
    stop.disabled = !current; install.disabled = busy || !auditioned; referenceInstall.disabled = busy || !ready;
    apply.disabled = busy || !installed || !auditioned; referenceExport.disabled = busy || !ready;
    portableExport.disabled = busy || !ready || plan.portability === 'reference-only' || !!plan.unavailableEngines.length;
    renderAudio.disabled = busy || !renderable || !!plan?.missingReferences.length || !!plan?.missingAssetBytes.length; renderRate.disabled = busy || !renderable;
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
