import { decodeQualificationFloatWav } from './SoundQualificationWav.js';
export { decodeQualificationFloatWav } from './SoundQualificationWav.js';
import { prepareCausalNativeRenderInput } from '../../app/midi-ui/CausalNativeRender.js';
import { renderCausalOwnedTake, planCausalSourceRender } from '../../app/midi-ui/CausalOwnedRender.js';
import { NATIVE_OFFLINE_SOURCE_IDS } from '../../app/midi-ui/NativeOfflineProfile.js';
import { encodeNativeOfflineRender } from '../../app/resources/NativeOfflineEncoding.js';
import { createAudioResourceLeases } from '../../app/midi-ui/AudioResourceLeases.js';
import { hashData } from '../../core/CanonicalData.js';

let ownerSerial = 0;
export function createSharedSoundQualificationRenderer({ resourceBudget = null, OfflineAudioContext = globalThis.OfflineAudioContext, getAssets = async () => ({}), jobs = null } = {}) {
  const resources = createAudioResourceLeases({ resourceBudget, ownerPrefix: 'sound-qualification-' + (++ownerSerial), maxReservations: 128 });
  let active = false, disposed = false, blocked = null;
  return Object.freeze({
    async render(plan, selected, { signal } = {}) {
      if (active || disposed || blocked) throw new Error('The qualification renderer is busy, retired or has unresolved resources.');
      active = true;
      let workspace = null, native = null, rendered = null, assets = null, result = null;
      const startedMs = performance.now(); let planningFinishedMs = null, renderingFinishedMs = null;
      const check = () => { signal?.throwIfAborted(); if (disposed) throw new Error('The qualification renderer is retired.'); };
      try {
        check();
        const fixture = plan.fixtures.find(value => value.id === selected.fixtureId);
        if (!fixture || await hashData(fixture.revoice) !== selected.fixtureHash || plan.definitionHash !== await hashData(plan.definition)) throw new Error('Qualification source changed.');
        check();
        const maximumWorkingBytes = Math.ceil(fixture.durationSeconds * selected.sampleRate) * 8 * 8 + 32 * 1048576;
        if (maximumWorkingBytes > 512 * 1048576) throw new Error('Qualification fixture exceeds the shared render workspace.');
        workspace = resources.reserve({ kind: 'qualification-plan-encoding-analysis', owner: selected.id, bytes: maximumWorkingBytes, consumerOwned: true });
        signal?.throwIfAborted(); assets = selected.variant === 'omit-assets' ? {} : await getAssets(plan.source, plan.definition, { signal }); check();
        const input = { revoice: fixture.revoice, definition: plan.definition, descriptor: plan.descriptor, applicationBuildId: plan.applicationBuildId,
          ...(selected.role === 'panic' ? { panicFrame: Math.ceil(0.3 * selected.sampleRate / 128) * 128 } : {}), targetControls: selected.controls, sampleRate: selected.sampleRate, startSeconds: 0, endSeconds: fixture.durationSeconds, tail: { mode: 'exact-crop' },
          ...(fixture.effectGraph ? { effectGraph: fixture.effectGraph } : {}), ...(assets.pcm ? { pcm: assets.pcm } : {}), ...(assets.nativeAssets ? { nativeAssets: assets.nativeAssets } : {}) };
        const planned = await planCausalSourceRender(input), effective = [...planned.voices.values()].slice(0, 64).map(voice => ({ voiceId: voice.begin.voiceId, intentId: voice.begin.intentId,
          controls: voice.begin.performanceControls, values: voice.parameters, applyFrame: voice.start, evidence: 'admitted-render-inputs-not-independent-dsp-readback' }));
        check(); planningFinishedMs = performance.now();
        if (NATIVE_OFFLINE_SOURCE_IDS.includes(plan.descriptor.engineId)) {
          native = await prepareCausalNativeRenderInput(input, { resources, resourceBudget, signal, OfflineAudioContext, jobs, maxWorkingBytes: 512 * 1048576 });
          check(); rendered = await encodeNativeOfflineRender(native.input, { signal, maxWorkingBytes: 512 * 1048576 });
        } else rendered = await renderCausalOwnedTake(input, { signal, maxWorkingBytes: maximumWorkingBytes });
        check(); renderingFinishedMs = performance.now();
        const file = rendered.files?.find(file => file.name === 'master'); if (!file) throw new Error('Shared renderer omitted its master PCM.');
        const decoded = decodeQualificationFloatWav(file.bytes);
        result = { ...decoded, bytes: file.bytes, manifest: file.manifest, semanticReceipt: { fixtureHash: fixture.fixtureHash, physicalTakeEvidence: fixture.physicalTakeEvidence,
          begins: planned.capturedBegins, updates: planned.capturedUpdates, ends: planned.capturedEnds, sourceCanonicalHash: fixture.revoice.sourceCanonicalHash },
        admissionReceipt: { resourceMeasurement: { totalWallMs: renderingFinishedMs - startedMs, sourcePlanningAndAssetWallMs: planningFinishedMs - startedMs, backendRenderAndEncodeWallMs: renderingFinishedMs - planningFinishedMs, reservedWorkspaceBytes: maximumWorkingBytes, realtimeBlockP99Ms: null, realtimeQueueP99Ms: null, firstUsableNoteMs: null, observedMemoryBytes: null, scope: 'offline-render-and-encoding-wall-clock;not-live-audio-thread-or-device-latency' }, physicalSourceCoverage: rendered.manifest.realization?.sourceControls || null, realization: rendered.manifest.realization || null, panic: rendered.manifest.panic || rendered.manifest.nativeScheduling?.panic || null, commands: rendered.manifest.commands, nativeScheduling: rendered.manifest.nativeScheduling || null, effectiveTargets: effective,
          effectiveTargetCoverage: { total: planned.voices.size, retained: effective.length }, logicalVoices: planned.capturedBegins, dspSubeventsAreNotOnsets: true } };
        native?.release(); native = null; await assets.release?.(); assets = null; check();
        const lease = {}; for (const key of Object.keys(result)) Object.defineProperty(lease, key, { enumerable: true, get: () => result?.[key] ?? null });
        let released = false; lease.release = () => { if (released) return false; try { workspace.release(); } catch (error) { blocked = { error, result, rendered }; throw error; } released = true; active = false; result = rendered = null; return true; }; return Object.freeze(lease);
      } catch (error) {
        let retirementError = error.retirement && error.retirement.outcome !== 'complete' ? error : null;
        try { native?.release(); } catch (caught) { retirementError ||= caught; }
        try { await assets?.release?.(); } catch (caught) { retirementError ||= caught; }
        if (retirementError) { blocked = { error: retirementError, native, assets, rendered, result }; workspace?.retainUnknown(retirementError); }
        else { workspace?.release(); active = false; }
        throw error;
      }
    },
    diagnostics: () => ({ active, disposed, blocked: blocked?.error?.message || null, resources: resources.diagnostics() }),
    dispose() { disposed = true; if (active || blocked) throw new Error('Retire the active/unknown qualification render before disposing its owner.'); return resources.dispose(); }
  });
}
