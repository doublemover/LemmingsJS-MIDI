import { resolveSoundContentReference, validateSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { resolveLocalDrumArticulation } from './LocalDrumArticulation.js';
import { validateInstrumentControls } from '../../midi/content/InstrumentPerformance.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { resolveOwnedArticulationPolicy } from './OwnedArticulationPolicy.js';
import { createProcgenRetirementScope, afterProcgenRetirement } from '../procgen/ProcgenRetirement.js';

const fail = (code, message) => Object.assign(new Error(message), { name: 'SoundContentError', code });
const nativeEngines = new Set(['native-oscillator', 'native-fm', 'native-modal']);
const workletEngines = new Set(['worklet-sine', 'worklet-pluck', 'worklet-choir', 'worklet-spectrum', 'worklet-granular', 'worklet-sample', 'worklet-seed-layers', 'worklet-texture', 'worklet-friction', 'worklet-wind']);
let sequence = 0;

export function createPreparedInstrumentPreview({ session, getContext, getMaterialProvider, getCatalog = getNativeInstrumentCatalog, current = () => true, maxSeconds = 16, maxGroups = 8, onReceipt = () => {} } = {}) {
  if (!session?.createInstrumentBackend || !session?.enable || typeof getContext !== 'function' || typeof getMaterialProvider !== 'function' || typeof current !== 'function' || !Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 110 || !Number.isSafeInteger(maxGroups) || maxGroups < 1 || maxGroups > 8) throw new TypeError('Invalid prepared instrument preview owner.');
  const resources = [], controller = new AbortController(), retirement = createProcgenRetirementScope();
  const generation = ++sequence; let finishPreparation = null, preparation = Promise.resolve(); let phase = 'idle', timer = null, accepted = 0, rejected = 0, errorCode = null, lastRefusal = null, completed = false;
  const check = () => { controller.signal.throwIfAborted(); if (!current()) throw fail('stale-preview', 'The selected sound or output changed during preparation.'); };
  const report = fields => { const receipt = Object.freeze({ schema: 'prepared-instrument-preview/v1', generation, phase, accepted, rejected, errorCode, acousticReceipt: false, ...fields }); try { onReceipt(receipt); } catch {} return receipt; };
  const retire = () => {
    if (retirement.getReceipt()) return retirement.getReceipt(); controller.abort(); if (timer != null) { clearTimeout(timer); timer = null; }
    phase = 'retiring';
    const receipt = retirement.retire(resources.map((entry, index) => ({ name: 'instrument-' + index, run: async () => {
      await preparation; const native = createProcgenRetirementScope().retire([{ name: 'execution', run: () => entry.execution ? entry.backend.retireExecution(entry.execution).retirement : null }, { name: 'renderer', run: () => entry.backend?.dispose() }]);
      const owned = createProcgenRetirementScope().retire([{ name: 'native', run: () => native }, { name: 'material', run: () => afterProcgenRetirement([native], () => entry.material?.release()) }]);
      await owned.completion; return owned;
    } })));
    receipt.completion.then(value => { phase = value.outcome === 'complete' ? 'retired' : 'retirement-unknown'; report({ retirement: value.outcome }); }); return receipt;
  };
  const play = async notes => {
    if (phase !== 'idle' || !Array.isArray(notes) || !notes.length || notes.length > 64) throw fail('invalid-preview', 'Choose one bounded phrase of at most 64 notes.');
    const groups = new Map(), preparedNotes = [];
    for (const note of notes) {
      const reference = validateSoundContentReference(note?.instrumentRef), pitch = note?.pitch?.cents ?? note?.note * 100, velocity01 = note?.velocity01 ?? (note?.velocity ?? 80) / 127, offsetMs = note?.offsetMs ?? 0, durationMs = note?.durationMs ?? 220;
      if (!reference || !Number.isFinite(pitch) || pitch < -24000 || pitch > 24000 || !Number.isFinite(velocity01) || velocity01 < 0 || velocity01 > 1 || !Number.isFinite(offsetMs) || offsetMs < 0 || !Number.isFinite(durationMs) || durationMs <= 0 || offsetMs + durationMs > maxSeconds * 1000 || note?.pan != null && (!Number.isFinite(note.pan) || note.pan < -127 || note.pan > 127)) throw fail('invalid-preview-note', 'Preview needs a pinned instrument and finite pitch, dynamics, pan and bounded timing.');
      const key = reference.packHash + ':' + reference.definitionHash;
      if (!groups.has(key)) { if (groups.size === maxGroups) throw fail('preview-instrument-capacity', 'Shorten the phrase or use at most eight distinct prepared instruments.'); groups.set(key, { reference, backend: null, material: null, execution: null, instances: new Map() }); }
      const group = groups.get(key), instanceKey = JSON.stringify([note.trackId || null, note.laneIndex ?? 0]);
      if (!group.instances.has(instanceKey)) group.instances.set(instanceKey, 'p' + generation.toString(36) + 'i' + group.instances.size.toString(36));
      const drum = resolveLocalDrumArticulation(reference, { note: note.note, velocity01, instanceId: group.instances.get(instanceKey) });
      preparedNotes.push({ note, drum, pitch: drum?.pitchCents ?? pitch, velocity01, offsetMs, durationMs, controls: validateInstrumentControls(note.instrumentControls || { macros: {} }), group: groups.get(key) });
    }
    resources.push(...groups.values()); preparation = new Promise(resolve => { finishPreparation = resolve; });
    phase = 'preparing'; report();
    try {
      // Unlock remains in the initiating gesture, before catalog/material awaits.
      const enabled = session.enable(); const catalogWork = Promise.resolve().then(getCatalog); catalogWork.catch(() => {});
      if (!await enabled) throw fail('audio-not-ready', session.getState?.().message || 'Enable the selected audio output.'); check();
      const catalog = await catalogWork; check();
      for (const entry of groups.values()) {
        const reference = entry.reference;
        if (reference.assetHashes.length) { entry.material = await getMaterialProvider().acquire({ reference, engineDescriptors: catalog.descriptors, owner: 'prepared-preview:' + generation, generation, signal: controller.signal, isCurrent: current }); check(); }
        const resolution = await resolveSoundContentReference(reference, { engineDescriptors: catalog.descriptors, availableHashes: entry.material?.availableHashes || [], signal: controller.signal }); check();
        if (resolution.status !== 'ready') throw fail(resolution.status, 'The selected local instrument is unavailable: ' + resolution.status + '.');
        if (nativeEngines.has(resolution.patch.engineId)) entry.backend = session.createInstrumentBackend({ engineId: resolution.patch.engineId, gateMode: 'owned' });
        else if (resolution.patch.engineId === 'native-sample' && session.createSampleInstrumentBackend) entry.backend = await session.createSampleInstrumentBackend({ gateMode: 'owned' });
        else if (workletEngines.has(resolution.patch.engineId) && session.createWorkletInstrumentBackend) entry.backend = await session.createWorkletInstrumentBackend({ engineId: resolution.patch.engineId });
        else throw fail('instrument-adapter-unavailable', 'This output cannot realize the selected instrument engine.'); check();
        const prepared = await entry.backend.prepare(resolution, entry.material?.assets || []); check();
        if (prepared?.status !== 'ready') throw fail(prepared?.reason || 'patch-unprepared', 'The selected local instrument did not become ready.');
        entry.resolution = resolution; entry.articulation = resolveOwnedArticulationPolicy(resolution.patch);
        if (entry.material) { const released = entry.material.release(); await released.completion; if (released.outcome !== 'complete') throw Object.assign(fail('material-retirement-unknown', 'Prepared source readers remain unresolved.'), { retirement: released }); entry.material = null; check(); }
      }
      const context = getContext(); if (!context || context.state !== 'running' || !Number.isFinite(context.sampleRate) || context.sampleRate <= 0) throw fail('audio-not-ready', 'The selected audio context changed before preview.');
      const origin = Math.ceil((context.currentTime + 0.05) * context.sampleRate);
      for (const entry of groups.values()) {
        const registered = entry.backend.registerExecution({ executionEpoch: 'prepared-preview:' + generation, generation });
        if (registered.status !== 'accepted') throw fail(registered.reason, 'The local preview execution could not be admitted.'); entry.execution = registered.execution;
        const lastEnd = Math.max(...preparedNotes.filter(value => value.group === entry).map(value => (value.offsetMs + value.durationMs) / 1000 + (value.note.oneShot === true || value.note.percussion === true || value.drum ? entry.articulation.oneShotTailSeconds : 0)));
        const end = origin + Math.ceil((lastEnd + entry.articulation.releaseSeconds + 0.05) * context.sampleRate);
        const renewed = entry.backend.renewExecutionLease(generation, entry.execution, end); if (renewed.status !== 'accepted') throw fail(renewed.reason, 'The local preview gate lease could not be admitted.');
      }
      check(); phase = 'playing'; let endSeconds = context.currentTime;
      for (let index = 0; index < preparedNotes.length; index++) {
        const { note, drum, pitch, velocity01, offsetMs, durationMs, controls, group } = preparedNotes[index], targetFrame = origin + Math.round(offsetMs * context.sampleRate / 1000), voiceId = 'preview:' + generation + ':' + index;
        const pitchOffsetCents = note.expression?.pitchOffsetCents ?? (note.pitchBend ?? 0) * (note.pitchBendRange ?? 2) * 100;
        const intent = { version: 1, kind: 'begin', generation, voiceId, onsetId: voiceId, intentId: voiceId + ':begin', sourceEventIds: note.sourceEventIds || [], pitch: { cents: pitch, referenceHz: note.pitch?.referenceHz ?? 440 }, velocity01, performanceControls: controls,
          ...(drum ? { sampleGesture: drum.sampleGesture, sampleKitId: drum.sampleKitId } : {}), expression: { ...(note.expression || {}), pitchOffsetCents, ...(note.pan != null ? { pan01: note.pan / 127 } : {}) }, ...(note.playback ? { playback: note.playback } : {}) };
        const begun = group.backend.begin(intent, targetFrame, group.execution);
        if (begun.status !== 'accepted') { rejected++; lastRefusal = begun.reason || 'unsupported-note-interface'; report({ voiceId, stage: 'rejected', reason: begun.reason, patchReceipt: group.resolution.receipt }); continue; }
        accepted++; const endFrame = targetFrame + Math.max(1, Math.round(durationMs * context.sampleRate / 1000)), release = group.articulation.releaseSeconds;
        const oneShot = note.oneShot === true || note.percussion === true || !!drum;
        const ended = group.backend.end(voiceId, { seconds: release, ...(oneShot && group.articulation.oneShotTailSeconds ? { mode: 'one-shot', tailSeconds: group.articulation.oneShotTailSeconds } : {}) }, endFrame, group.execution);
        if (ended.status !== 'accepted') throw fail(ended.reason, 'A prepared voice release could not be scheduled.');
        endSeconds = Math.max(endSeconds, endFrame / context.sampleRate + release + (oneShot ? group.articulation.oneShotTailSeconds : 0)); report({ voiceId, stage: 'scheduled', targetFrame, endFrame, patchReceipt: group.resolution.receipt, ...(drum ? { percussion: drum } : {}), effectiveParameters: begun.performance || null });
      }
      completed = true; finishPreparation(); finishPreparation = null; if (!accepted) throw fail(lastRefusal || 'phrase-not-realized', 'The selected instrument cannot realize this note-only phrase: ' + (lastRefusal || 'no admitted voices') + '. Choose a compatible instrument or a recorded physical take.');
      timer = setTimeout(retire, Math.max(1, Math.ceil((endSeconds - context.currentTime) * 1000) + 50)); report({ stage: rejected ? 'partially-scheduled' : 'scheduled' }); return true;
    } catch (error) { finishPreparation?.(); finishPreparation = null; errorCode = String(error?.code || error?.name || 'preview-failed').slice(0, 128); phase = 'failed'; report({ message: String(error?.message || error).slice(0, 512) }); const closed = retire(); await closed.completion; throw error; }
  };
  return Object.freeze({ play, dispose: retire, state: () => Object.freeze({ phase, accepted, rejected, errorCode, completed, retirement: retirement.getReceipt()?.outcome || null }) });
}
