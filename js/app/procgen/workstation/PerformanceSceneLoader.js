import { inspectSceneStationRehearsal } from './SceneStationPolicy.js';
import { canonicalDataText, freezeData } from '../../../core/CanonicalData.js';
import { validatePerformanceScene } from './PerformanceScene.js';
import { checkPerformanceSceneRequirements } from './PerformanceSceneRequirements.js';

const failure = (code, message) => Object.assign(new Error(message), { name: 'PerformanceSceneError', code });
const phases = new Set(['world-source', 'world-assets', 'world-geometry', 'sound-assets', 'sound-compile', 'resource-admission', 'ready']);
const same = (a, b) => canonicalDataText(a).text === canonicalDataText(b).text;

// Candidate commit is synchronous and calls the supplied fence at its atomic
// publication point. Retirement releases candidate ownership, including after
// handoff, and must never retire the adopted active world.
export function createPerformanceSceneLoader({ getBaseIdentity, resolveDependency, prepareCandidate, preparePreview = null, beforeCommit = async () => true, onState = () => {} } = {}) {
  if (typeof getBaseIdentity !== 'function' || typeof resolveDependency !== 'function' || typeof prepareCandidate !== 'function' || preparePreview !== null && typeof preparePreview !== 'function' || typeof beforeCommit !== 'function' || typeof onState !== 'function') throw new TypeError('Scene loading requires the existing document, dependency and candidate transaction owners.');
  const unresolved = new Set();
  let serial = 0, selected = null, pending = null, prepared = null, preview = null, retirement = Promise.resolve(), fault = null, disposed = false, phase = 'idle', lastError = null, current = null;
  const state = () => { let canApply = false; try { canApply = !!prepared && !pending && !disposed && !fault && selected?.serial === prepared.operation.serial && getBaseIdentity() === prepared.baseIdentity; } catch {} return freezeData({ schema: 'lemmings-performance-scene-loader/v1', phase, disposed, selection: selected ? { id: selected.scene.id, version: selected.scene.version, title: selected.scene.title, variants: selected.variants } : null,
    current, canApply, previewAvailable: preparePreview !== null, pending: !!pending, prepared: prepared ? { preflight: prepared.preflight, baseIdentity: prepared.baseIdentity, policy: 'stopped-replacement', changedScope: ['world', 'sound', 'physical-mappings', 'transport-paused'] } : null,
    preview: preview ? { state: preview.ready ? 'isolated-local' : 'preparing', sceneHash: preview.sceneHash, playing: preview.ready ? preview.owner?.state?.().playing ?? true : false,
      authoredStations: preview.authoredStations, stations: preview.owner?.manifest?.privateStations || null, sourceHash: preview.owner?.manifest?.sourceHash || null, ticks: preview.owner?.manifest?.ticks || null, cueIncludedInMasterCapture: preview.owner?.monitorRoute?.cueIncludedInMasterCapture ?? null } : null, error: lastError, retirementUnknown: !!fault }); };
  const report = () => { try { onState(state()); } catch { /* Observers cannot own a candidate. */ } };
  const baseIdentity = () => { const value = getBaseIdentity(); if (typeof value !== 'string' || !value || value.length > 4096) throw failure('scene-base-unavailable', 'The active document and routing identity is unavailable.'); return value; };
  const check = operation => { operation.controller.signal.throwIfAborted(); if (disposed || fault || selected?.serial !== operation.serial || baseIdentity() !== operation.baseIdentity) throw failure('stale-scene-operation', 'The selected scene, live document or output routing changed. Prepare again.'); };
  const retire = async owner => {
    if (!owner) return; let receipt;
    try { receipt = await owner.retire(); if (receipt?.completion) await receipt.completion; if (receipt?.outcome !== 'complete') throw failure('scene-retirement-unknown', 'Candidate resources have not confirmed retirement.'); unresolved.delete(owner); }
    catch (error) { unresolved.add(owner); fault ||= error; throw error; }
  };
  const retirePrepared = () => {
    const old = prepared; prepared = null; const oldPreview = preview; preview = null; oldPreview?.controller.abort(new Error('Scene preview canceled.'));
    retirement = retirement.catch(() => {}).then(async () => {
      await oldPreview?.promise?.catch(() => {}); const errors = [];
      for (const owner of [oldPreview?.owner, old?.candidate]) try { await retire(owner); } catch (error) { errors.push(error); }
      if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'Scene candidate retirement failed.');
    });
    retirement.catch(() => {}); return retirement;
  };
  const cancel = async () => {
    const canceledSerial = ++serial; selected = null; pending?.controller.abort(new Error('Scene selection canceled.')); phase = 'retiring'; report();
    const work = pending?.promise, retired = retirePrepared(); const results = await Promise.allSettled([retired, work]);
    if (results[0].status === 'rejected') throw results[0].reason; if (!disposed && serial === canceledSerial) phase = fault ? 'retirement-unknown' : 'idle'; report(); return state();
  };
  const select = (raw, { variants = [] } = {}) => {
    if (disposed || fault) throw failure('scene-loader-unavailable', 'The scene owner is retired or requires resource recovery.');
    const scene = validatePerformanceScene(raw);
    if (!Array.isArray(variants) || variants.length > 256 || variants.some(value => typeof value !== 'string') || new Set(variants).size !== variants.length) throw failure('scene-variant-unavailable', 'Choose a bounded explicit variant set.');
    pending?.controller.abort(new Error('Scene selection replaced.')); retirePrepared();
    selected = { serial: ++serial, scene, variants: Object.freeze([...variants].sort()) }; phase = 'selected'; lastError = null; report(); return state();
  };
  const prepare = () => {
    if (!selected || disposed || fault) return Promise.reject(failure('scene-selection-unavailable', 'Select an inspectable scene before preparation.'));
    if (pending?.serial === selected.serial) return pending.promise;
    const previous = pending?.promise, operation = { ...selected, controller: new AbortController(), baseIdentity: baseIdentity(), promise: null };
    pending?.controller.abort(new Error('Scene preparation replaced.')); retirePrepared(); pending = operation; phase = 'checking-requirements'; report();
    operation.promise = (async () => {
      let candidate = null;
      try {
        await previous?.catch(() => {}); await retirement; check(operation);
        const preflight = await checkPerformanceSceneRequirements(operation.scene, { resolveDependency, variants: operation.variants, signal: operation.controller.signal, isCurrent: () => !disposed && selected?.serial === operation.serial && baseIdentity() === operation.baseIdentity }); check(operation);
        if (preflight.status !== 'ready') { phase = 'unavailable'; lastError = { code: 'scene-requirements-unavailable', message: preflight.blocked.map(entry => entry.dependency.description + ': ' + entry.reason).join('; ').slice(0, 4096) }; report(); return freezeData({ status: 'unavailable', preflight }); }
        phase = 'preparing'; report();
        candidate = await prepareCandidate({ scene: operation.scene, preflight, baseIdentity: operation.baseIdentity, signal: operation.controller.signal,
          isCurrent: () => { try { check(operation); return true; } catch { return false; } },
          onPhase(value) { if (phases.has(value) && selected?.serial === operation.serial && !operation.controller.signal.aborted && !disposed) { phase = value; report(); } } }); check(operation);
        if (!candidate || typeof candidate.commit !== 'function' || typeof candidate.retire !== 'function' || candidate.sceneHash !== preflight.sceneHash || candidate.baseIdentity !== operation.baseIdentity || !same(candidate.variants, preflight.variants) || candidate.admission?.status !== 'admitted' || candidate.admission?.world !== true || candidate.admission?.sound !== true || candidate.admission?.mapping !== true) throw failure('scene-candidate-unbound', 'The candidate must prove complete world, sound and mapping admission for this exact scene and base.');
        prepared = { candidate, operation, preflight, baseIdentity: operation.baseIdentity }; candidate = null; phase = 'ready'; lastError = null; report(); return freezeData({ status: 'ready', preflight, policy: 'stopped-replacement' });
      } catch (error) {
        if (selected?.serial === operation.serial && !disposed) { phase = 'failed'; lastError = { code: error.code || 'scene-preparation-failed', message: error.message }; report(); } throw error;
      } finally { try { await retire(candidate); } finally { if (pending === operation) pending = null; report(); } }
    })(); operation.promise.catch(() => {}); return operation.promise;
  };
  const stopPreview = async () => {
    const old = preview; preview = null; if (!old) return; old.controller.abort(new Error('Scene preview ended.')); await old.promise?.catch(() => {}); await retire(old.owner); report();
  };
  const rehearse = async ({ authoredStations = false } = {}) => {
    if (typeof authoredStations !== 'boolean') throw failure('scene-preview-policy-unavailable', 'Choose an explicit private station rehearsal policy.');
    if (!preparePreview) throw failure('scene-preview-unavailable', 'An isolated local scene audition owner is unavailable.');
    const source = prepared; if (!source || pending || preview) throw failure('scene-not-ready', 'Prepare the exact selected scene before rehearsal.'); check(source.operation);
    if (authoredStations && !inspectSceneStationRehearsal(source.operation.scene).available) throw failure('scene-preview-policy-unavailable', 'This score has no supported one-shot work stations.');
    const operation = { controller: new AbortController(), owner: null, promise: null, sceneHash: source.preflight.sceneHash, authoredStations, ready: false }; preview = operation; report();
    operation.promise = (async () => {
      let candidate;
      try { candidate = await preparePreview({ candidate: source.candidate, authoredStations, scene: source.operation.scene, preflight: source.preflight, signal: operation.controller.signal, isCurrent: () => preview === operation && prepared === source && !disposed && !operation.controller.signal.aborted && baseIdentity() === source.baseIdentity });
        check(source.operation); operation.controller.signal.throwIfAborted();
        if (preview !== operation || prepared !== source || candidate?.routing !== 'isolated-local' || candidate?.externalOutput !== false || typeof candidate?.retire !== 'function') throw failure('scene-preview-unbound', 'Preview requires an independent local owner and explicit external-output isolation.');
        operation.owner = candidate; candidate = null; operation.ready = true;
        operation.owner.completion?.then(receipt => { if (receipt?.outcome !== 'complete') { unresolved.add(operation.owner); fault ||= failure('scene-retirement-unknown', 'Rehearsal retirement remains unresolved.'); } if (preview === operation) report(); });
        report(); return state();
      } finally { await retire(candidate); }
    })(); operation.promise.catch(() => {});
    try { return await operation.promise; } catch (error) { if (preview === operation) preview = null; report(); throw error; }
  };
  const apply = async () => {
    const source = prepared;
    if (!source || pending || disposed || fault) throw failure('scene-not-ready', 'Prepare the selected scene before applying it.');
    check(source.operation); if (!await beforeCommit({ scene: source.operation.scene, preflight: source.preflight, changedScope: ['world', 'sound', 'physical-mappings', 'transport-paused'], policy: 'stopped-replacement' })) return freezeData({ status: 'canceled', current });
    await stopPreview(); check(source.operation); if (prepared !== source) throw failure('stale-scene-operation', 'The prepared scene changed.');
    phase = 'committing'; report(); let fenced = false, adopted = false;
    try {
      const receipt = source.candidate.commit({ isCurrent: () => { check(source.operation); fenced = true; return true; }, policy: 'stopped-replacement' });
      if (receipt?.then || !fenced || receipt?.status !== 'committed' || receipt.sceneHash !== source.preflight.sceneHash || receipt.baseIdentity !== source.baseIdentity || receipt.transportPlaying !== false || receipt.externalOutputEnabledByScene !== false || receipt.recordingArmedByScene !== false || receipt.localAudioEnabledByScene !== false || receipt.policy !== 'stopped-replacement') throw failure('scene-commit-unproven', 'The scene owner did not return a fenced, paused, unarmed transition receipt.');
      current = freezeData({ id: source.operation.scene.id, version: source.operation.scene.version, hash: source.preflight.sceneHash, variants: source.preflight.variants, policy: receipt.policy }); prepared = null; adopted = true;
      await retire(source.candidate); phase = 'active'; lastError = null; report(); return freezeData({ status: 'committed', current, receipt });
    } catch (error) { fault ||= error; phase = adopted ? 'active-retirement-unknown' : 'commit-recovery-required'; lastError = { code: error.code || 'scene-commit-failed', message: error.message }; report(); throw error; }
  };
  return Object.freeze({ state, select, prepare, rehearse, stopPreview, apply, cancel,
    async dispose() { disposed = true; let error = null; try { await cancel(); } catch (caught) { error = caught; }
      for (const owner of [...unresolved]) try { await retire(owner); } catch (caught) { error = caught; }
      phase = unresolved.size ? 'retirement-unknown' : 'disposed'; report(); if (unresolved.size) throw error || fault; return state(); } });
}
