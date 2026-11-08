import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { validateInstrumentPatchV2 } from '../../midi/content/InstrumentPatchV2.js';
import { validateBufferedWarpPlan, acceptsWarpPitch, warpPreparationBoundary } from '../../midi/content/BufferedWarpPlan.js';
import { prepareBufferedWarpVoiceOwner } from './BufferedWarpVoiceOwner.js';
import { prepareOwnedPcmBank } from './OwnedPcmBank.js';
import { createOwnedStretchMaterial } from './OwnedStretchMaterial.js';
import { createVoiceLaneMix, validVoiceLaneMix } from './VoiceLaneMix.js';
import { createRendererPublicationOwner } from './RendererPublicationOwner.js';
import { createInstrumentExecutionLifecycle } from './InstrumentExecutionLifecycle.js';
import { backgroundJobService } from '../resources/BackgroundJobService.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { canonicalDataText, hashData } from '../../core/CanonicalData.js';

const finite = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const natural = value => Number.isSafeInteger(value) && value >= 0;
const fail = message => Object.assign(new Error(message), { code: 'buffered-warp-instrument-unavailable' });
const retire = async (value, method) => { if (!value) return; const receipt = value[method](); if (receipt === true) return; await receipt?.completion; if (receipt?.outcome !== 'complete') throw fail('Streaming instrument input or producer retirement remains unresolved.'); };
const key = (generation, epoch) => JSON.stringify([generation, epoch]);
export function createBufferedWarpInstrumentBackend(preview, owner, { publicationMuted = false, jobs = backgroundJobService } = {}) {
  if (!preview?._audioResources || !preview._soundMaterialBudget || typeof publicationMuted !== 'boolean') throw new TypeError('A streaming patch requires its canonical browser audio owner.');
  const budget = preview._soundMaterialBudget, coreMaterial = createOwnedStretchMaterial({ resourceBudget: budget }), retirement = createProcgenRetirementScope(), leases = new Map(), canceled = new Set(), observers = new Set();
  let context = null, patch = null, source = null, publication = null, output = null, voice = null, preparation = null, controller = null, producerRetirement = null,
    disposed = false, ready = false, rearming = false, pollTimer = null, polling = null, serial = 0, fault = null;
  const runtime = Object.freeze({ engineId: 'worklet-warp', engineVersion: 1, sourceMode: 'immutable-buffered-source;independent-owned-output-gate', restoration: 'deterministicPreroll' });
  const capabilities = Object.freeze({ ...runtime, maximumVoices: 1, ownedGates: true, perVoicePitch: true, livePitchUpdates: false, perVoicePressure: true, perVoicePan: true,
    bufferedTimeWarp: true, forwardLoops: true, offlineRender: false, restoration: 'deterministicPreroll', displayTelemetry: false, renderAcknowledgment: true, macroPerformance: false,
    sourceStateTransfer: Object.freeze({ mode: 'deterministicPreroll', stateSchema: null, maxStateBytes: 0, maxPrerollFrames: 384000, sampleRatePolicy: 'exact', scope: 'original-source-and-canonical-history', qualification: 'experimental;final-matrix-pending' }) });
  const frameNow = () => context ? Math.ceil(context.currentTime * context.sampleRate) : null;
  const available = () => !disposed && !fault && ready && context === preview.getAudioContext() && preview._ownerReady(owner);
  const record = value => { const result = Object.freeze({ engineId: runtime.engineId, acousticReceipt: false, ...value }); for (const listener of [...observers]) { try { listener(result); } catch {} } return result; };
  const rejected = (reason, voiceId = null) => record({ status: 'rejected', stage: 'none', reason, voiceId });
  const queued = (entry, frame, operation) => record({ status: 'accepted', stage: 'owned-host-queued', voiceId: entry.voiceId, generation: entry.semanticGeneration, executionEpoch: entry.semanticEpoch, sequence: ++serial, targetFrame: frame, appliedFrame: null, operation });
  const checkPreparation = () => { controller.signal.throwIfAborted(); if (disposed || context !== preview.getAudioContext()) throw fail('The source context or preparation owner changed.'); };
  const stop = (skipVoice = false) => {
    if (producerRetirement) return producerRetirement; ready = false; controller?.abort(); clearInterval(pollTimer); pollTimer = null;
    producerRetirement = createProcgenRetirementScope().retire([{ name: 'warp-instrument-preparation', run: () => preparation?.catch(() => {}) },
      { name: 'warp-instrument-producer', run: async () => { await preparation?.catch(() => {}); if (source) await retire(source, 'dispose'); } },
      { name: 'warp-instrument-publication', run: async () => { await preparation?.catch(() => {}); if (source) await retire(source, 'dispose'); if (publication) { const receipt = publication.dispose({ producerRetired: true }); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('Streaming publication remains owned.'); } } },
      { name: 'warp-instrument-voice', run: async () => { await preparation?.catch(() => {}); if (source) await retire(source, 'dispose'); if (voice && !skipVoice) { const current = voice; current.producerRetired = true; if (current.retirement) return; const receipt = preview._destroyVoice(current, 'warp-owner-stop'); await receipt?.completion; if (receipt && receipt.outcome !== 'complete') throw fail('Streaming voice retirement remains unresolved.'); } } }]);
    return producerRetirement;
  };
  const markFault = error => { fault ||= String(error?.message || error); ready = false; if (voice) record({ status: 'faulted', stage: 'owned-source-failure', voiceId: voice.voiceId, generation: voice.semanticGeneration, executionEpoch: voice.semanticEpoch, reason: fault, appliedFrame: null }); stop(); };
  const prepare = (resolution, assets = []) => {
    if (disposed || preparation) return Promise.resolve(rejected('streaming-preparation-unavailable'));
    if (ready && patch?.definitionHash === resolution.reference?.definitionHash) return Promise.resolve(Object.freeze({ status: 'ready', runtime, capabilities, source: patch.plan }));
    if (voice || source && !producerRetirement) return Promise.resolve(rejected('previous-streaming-source-still-owned'));
    controller = new AbortController(); context = preview.getAudioContext(); fault = null;
    preparation = (async () => {
      let bank = null, copy = null, core = null, job = null, candidate = null, candidatePublication = null;
      try {
        if (producerRetirement) { await producerRetirement.completion; if (producerRetirement.outcome !== 'complete') throw fail('The prior streaming producer remains owned.'); source = publication = output = null; producerRetirement = null; }
        checkPreparation(); const catalog = await getNativeInstrumentCatalog(), descriptor = catalog.descriptors.find(row => row.engineId === runtime.engineId); checkPreparation();
        if (catalog.state !== 'bound-application-engines' || !descriptor || resolution.status !== 'ready' || resolution.receipt?.patchId !== resolution.patch?.id || resolution.receipt?.revision !== resolution.patch?.revision || resolution.receipt.engineArtifactHash !== descriptor.artifactHash || resolution.receipt.parameterSchemaHash !== descriptor.parameterSchemaHash) throw fail('The streaming patch needs its exact installed application artifact.');
        const definition = validateInstrumentPatchV2(resolution.patch, descriptor), plan = validateBufferedWarpPlan(definition.warpPlan);
        if (context?.state !== 'running' || context.sampleRate !== plan.outputRate || assets.length !== 1 || assets[0]?.ref?.contentHash !== plan.assetHash) throw fail('Enable the exact prepared-rate context and retain the one original source asset.');
        const definitionHash = await hashData(definition); if (resolution.reference && resolution.reference.definitionHash !== definitionHash) throw fail('The saved definition differs from its immutable identity.');
        const parameters = { attackSeconds: 0.003, releaseSeconds: 0.04, maximumHoldSeconds: 8, gain01: 0.4, pan01: 0, ...definition.parameters };
        bank = await prepareOwnedPcmBank(assets[0], { resources: preview._audioResources, owner: 'warp:' + owner, signal: controller.signal, isCurrent: () => !disposed && context === preview.getAudioContext() }); checkPreparation();
        copy = await bank.copyForProcessor({ signal: controller.signal, isCurrent: () => !disposed && context === preview.getAudioContext() }); checkPreparation();
        core = await coreMaterial.borrow({ signal: controller.signal, isCurrent: () => !disposed && context === preview.getAudioContext() }); checkPreparation();
        const wasmBytes = new Uint8Array(await core.blob.arrayBuffer()); checkPreparation();
        const input = { mode: 'instrument-patch', plan, pcm: copy.payload, wasmBytes, applicationBuildId: catalog.executionIdentity.buildId }, inputBytes = copy.descriptor.bytes + wasmBytes.byteLength + canonicalDataText(plan, { maxBytes: 16384 }).bytes.length + 16384;
        job = await jobs.compute({ kind: 'prepare-streaming-warp-material', ownerId: 'streaming-warp-instrument', ownerEpoch: 0, sourceRevision: definitionHash, inputBytes, maxBytes: Math.max(inputBytes, 16 * 1048576), estimatedPeakBytes: 256 * 1048576 + copy.descriptor.bytes * 3,
          budgetAdapter: budget, signal: controller.signal, isCurrent: () => !disposed && context === preview.getAudioContext(), deadlineMs: 180000, prepareInput: () => input }); checkPreparation();
        const material = job.value;
        if (job.receipt.method !== 'dedicated-worker' || job.receipt.kind !== 'prepare-streaming-warp-material' || job.receipt.sourceRevision !== definitionHash || job.receipt.executionIdentity?.buildId !== catalog.executionIdentity.buildId || material.applicationBuildId !== catalog.executionIdentity.buildId || material.planHash !== await hashData(plan) || material.source?.assetHash !== plan.assetHash || material.source.sourcePcmHash !== copy.descriptor.pcmHash) throw fail('The streaming material differs from its saved plan, original PCM or immutable producing worker.');
        candidatePublication = createRendererPublicationOwner({ context, resources: preview._audioResources, owner, initiallyMuted: publicationMuted, maxGates: 1 }); const gate = candidatePublication.addGate();
        candidate = await prepareBufferedWarpVoiceOwner({ context, destination: gate, material: { plan: material.plan, pcm: material.pcm, image: material.image }, contextEpoch: preview._contextEpoch, resourceBudget: budget, signal: controller.signal,
          isCurrent: () => !disposed && context === preview.getAudioContext(), onState: value => { if (value.fault) markFault(value.fault); } }); checkPreparation();
        job.release(); if (!['released', 'canceled'].includes(job.retirementState().phase)) throw fail('The source preparation worker did not retire.'); job = null;
        await retire(copy, 'release'); copy = null; await retire(bank, 'discard'); bank = null; if (core.release() !== true) throw fail('The immutable core reader did not retire.'); core = null; checkPreparation();
        patch = Object.freeze({ definition, plan, parameters: Object.freeze(parameters), definitionHash }); source = candidate; publication = candidatePublication; output = gate; candidate = candidatePublication = null; leases.clear(); ready = true;
        pollTimer = setInterval(() => { if (!polling && voice) { polling = pollVoice().catch(markFault).finally(() => { polling = null; }); } }, 20);
        return Object.freeze({ status: 'ready', runtime, capabilities, plan, preparationLeadFrames: source.preparationLeadFrames, qualification: 'experimental;not-device-qualified' });
      } catch (error) {
        const cleanup = createProcgenRetirementScope().retire([{ name: 'candidate-warp-source', run: () => candidate ? retire(candidate, 'dispose') : null }, { name: 'candidate-publication', run: async () => { if (candidate) await retire(candidate, 'dispose'); if (candidatePublication) { const receipt = candidatePublication.dispose({ producerRetired: true }); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('Candidate publication remains owned.'); } } },
          { name: 'material-worker', run: async () => { if (error.backgroundRetirementCompletion) await error.backgroundRetirementCompletion; job?.release(); const state = job?.retirementState() || error.backgroundRetirement; if (state && !['released', 'canceled'].includes(state.phase)) throw fail('Candidate material worker remains owned.'); } }, { name: 'source-pcm-copy', run: () => retire(copy, 'release') }, { name: 'source-pcm-bank', run: async () => { await retire(copy, 'release'); await retire(bank, 'discard'); } }, { name: 'core-reader', run: () => { if (core && core.release() !== true) throw fail('Candidate core reader remains owned.'); } }]);
        await cleanup.completion; if (cleanup.outcome !== 'complete') { error.retirement = cleanup; fault = error.message; preview._retirementFaults?.add(owner); } throw error;
      }
    })().finally(() => { preparation = null; }); return preparation;
  };
  const begin = (intent, targetFrame, epoch = 'live') => {
    if (!available() || rearming || voice) return rejected(!available() ? fault || 'audio-not-ready' : 'one-streaming-voice-occupied', intent?.voiceId);
    const plan = patch.plan, p = patch.parameters, now = frameNow(), expression = intent?.expression || {}, reference = intent?.pitch?.referenceHz ?? 440, root = plan.rootPitch.referenceHz * 2 ** ((plan.rootPitch.cents - 6900) / 1200), frequency = reference * 2 ** (((intent?.pitch?.cents ?? NaN) - 6900 + (expression.pitchOffsetCents ?? 0)) / 1200), desired = frequency / root * plan.pitchRatio,
      ratio = [0.5, 1, 2].find(value => Math.abs(value - desired) < 1e-9);
    if (intent?.version !== 1 || intent.kind !== 'begin' || typeof intent.voiceId !== 'string' || !intent.voiceId || intent.voiceId.length > 256 || typeof intent.onsetId !== 'string' || !intent.onsetId || intent.onsetId.length > 256 || !natural(intent.generation) || typeof epoch !== 'string' || !epoch || epoch.length > 128 || !finite(intent.velocity01, 0, 1) || !natural(targetFrame) || targetFrame < now || !finite(intent.pitch?.cents, -24000, 24000) || !finite(reference, 1, 20000) || !acceptsWarpPitch(ratio) || !finite(expression.pressure01 ?? 1, 0, 1) || !finite(expression.pan01 ?? 0, -1, 1) || Object.keys(expression).some(id => !['pressure01', 'pan01', 'pitchOffsetCents'].includes(id)) || !validVoiceLaneMix(intent.laneMix) || Object.keys(intent.performanceControls || {}).some(id => id !== 'macros' || Object.keys(intent.performanceControls.macros || {}).length)) return rejected('unsupported-intent-pitch-matrix-or-controls', intent?.voiceId);
    if (canceled.has(key(intent.generation, epoch))) return rejected('generation-canceled', intent.voiceId);
    const lease = leases.get(key(intent.generation, epoch)); if (!lease || lease <= targetFrame + Math.ceil(p.releaseSeconds * context.sampleRate)) return rejected('execution-lease-required', intent.voiceId);
    const preparation = warpPreparationBoundary(plan, { preparedAtOutputFrame: now, targetOutputFrame: targetFrame }); if (preparation.status !== 'prepared-in-domain') return rejected('missed-warp-preparation-deadline', intent.voiceId);
    const maximumEnd = targetFrame + Math.round(p.maximumHoldSeconds * context.sampleRate), endFrame = maximumEnd + Math.ceil(Math.max(p.releaseSeconds * context.sampleRate, 128)), admission = preview._inspectVoiceInterval(owner, { start: targetFrame / context.sampleRate, end: endFrame / context.sampleRate, releaseAt: maximumEnd / context.sampleRate, cost: 1, patchVoices: [], patchLimit: 1 });
    if (!admission.accepted) return rejected(admission.reason, intent.voiceId);
    let laneMix = null, resourceLease = null;
    try { laneMix = createVoiceLaneMix({ preview, context, owner, generation: intent.generation, destination: preview._channel(0, owner).sourceInput, start: targetFrame / context.sampleRate, laneId: intent.audioLaneId ?? null, voiceId: intent.voiceId, value: intent.laneMix }); output.connect(laneMix.input); resourceLease = preview._audioResources.reserveWorkletVoice(owner, intent.generation, 4096); }
    catch (error) { laneMix?.dispose(); resourceLease?.release(); return rejected(error.message, intent.voiceId); }
    let resolveCompletion; const entry = { owner, number: 0, voiceId: intent.voiceId, semanticGeneration: intent.generation, semanticEpoch: epoch, id: ++preview._voiceSequence, renderCost: 1, workloadClass: preview._workloadClass(owner), resourceLease,
      nativeNodesOwnedByBackend: true, audioLaneId: intent.audioLaneId ?? null, laneIndex: intent.laneId ?? 0, start: targetFrame / context.sampleRate, startMs: preview._nowMs() + (targetFrame - now) * 1000 / context.sampleRate, end: endFrame / context.sampleRate, releaseAt: maximumEnd / context.sampleRate,
      release: p.releaseSeconds, attack: p.attackSeconds, decay: 0, sustain: 1, peak: intent.velocity01 * p.gain01 * patch.definition.mix.gain01, velocity: intent.velocity01 * 127, note: Math.round(intent.pitch.cents / 100), patchId: patch.definition.id, patchRevision: patch.definition.revision,
      pressure: expression.pressure01 ?? 1, expressionPan: expression.pan01 ?? 0, released: false, sourceIdentity: { voiceId: intent.voiceId, onsetId: intent.onsetId, generation: intent.generation, epoch, sequence: 0 }, laneMix, operations: 0, identitySequence: 0, admittedEndFrame: endFrame, onsetApplied: false, endApplied: false, endedConfirmed: false, producerRetired: false, completion: new Promise(resolve => { resolveCompletion = resolve; }),
      captureMeta: preview._captureMetadata({ semanticVoiceId: intent.voiceId, generation: intent.generation, executionEpoch: epoch, onsetId: intent.onsetId, intentId: intent.intentId, sourceEventIds: intent.sourceEventIds?.slice(0, 32), sourceAssetHash: plan.assetHash, warpPlan: plan }, owner),
      isFinished: () => entry.endedConfirmed, requestRelease: (time, force) => end(entry.voiceId, { seconds: force ? 0.005 : entry.release, force }, Math.max(0, Math.round(time * context.sampleRate)), epoch),
      onDestroy: () => {
        const scope = createProcgenRetirementScope(), receipt = scope.retire([{ name: 'streaming-source-boundary', run: () => entry.endedConfirmed || entry.producerRetired ? null : stop(true) }, { name: 'streaming-voice-lane', run: async () => { if (!entry.endedConfirmed && !entry.producerRetired) { const stopped = stop(true); await stopped.completion; if (stopped.outcome !== 'complete') throw fail('The streaming source still owns its voice.'); } output?.disconnect(entry.laneMix.input); return entry.laneMix.dispose(); } }, { name: 'semantic-voice', run: () => { if (voice === entry) voice = null; const identity = JSON.stringify([owner, epoch, entry.voiceId]); if (preview._semanticVoiceOwners.get(identity) === entry) preview._semanticVoiceOwners.delete(identity); } }]);
        receipt.completion.then(resolveCompletion); return receipt;
      } };
    voice = entry; preview._voices.add(entry); preview._semanticVoiceOwners.set(JSON.stringify([owner, epoch, entry.voiceId]), entry);
    const receipt = queued(entry, targetFrame, 'begin'); entry.beginReceipt = receipt; entry.chain = source.begin({ identity: entry.sourceIdentity, onsetOutputFrame: targetFrame, segment: { outputFrame: targetFrame, active: true, pitchRatio: ratio, rateRatio: plan.rateRatio }, outputGate: { attackFrames: Math.round(p.attackSeconds * context.sampleRate), maximumEndOutputFrame: maximumEnd, gain01: entry.peak * entry.pressure, pan01: Math.max(-1, Math.min(1, p.pan01 + patch.definition.mix.pan01 + entry.expressionPan)) } }).then(value => { record({ ...receipt, stage: 'processor-onset-and-source-admitted', preparation: value.preparation, appliedFrame: null }); return value; }).catch(error => { markFault(error); });
    return Object.freeze({ ...receipt, preparation, source: { assetHash: plan.assetHash, sourceRate: plan.sourceRate, sourceFrameRegion: plan.sourceFrameRegion, outputRate: plan.outputRate, pitchRatio: ratio, rateRatio: plan.rateRatio }, maximumEndFrame: maximumEnd });
  };
  const end = (voiceId, release = {}, targetFrame, epoch = 'live') => {
    const entry = voice; if (!entry || entry.voiceId !== voiceId || entry.semanticEpoch !== epoch || !natural(targetFrame) || !finite(release.seconds ?? entry.release, 0, 4) || release.mode != null && release.mode !== 'one-shot' || release.mode === 'one-shot' && !finite(release.tailSeconds, 0, 8)) return rejected('voice-or-release-unavailable', voiceId);
    let frame = targetFrame; if (release.mode === 'one-shot') frame = Math.max(frame, Math.round((entry.start + release.tailSeconds) * context.sampleRate)); frame = Math.min(frame, Math.round(entry.end * context.sampleRate) - 1);
    if (entry.operations >= 32) return rejected('streaming-command-capacity', voiceId); entry.operations++; entry.released = true; entry.releaseAt = Math.min(entry.releaseAt, frame / context.sampleRate);
    const receipt = queued(entry, frame, 'end'), sourceIdentity = { ...entry.sourceIdentity, sequence: ++entry.identitySequence }, releaseFrames = Math.max(1, Math.min(Math.ceil((release.seconds ?? entry.release) * context.sampleRate), entry.admittedEndFrame - Math.max(frame, frameNow()))); entry.endReceipt = receipt;
    entry.chain = entry.chain.then(() => source.endOutputGate({ identity: sourceIdentity, outputFrame: frame, releaseFrames, latePolicy: 'release-next-quantum' })).then(value => { if (value.status !== 'accepted') throw fail(value.reason); entry.end = (value.targetOutputFrame + value.releaseFrames) / context.sampleRate; record({ ...receipt, stage: 'processor-output-release-admitted', targetFrame: value.targetOutputFrame, requestedTargetFrame: targetFrame, appliedFrame: null, lateByFrames: value.lateByFrames || 0 }); }).catch(markFault).finally(() => { entry.operations--; }); return receipt;
  };
  const pollVoice = async () => {
    const entry = voice; if (!entry || !source || !available()) return;
    const lease = leases.get(key(entry.semanticGeneration, entry.semanticEpoch)); if (!entry.released && (!lease || frameNow() >= lease)) end(entry.voiceId, { seconds: 0.005, force: true }, frameNow(), entry.semanticEpoch);
    const observed = await source.inspectOutputGate(); if (voice !== entry) return;
    if (!entry.onsetApplied && Number.isSafeInteger(observed.renderedStartOutputFrame)) { entry.onsetApplied = true; preview._observe('synth-scheduled', { ...entry.captureMeta, voiceId: entry.id, targetFrame: entry.beginReceipt.targetFrame, audioTime: observed.renderedStartOutputFrame / context.sampleRate, endAudioTime: entry.end, patchId: entry.patchId, patchRevision: entry.patchRevision, evidence: 'owned-PCM-processor-frame-observation' }); record({ ...entry.beginReceipt, stage: 'render-kernel-applied', appliedFrame: observed.renderedStartOutputFrame, evidence: 'owned-PCM-processor-frame-observation;not-device-output' }); }
    if (!entry.endApplied && entry.endReceipt && Number.isSafeInteger(observed.renderedReleaseStartOutputFrame)) { entry.endApplied = true; preview._observe('synth-release', { ...entry.captureMeta, type: 'noteOff', voiceId: entry.id, channel: 0, note: entry.note, audioTime: observed.renderedReleaseStartOutputFrame / context.sampleRate, endAudioTime: entry.end, reason: 'owned-warp-gate-release' }); record({ ...entry.endReceipt, stage: 'render-kernel-applied', appliedFrame: observed.renderedReleaseStartOutputFrame, evidence: 'owned-output-gate-frame-observation;not-device-output' }); }
    if (!observed.gateFinished) return; await entry.chain; if (voice !== entry) return; entry.endedConfirmed = true;
    record({ status: 'accepted', stage: 'render-kernel-ended', voiceId: entry.voiceId, generation: entry.semanticGeneration, executionEpoch: entry.semanticEpoch, appliedFrame: observed.renderedEndOutputFrame, targetFrame: Math.round(entry.end * context.sampleRate), evidence: 'owned-PCM-processor-frame-observation;not-device-output' });
    rearming = true; const receipt = preview._destroyVoice(entry, 'owned-warp-output-ended'); await receipt?.completion; if (receipt && receipt.outcome !== 'complete') throw fail('Ended streaming voice retains resources.');
    for (let attempt = 0; attempt < 50 && source.state().bound; attempt++) await new Promise(resolve => setTimeout(resolve, 4));
    if (!disposed && !producerRetirement) { const reset = await source.rearm(); if (reset.status !== 'ready') throw fail(reset.reason || 'The settled source could not rearm.'); } rearming = false;
  };
  const update = (voiceId, expression, targetFrame, epoch = 'live') => {
    const entry = voice; if (!available() || !entry || entry.voiceId !== voiceId || entry.semanticEpoch !== epoch || entry.released || !expression || Object.keys(expression).some(id => !['pressure01', 'pan01'].includes(id)) || !finite(expression.pressure01 ?? entry.pressure, 0, 1) || !finite(expression.pan01 ?? entry.expressionPan, -1, 1) || !natural(targetFrame) || targetFrame < frameNow()) return rejected('unsupported-expression-or-voice', voiceId);
    try { const pressure = expression.pressure01 ?? entry.pressure, pan = expression.pan01 ?? entry.expressionPan, result = source.setOutputPerformance({ gain01: entry.peak * pressure, pan01: Math.max(-1, Math.min(1, patch.parameters.pan01 + patch.definition.mix.pan01 + pan)), outputFrame: targetFrame }); entry.pressure = pressure; entry.expressionPan = pan; return result; } catch (error) { return rejected(error.message, voiceId); }
  };
  const renewExecutionLease = (generation, epoch, validUntilFrame) => {
    if (!available() || !natural(generation) || typeof epoch !== 'string' || !natural(validUntilFrame) || validUntilFrame <= frameNow() || validUntilFrame - frameNow() > context.sampleRate * 120 || canceled.has(key(generation, epoch))) return rejected('execution-lease-unavailable');
    for (const [identity, until] of leases) if (until <= frameNow()) leases.delete(identity); const identity = key(generation, epoch); if (leases.has(identity) && validUntilFrame <= leases.get(identity)) return rejected('stale-execution-lease'); if (!leases.has(identity) && leases.size >= 64) return rejected('execution-lease-capacity'); leases.set(identity, validUntilFrame); return Object.freeze({ status: 'accepted', stage: 'owned-host-lease', validUntilFrame });
  };
  const cancelGenerationWithReceipt = (generation, epoch = 'live') => { const identity = key(generation, epoch); if (!natural(generation) || typeof epoch !== 'string' || !epoch || canceled.size >= 1024 && !canceled.has(identity)) return rejected('cancellation-identity-capacity'); canceled.add(identity); leases.delete(identity);
    const entry = voice; if (!entry || entry.semanticGeneration !== generation || entry.semanticEpoch !== epoch) return Object.freeze({ status: 'accepted', count: 0 }); const result = end(entry.voiceId, { seconds: 0.005, force: true }, frameNow(), epoch);
    return Object.freeze({ ...result, count: result.status === 'accepted' ? 1 : 0, retirement: createProcgenRetirementScope().retire([{ name: 'owned-warp-voice', run: () => entry.completion }]) }); };
  return createInstrumentExecutionLifecycle({ family: 'buffered-warp-instrument', runtime, capabilities, prepare, begin, update, end, renewExecutionLease, cancelGenerationWithReceipt,
    updateLaneMix: (voiceId, value, frame, epoch = 'live', laneId = null) => { const entry = voice; return entry?.voiceId === voiceId && entry.semanticEpoch === epoch ? entry.laneMix.update(value, frame, laneId ?? entry.audioLaneId) : rejected('voice-not-active', voiceId); },
    setRendererPublication: (gain01, frame) => { if (!publication || !ready) throw fail('Prepare a current streaming renderer before publication.'); return publication.schedule(gain01, frame); },
    sourceCaptureStatus: () => Object.freeze({ quiescent: !voice && !preparation && !rearming, capability: 'deterministicPreroll', exactHeapSnapshot: false }), ownsSourceVoice: value => value === voice,
    observeCommandOutcomes(listener) { if (disposed || typeof listener !== 'function' || observers.size >= 8) throw fail('Streaming command observation is unavailable.'); observers.add(listener); return () => { observers.delete(listener); }; },
    renderDiagnostics: () => Object.freeze({ engineId: runtime.engineId, readiness: disposed ? 'disposed' : fault || !ready ? fault || 'runtime-unprepared' : rearming ? 'source-rearming' : 'ready', activeVoices: voice ? 1 : 0, preparedVoices: ready ? 1 : 0, preparationLeadFrames: source?.preparationLeadFrames || null, output: source?.state() || null, qualification: 'experimental-streaming-source;final-device-and-PCM-evidence-pending' }),
    onOwnerStop: stop, dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; return retirement.retire([{ name: 'streaming-producer', run: stop }, { name: 'immutable-core-cache', run: async () => { const receipt = stop(); await receipt.completion; if (receipt.outcome !== 'complete') throw fail('The streaming producer remains owned.'); await retire(coreMaterial, 'dispose'); observers.clear(); leases.clear(); canceled.clear(); } }]); }
  }, { getContext: () => preview.getAudioContext(), getGeneration: () => preview._sessions.get(owner)?.generation ?? preview._generation,
    isSettled: epoch => !preparation && (!voice || voice.semanticEpoch !== epoch) && (!producerRetirement || producerRetirement.outcome === 'complete'),
    isVoiceSettled: (voiceId, epoch) => !voice || voice.voiceId !== voiceId || voice.semanticEpoch !== epoch,
    forget: (epoch, generation) => { leases.delete(key(generation, epoch)); canceled.delete(key(generation, epoch)); } });
}
