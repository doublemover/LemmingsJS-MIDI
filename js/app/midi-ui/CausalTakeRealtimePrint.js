import { prepareExportArtifact } from '../export/ExportArtifact.js';
import { canonicalDataText } from '../../core/CanonicalData.js';
import { createBrowserNotePreview } from './browserNotePreview.js';
import { createOwnedMasterCapture } from './OwnedMasterCapture.js';
import { createRoutedInstrumentBackend } from './RoutedInstrumentBackend.js';
import { createLaneInstrumentPreparation } from './LaneInstrumentPreparation.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { validateSoundContentReference, resolveSoundContentReference } from '../../midi/content/SoundContentReference.js';
import { querySoundOnlyRevoiceOwned } from '../procgen/workstation/CausalTake.js';
import { retireCausalRead } from '../procgen/workstation/CausalReadLeases.js';
import { createCausalIntentDispatcher, createStrictLiveFramePolicy } from '../procgen/workstation/CausalIntentDispatcher.js';
import { createCausalRenderTiming } from './CausalRenderTiming.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';
const fail = message => Object.assign(new Error(message), { name: 'CausalRenderError', code: 'real-time-take-print' });
const wait = () => new Promise(resolve => setTimeout(resolve, 15));
const silentDefault = Object.freeze({ status: 'ready', patch: { id: 'real-time-print-unassigned', revision: 1, engineId: 'native-oscillator', engineVersion: 1, parameters: { waveform: 1, gain01: 0, attackSeconds: 0.004, decaySeconds: 0, sustain01: 1, releaseSeconds: 0.04 }, sampleRefs: [], voicePolicy: { maxVoices: 8, steal: 'reject' }, mix: { gain01: 0, pan01: 0 } }, receipt: { patchId: 'real-time-print-unassigned', revision: 1 } });
let ordinal = 0;
export function createCausalTakeRealtimePrint({ journal, resourceBudget, jobs, getCatalog = getNativeInstrumentCatalog, getMaterialProvider, onState = () => {} } = {}) {
  const ownerId = 'causal-realtime-print:' + (++ordinal), scope = createProcgenRetirementScope(), faults = new Set(), bundles = new Set();
  let disposed = false, staged = null, active = null, prepared = null, phase = 'idle', error = null, progress = null, serial = 0;
  const state = () => ({ active: !!active, readyToPrint: !!staged && !active, phase, error, progress, plan: staged?.summary || null, prepared: prepared?.metadata() || null, unresolvedRetirement: faults.size });
  const report = () => { try { onState(state()); } catch {} };
  const retirePlan = plan => { if (!plan || plan.retired) return; retireCausalRead(plan.source); plan.source = null; plan.revoice = null; plan.events.length = 0; plan.eventsById?.clear(); plan.workspace.release(); plan.retired = true; };
  const discardStage = () => { if (staged) { try { retirePlan(staged); staged = null; } catch (caught) { faults.add(staged); throw caught; } } };
  const finalize = async (captured, manifest, controller) => {
    const inputText = canonicalDataText(manifest, { maxBytes:262144,maxNodes:32768 }), byteLength = captured.artifact.metadata().byteLength, inputBytes = byteLength+inputText.bytes.length+65536, peak = inputBytes*8+64*1048576;
    if (!Number.isSafeInteger(byteLength)||byteLength<64||inputBytes>64*1048576||peak>512*1048576) throw fail('The captured PCM is retained. Choose a shorter range for this finalization workspace or download the original private capture.');
    const workspace = createOwnedResourceReservation({budget:resourceBudget,owner:ownerId,kind:'private-print-finalization-input',category:'audio',bytes:byteLength+inputText.bytes.length*4+262144});
    let loan=null,job=null,bytes=null,complete=false,unresolved=false;
    try {
      loan=captured.artifact.borrow();bytes=new Uint8Array(byteLength);let offset=0;
      for await(const chunk of loan.openChunks()){controller.signal.throwIfAborted();if(!(chunk instanceof Uint8Array)||offset+chunk.length>bytes.length)throw fail('The original private capture exceeded its immutable file inventory.');bytes.set(chunk,offset);offset+=chunk.length;}
      if(offset!==bytes.length)throw fail('The original private capture ended before its immutable file boundary.');
      phase='finalizing-private-print-pcm';report(); const sourceRevision=await hashData({take:manifest.sourceCanonicalHash,definition:manifest.definitionHash,capture:manifest.capture.ownerId,sourceStartFrame:manifest.capture.sourceStartFrame,endFrame:manifest.capture.endFrameExclusive});
      job=await jobs.compute({kind:'finalize-causal-realtime-print',ownerId,ownerEpoch:serial,sourceRevision,inputBytes,maxBytes:inputBytes,estimatedPeakBytes:peak,budgetAdapter:resourceBudget,signal:controller.signal,isCurrent:()=>!disposed,prepareInput:()=>({bytes,manifest})});
      const value=job.value;if(job.receipt.method!=='dedicated-worker'||job.receipt.executionIdentity?.buildId!==manifest.applicationBuildId||value.manifest?.sourceCanonicalHash!==manifest.sourceCanonicalHash||value.manifest?.definitionHash!==manifest.definitionHash||value.manifest?.frames!==manifest.frames||value.manifest?.capture?.ownerId!==manifest.capture.ownerId||value.files?.length!==1||!(value.files[0].bytes instanceof Uint8Array)||!/^[a-f0-9]{64}$/.test(value.manifest.pcmHash||''))throw fail('Private PCM finalization returned a different capture, source or worker identity.');
      const artifact=prepareExportArtifact({bytes:value.files[0].bytes,immutableSourceRef:sourceRevision+':'+value.manifest.pcmHash,formatVersion:value.manifest.schema,mediaType:'audio/wav',suggestedFilename:'take-'+manifest.sourceCanonicalHash.slice(0,12)+'-real-time-print.wav',maxBytes:64*1048576,budgetAdapter:resourceBudget});complete=true;return{artifact,manifest:freezeData(value.manifest)};
    } catch(caught){if(caught.backgroundRetirementCompletion)caught.backgroundRetirement=await caught.backgroundRetirementCompletion;if(caught.backgroundRetirement&&!['released','canceled'].includes(caught.backgroundRetirement.phase)){faults.add({captured,loan,workspace,failure:caught});unresolved=true;loan=null;throw caught;}throw caught;}
    finally{job?.release();const retired=job?.retirementState();if(retired&&!['released','canceled'].includes(retired.phase)){faults.add({captured,job,loan,workspace});}else if(loan){loan.release();await loan.settlement;workspace.release();}else if(!job&&!complete&&!unresolved)workspace.release();bytes=null;}
  };
  const prepare = ({ takeId, takeRevision, materialReference, sampleRate = 48000, startSeconds = 0, endSeconds, timeTransformMode = 'captured-live', signal, isCurrent = () => true } = {}) => {
    if (disposed || active || faults.size || ![44100, 48000, 96000].includes(sampleRate) || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 120) return Promise.reject(fail('Choose a complete take, pinned live instrument and an exact crop up to120seconds.'));
    discardStage(); const controller = new AbortController(), abort = () => controller.abort(signal?.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const operation = active = { controller, promise: null }; phase = 'preparing-real-time-print'; error = progress = null; report();
    operation.promise = (async () => {
      let source = null, workspace = null;
      try {
        controller.signal.throwIfAborted(); const reference = validateSoundContentReference(materialReference); if (!reference) throw fail('Select a saved pinned instrument for real-time print.');
        if (!['native-oscillator','native-fm','native-modal','native-sample','worklet-sine','worklet-pluck','worklet-choir','worklet-spectrum','worklet-granular','worklet-sample','worklet-seed-layers','worklet-texture','worklet-friction','worklet-wind','worklet-warp'].includes(reference.engineRequirement.engineId) || reference.definition.modulations?.length) throw fail('This target has no installed prepared local live adapter for real-time print.');
        const catalog = await getCatalog(); if (catalog.state !== 'bound-application-engines' || !catalog.descriptors.some(descriptor => ['engineId', 'engineVersion', 'artifactHash', 'parameterSchemaHash'].every(key => descriptor[key] === reference.engineRequirement[key]))) throw fail('The target live engine is absent from this exact application build.');
        let dependencyMaterial = null;
        try {
          if(reference.assetHashes.length){if(typeof getMaterialProvider!=='function')throw fail('This target needs its original immutable local material provider.');dependencyMaterial=await getMaterialProvider().acquire({reference,engineDescriptors:catalog.descriptors,owner:ownerId+':preflight',generation:serial+1,signal:controller.signal,isCurrent:()=>!disposed&&isCurrent()});}
          const resolution=await resolveSoundContentReference(reference,{engineDescriptors:catalog.descriptors,availableHashes:dependencyMaterial?.availableHashes||[],signal:controller.signal});if(resolution.status!=='ready')throw fail('The selected live instrument dependency closure is unavailable: '+resolution.status);
        } finally {if(dependencyMaterial){const retired=dependencyMaterial.release();await retired?.completion;if(retired&&retired.outcome!=='complete'){faults.add({dependencyMaterial,retired});throw fail('The real-time print dependency preflight retains unresolved readers.');}}}
        if (reference.definition.warpPlan && reference.definition.warpPlan.outputRate !== sampleRate) throw fail('Choose the WarpVoice material’s saved output rate.');
        workspace = createOwnedResourceReservation({ budget: resourceBudget, owner: ownerId, kind: 'frozen-real-time-print-schedule', category: 'audio', bytes: 8 *1048576 });
        const epoch = ownerId + ':' + (++serial);
        source = await querySoundOnlyRevoiceOwned({ journal, resourceBudget, jobs, takeId, takeRevision, soundPatch: { id: reference.patchId, revision: reference.revision, definitionHash: reference.definitionHash, engineRequirement: reference.engineRequirement }, executionEpoch: epoch, limit: 8192, maxIntents: 32768, maxBytes: 16 *1048576, signal: controller.signal });
        controller.signal.throwIfAborted(); if (disposed || !isCurrent()) throw fail('The print source selection changed.'); const revoice = source.value;
        if (revoice.nextSequence != null || revoice.boundary?.status !== 'captured-initial-state' || !Array.isArray(revoice.boundary?.state?.voices) || revoice.boundary.state.voices.length || revoice.bodyCommands?.length || !Array.isArray(revoice.intents)) throw fail('This real-time revoice needs complete onset history from an empty initial boundary without separate prepared-body commands.');
        const timing = createCausalRenderTiming(revoice, sampleRate, { timeTransformMode }), first = Math.round(startSeconds * sampleRate), end = Math.round(endSeconds * sampleRate);
        if (end > Math.round(timing.coverage().maximumCoveredOutputSeconds * sampleRate) || end <= first || (end - first)*8 +524288 >64 *1048576) throw fail('The selected crop exceeds covered source time or its64MiB captured PCM profile.');
        const events = revoice.intents.map((intent, index) => ({ frame: timing.frameFor(intent), index, intent })).filter(event => event.frame < end).sort((a,b) => a.frame-b.frame || a.index-b.index);
        const generations = new Set(events.map(event => event.intent.generation)), worlds = new Set(events.map(event => event.intent.worldId)); if (generations.size >1 || worlds.size >1) throw fail('Print one complete captured physical generation at a time.');
        const summary = freezeData({ schema: 'lemmings-real-time-take-print-plan/v1', takeId, takeRevision: revoice.takeRevision, sourceCanonicalHash: revoice.sourceCanonicalHash, definitionHash: reference.definitionHash, engineRequirement: reference.engineRequirement, applicationBuildId: catalog.executionIdentity.buildId, sampleRate, startSeconds, endSeconds, frames: end-first, prerollSeconds: startSeconds, maximumWallSeconds: endSeconds+5, intents: events.length, timeTransformMode, tap: 'isolated-private-browser-graph-post-protection', monitoring: 'capture-only;no-live-master-or-external-MIDI', mode: 'explicit-paused-live-real-time-intent-revoice', fidelity: 'new-selected-live-engine-realization;actual-private-digital-PCM' });
        staged = { source, workspace, reference, revoice, events, first, end, sampleRate, summary, epoch, isCurrent, generation: events[0]?.intent.generation ??0, worldId: events[0]?.intent.worldId ??'silent-print', retired: false }; source = workspace = null; phase = 'ready-to-print'; return summary;
      } catch (caught) { if (source) retireCausalRead(source); workspace?.release(); phase = controller.signal.aborted ? 'canceled' : 'failed'; error = caught.message; throw caught; }
      finally { signal?.removeEventListener('abort', abort); if (active === operation) active = null; report(); }
    })(); return operation.promise;
  };
  const start = ({ beforePrint, signal } = {}) => {
    if (disposed || active || !staged || faults.size || typeof beforePrint !== 'function') return Promise.reject(fail('Prepare the print first, then explicitly stop live browser output before starting its private real-time render.'));
    const plan = staged; staged = null; const controller = new AbortController(), abort = () => controller.abort(signal?.reason); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const operation = active = { controller, promise: null }, producers = createProcgenRetirementScope(); let preview = null, session = null, fallback = null, routed = null, instruments = null, dispatcher = null, capture = null, admissionFailure = null, captureResult = null, bundle = null;
    const check = () => { controller.signal.throwIfAborted(); if (disposed || !plan.isCurrent()) throw fail('The real-time print source changed.'); if (admissionFailure) throw admissionFailure; };
    phase = 'stopping-live-output-for-print'; error = progress = null; report();
    operation.promise = (async () => {
      let failure = null;
      try {
        check(); const hold = await beforePrint(); check(); if (hold?.paused !== true) throw fail('The workstation did not acknowledge an explicit paused live boundary.');
        preview = createBrowserNotePreview({ resourceBudget, maxVoices: 8, maxInstrumentBackends: 3, maxNoteSeconds: 120, volume: 1, masterVolume: 1, monitorOutput: 'capture-only', runtimeConfig: { latencyProfile: 'robust', preferredSampleRate: plan.sampleRate } });
        if (!await preview.enable(undefined, { takeOver: true })) throw fail('Enable the isolated print context after stopping live browser output.'); check(); const context = preview.getAudioContext(); if (context.sampleRate !== plan.sampleRate || preview.getState().monitorOutput !== 'capture-only') throw fail('The real-time print context did not use the exact requested rate and silent route.');
        session = preview.createSession(ownerId); if (!await session.enable()) throw fail('The private print source session could not be enabled.');
        session.configureLaneSources(['print']); fallback = session.createInstrumentBackend({ gateMode: 'owned' }); if ((await fallback.prepare(silentDefault)).status !== 'ready') throw fail('The private source router could not prepare.');
        const key = plan.reference.packHash+':'+plan.reference.definitionHash;
        routed = createRoutedInstrumentBackend({ defaultBackend: fallback, resourceBudget, maxChildren: 2, maxVoices: 8, maxLanes: 1, getContext: () => context, getGeneration: () => fallback.executionIncarnation(), resolveLane: () => 'print', requiredInstrumentKey: () => key });
        instruments = createLaneInstrumentPreparation({ session, routed, resourceBudget, getCatalog, getMaterialProvider, maxLanes: 1 }); phase = 'preparing-private-live-engine'; report();
        const candidate = await instruments.prepare('print', plan.reference, { signal: controller.signal }); check(); candidate.validateCommit(); candidate.commit(); check();
        const origin = Math.ceil((context.currentTime+0.75)*plan.sampleRate), frames = plan.end-plan.first;
        const metadata = { ...plan.summary, sourceAudioFrame: origin, intendedCaptureStartFrame: origin+plan.first, intendedCaptureEndFrame: origin+plan.end, sourceOnsetsSynthesized: false, sourceWorldAdvanced: false, externalMidi: false, liveMasterIncluded: false, monitoring: 'capture-only;silent-pull', outputProtection: 'private-instance-of-declared-browser-protection;live-master-excluded' };
        capture = createOwnedMasterCapture({ preview, resourceBudget, onChange: report }); phase = 'arming-private-print-capture'; report(); await capture.start({ seconds: frames/plan.sampleRate, targetStartFrame: origin+plan.first, renderJob: metadata }); check();
        const receipt = value => { if (['rejected','faulted'].includes(value?.status)) admissionFailure ||= fail('The selected live print engine refused an original intent: '+(value.reason||value.stage)); };
        dispatcher = createCausalIntentDispatcher({ resourceBudget, sinks: [{ id: 'private-print', route: 'local', backend: routed, timeDomain: 'audio-sample-frames' }], executionEpoch: () => plan.epoch, toTargetFrame: (score,batch,intent) => origin+plan.eventsById.get(intent.intentId), latePolicy: createStrictLiveFramePolicy({ nowFrame: () => Math.ceil(context.currentTime*plan.sampleRate) }), onReceipt: receipt });
        plan.eventsById = new Map(plan.events.map(event => [event.intent.intentId,event.frame]));
        let cursor = 0; phase = 'printing-in-real-time'; report();
        while (true) {
          check(); const captured = capture.state(); if (['ready','partial','failed'].includes(captured.state)) { captureResult = captured; break; } if (context.state !== 'running') throw fail('The private print context was suspended.');
          const nowFrame = Math.ceil(context.currentTime*plan.sampleRate), horizon = nowFrame+Math.ceil(plan.sampleRate*0.2), batch = { version: 1, worldId: plan.worldId, generation: plan.generation, batchId: plan.epoch+':'+cursor };
          const renewed = dispatcher.renewExecutionLease(plan.generation, plan.epoch, nowFrame+plan.sampleRate); if (renewed.some(value => value.status === 'rejected')) throw fail('The private engine did not renew its owned execution lease.');
          while (cursor <plan.events.length && origin+plan.events[cursor].frame <= horizon) {
            const event = plan.events[cursor++]; if (origin+event.frame <nowFrame) throw fail('The main-thread print feeder missed an original target frame. The partial capture is retained.');
            const printed = { ...event.intent, timeTransformPolicy: null, route: 'local', laneId: 'print', audioLaneId: 'print' };
            const receipts = dispatcher.dispatch([printed], batch); if (!receipts.length || receipts.some(value => !['accepted','deferred'].includes(value.status))) throw fail('The private source did not admit the complete frozen intent.'); check();
          }
          progress = { completedUnits: Math.max(0,Math.min(plan.end,nowFrame-origin)), totalUnits: plan.end }; report(); await wait();
        }
        if (captureResult.state !=='ready' || captureResult.unresolvedOwnership || captureResult.manifest.nativeRetirement !== 'complete' || captureResult.manifest.sourceStartFrame !== origin+plan.first || captureResult.manifest.timelineFrames !==frames || !captureResult.manifest.terminalAcknowledged) throw fail('Real-time print ended without a complete exact-frame private PCM capture.');
      } catch (caught) { failure = caught; error = caught.message; if (capture) { try { await capture.stop('panic'); captureResult = capture.state(); } catch {} } }
      const producerReceipt = operation.retirement = producers.retire([{ name: 'private-print-producer-chain', run: async () => {
        for (const owner of [dispatcher, instruments, routed || fallback, session, preview]) { const result = owner?.dispose(), receipt = result?.completion ? result : await result; await receipt?.completion; if (receipt === false || receipt?.outcome && receipt.outcome !== 'complete') throw fail('An actual private print producer did not retire.'); }
      } }]); await producerReceipt.completion;
      if (producerReceipt.outcome !=='complete') { faults.add(producerReceipt); failure ||=fail('Private print DSP retirement remains unresolved.'); }
      try { if (producerReceipt.outcome ==='complete') retirePlan(plan); else faults.add(plan); } catch (caught) { faults.add(plan); failure ||=caught; }
      if (captureResult?.artifact) {
        const pcm = captureResult.manifest; let manifest = freezeData({ ...plan.summary, schema: 'lemmings-causal-audio-render/v1', mode: 'real-time-intent-print', operation: 'sound-only-revoice', sampleRate: pcm.sampleRate, frames: pcm.timelineFrames, timelineZeroSourceFrame: plan.first, exactEndSourceFrame: plan.end, capture: pcm, tail: { mode: 'exact-crop' }, engineRequirement: plan.reference.engineRequirement, originalRecordMutated: false, acousticReceipt: false, channels: 2, sampleFormat: 'ieee-float32-le', pcmHash: null, fileState: failure ? 'partial-or-unqualified' : 'complete-private-digital-capture', failure: failure?.message ||null });
        let artifact=captureResult.artifact;
        if(!controller.signal.aborted)try{const finalized=await finalize(captureResult,manifest,controller);artifact=finalized.artifact;manifest=finalized.manifest;captureResult.artifact.discard();const retired=capture.dispose();await retired.completion;if(retired.outcome!=='complete'){faults.add(retired);failure||=fail('The original print capture remains owned after finalization.');}}catch(caught){failure||=caught;error=caught.message;}
        const retirement = createProcgenRetirementScope(), file = Object.freeze({ id: 'real-time-print', label: failure ? 'Partial private real-time print · review capture gaps' : 'Private real-time print · actual digital PCM', artifact, manifest }); let discarded = false;
        bundle = Object.freeze({ files: Object.freeze([file]), manifest, metadata: () => ({ mode: manifest.mode, frames: manifest.frames, sampleRate: manifest.sampleRate, sourceTakeId: plan.summary.takeId, discarded, files: [{ id: file.id,label: file.label,artifact: file.artifact.metadata() }] }), discard() { if (retirement.getReceipt()) return retirement.getReceipt(); discarded = true; if (prepared===bundle) prepared=null; return retirement.retire([{ name: 'private-print-capture', run: async () => { file.artifact.discard(); await file.artifact.digest(); return capture.dispose(); } }]); } }); bundles.add(bundle); const prior=prepared; prepared=bundle; const retired=prior?.discard(); await retired?.completion; if (retired && retired.outcome!=='complete') faults.add(retired);
      } else { const retired=capture?.dispose(); await retired?.completion; if (retired && retired.outcome!=='complete') faults.add(retired); }
      phase = failure ? controller.signal.aborted?'canceled':'failed' : 'prepared'; progress=null; report(); if (failure) throw failure; return { bundle, receipt: { method: 'isolated-real-time-render-and-owned-pcm-capture', output: 'private-digital-only' } };
    })().finally(() => { signal?.removeEventListener('abort',abort); if(active===operation)active=null;report(); });return operation.promise;
  };
  return Object.freeze({ prepare, start, state, getPrepared: () => prepared,
    cancel() { if(active){active.controller.abort(fail('Real-time print canceled.'));return true;}discardStage();phase='idle';report();return false; },
    dispose() {
      if(scope.getReceipt())return scope.getReceipt();disposed=true;const operation=active;operation?.controller.abort(fail('Real-time print retired.'));
      const join=async()=>{await operation?.promise.catch(()=>{});if(faults.size)throw fail('Real-time print retains unresolved owners.');};
      return scope.retire([{name:'real-time-print-operation',run:join},{name:'frozen-print-plan',run:async()=>{await join();discardStage();}},{name:'real-time-print-artifacts',run:async()=>{await join();return createProcgenRetirementScope().retire([...bundles].map((bundle,index)=>({name:'print-'+index,run:()=>bundle.discard()})));}}]);
    }
  });
}
