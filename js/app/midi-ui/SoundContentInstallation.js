import { SOUND_CONTENT_CONTROL_FIXTURE as fixture } from '../../midi/content/SoundContentControlFixture.js';
import { freezeData, hashData } from '../../core/CanonicalData.js';
import { createInstrumentPatchRegistry } from '../../midi/content/InstrumentPatchV2.js';
import { planSoundContentSelection } from '../../midi/content/SoundContentPack.js';
import { borrowSoundContentStage } from './SoundContentReader.js';
import { getNativeInstrumentCatalog } from './NativeInstrumentSchema.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

const failure = (code, message, cause) => Object.assign(new Error(message), { name: 'SoundContentError', code, cause });
const completedAuditions = new WeakMap();

const interruptible = (work, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason || failure('cancelled', 'Sound audition canceled.'));
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)); if (signal.aborted) abort();
});
const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  const finish = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
  const abort = () => finish(signal.reason || failure('cancelled', 'Sound audition canceled.'));
  const timer = setTimeout(() => finish(), milliseconds); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
});

export function inspectSoundContentAudition(receipt, { contentHash, patchIdentity } = {}) {
  const owned = completedAuditions.get(receipt);
  return owned && owned.contentHash === contentHash && owned.patchIdentity === patchIdentity ? owned : null;
}

export function createSoundContentInstallation({ audio, registry, getCatalog = getNativeInstrumentCatalog, timeoutMs = 30000, onReveal } = {}) {
  if (!audio?.createSession || !audio?.getAudioContext || !registry?.commitStage || typeof getCatalog !== 'function' ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new TypeError('Invalid isolated sound installation owner.');
  let active = null, disposed = false, ordinal = 0;
  const retirement = createProcgenRetirementScope();
  const stageReceipts = new WeakMap(), installed = new WeakMap(), unknown = new Set();
  const audition = (stage, patchIdentity, { signal: externalSignal } = {}) => {
    externalSignal?.throwIfAborted();
    if (disposed || active || unknown.size) return Promise.reject(failure('audition-busy', 'Sound audition is unavailable or has unresolved retirement.'));
    let lease;
    try { lease = borrowSoundContentStage(stage); } catch (error) { return Promise.reject(error); }
    const patch = lease.prepared.patches.find(entry => entry.identity === patchIdentity);
    if (!patch || patch.state !== 'definition-admitted' || !['native-oscillator', 'native-fm', 'native-modal', 'worklet-sine', 'worklet-pluck'].includes(patch.definition.engineId) ||
        patch.definition.sampleRefs.length || patch.definition.modulations.length || patch.definition.engineId === 'worklet-sine' && (patch.definition.macros.length || patch.definition.causalBindings.length || patch.definition.variation)) {
      lease.release(); return Promise.reject(failure('audition-requirements-unmet', 'This instrument needs an available renderer and a realized gesture/material adapter.'));
    }
    const plan = planSoundContentSelection(lease.prepared, [patchIdentity], { availableHashes: lease.metadata.assetHashes });
    if (plan.missingReferences.length || plan.missingAssetBytes.length) { lease.release(); return Promise.reject(failure('audition-requirements-unmet', 'Sound material required for this audition is missing.')); }
    const operation = { controller: new AbortController(), lease, session: null, backend: null, execution: null, context: null, retirement: null, stopReceipt: null };
    active = operation; const number = ++ordinal, signal = operation.controller.signal;
    const stop = () => operation.stopReceipt ||= createProcgenRetirementScope().retire([
      { name: 'audition-session-stop', run: () => operation.session?.stop() }
    ]);
    const cancel = () => operation.controller.abort(externalSignal?.aborted ? externalSignal.reason : lease.signal.reason);
    externalSignal?.addEventListener('abort', cancel, { once: true }); lease.signal.addEventListener('abort', cancel, { once: true });
    signal.addEventListener('abort', stop, { once: true }); if (lease.signal.aborted || externalSignal?.aborted) cancel();
    const check = () => {
      signal.throwIfAborted(); if (disposed) throw failure('owner-retired', 'Sound installation owner retired.');
      if (operation.auditionLease && (!operation.auditionLease.isCurrent() || audio.getMonitorRouteState().revision !== operation.auditionLease.snapshot().routeRevision))
        throw failure('audition-source-retired', 'Prelisten source or route changed.');
    };
    let enabling;
    const deadline = setTimeout(() => operation.controller.abort(failure('deadline', 'Sound audition deadline exceeded.')), timeoutMs);
    operation.promise = (async () => {
      let error = null, receipt = null;
      try {
        if (audio.acquireAudition) operation.auditionLease = await audio.acquireAudition({
          source: { name: patchIdentity, kind: 'authored-control-fixture', revision: patchIdentity, sourceRef: lease.metadata.contentHash },
          routeRevision: audio.getMonitorRouteState().revision, signal, onReveal,
          onStop: reason => operation.controller.abort(failure('prelisten-stopped', reason))
        });
        check(); operation.session = audio.createSession('sound-content-audition', { workloadClass: 'cue' }); enabling = operation.session.enable();
        if (!await interruptible(enabling, signal)) throw failure('audio-unavailable', 'Local audio could not be enabled for audition.'); check();
        const catalog = await interruptible(getCatalog(), signal); check();
        const descriptor = catalog.descriptors.find(entry => entry.engineId === patch.definition.engineId && entry.engineVersion === patch.definition.engineVersion);
        if (catalog.state !== 'bound-application-engines' || !descriptor || descriptor.artifactHash !== patch.engineRequirement.artifactHash ||
            descriptor.parameterSchemaHash !== patch.engineRequirement.parameterSchemaHash) throw failure('engine-revision-mismatch', 'The executing renderer differs from the staged immutable requirement.');
        const definitions = createInstrumentPatchRegistry(); definitions.register(patch.definition, descriptor);
        const resolution = definitions.resolve(patch.definition.id, patch.definition.revision, { engineDescriptors: [descriptor], assetHashes: lease.metadata.assetHashes });
        operation.backend = ['worklet-sine', 'worklet-pluck'].includes(patch.definition.engineId) ? await operation.session.createWorkletInstrumentBackend({ engineId: patch.definition.engineId }) : operation.session.createInstrumentBackend({ gateMode: 'owned', engineId: patch.definition.engineId }); check();
        const prepared = await interruptible(operation.backend.prepare(resolution), signal); check();
        if (prepared.status !== 'ready') throw failure('preparation-rejected', 'Audition renderer rejected the effective patch: ' + prepared.reason);
        const context = operation.context = audio.getAudioContext(), rate = context?.sampleRate;
        if (context?.state !== 'running' || !Number.isFinite(rate) || rate < 8000 || rate > 384000) throw failure('audio-unavailable', 'Audition audio clock is unavailable.');
        const registered = operation.backend.registerExecution({ executionEpoch: 'sound-audition:' + number, generation: number });
        if (registered.status !== 'accepted') throw failure('audition-admission', 'Audition execution could not be registered.'); operation.execution = registered.execution;
        const requiresApplication = ['worklet-sine', 'worklet-pluck'].includes(patch.definition.engineId), applications = new Map(); let commandFailure = null;
        if (requiresApplication) {
          if (typeof operation.backend.observeCommandOutcomes !== 'function') throw failure('application-evidence-unavailable', 'This renderer cannot provide owned command-application receipts.');
          operation.stopObservation = operation.backend.observeCommandOutcomes(value => {
            if (['rejected', 'faulted', 'cancelled'].includes(value.status)) commandFailure = value;
            const command = applications.get(value.sequence);
            if (command && value.stage === 'render-kernel-applied' && value.status === 'accepted' && Number.isSafeInteger(value.appliedFrame))
              command.appliedFrame = value.appliedFrame;
          }, { execution: operation.execution });
        }
        const base = Math.ceil(context.currentTime * rate) + Math.ceil(0.15 * rate), releaseSeconds = patch.definition.parameters.releaseSeconds ?? 0.04;
        const endFrame = base + Math.ceil((1 + releaseSeconds + 0.15) * rate), outcomes = [];
        const leaseReceipt = operation.backend.renewExecutionLease(number, operation.execution, endFrame + Math.ceil(rate));
        if (leaseReceipt.status !== 'accepted') throw failure('audition-admission', 'Audition voice lifetime could not be admitted.');
        operation.auditionLease?.markReady();
        for (const event of fixture.events) {
          check(); const frame = base + Math.round(event.seconds * rate); let outcome;
          if (event.kind === 'begin') outcome = operation.backend.begin({ version: 1, kind: 'begin', generation: number, voiceId: 'control-fixture', onsetId: 'control-fixture', actorId: null, laneId: 0,
            intentId: 'sound-audition:' + number, sourceEventIds: [], pitch: { cents: event.pitchCents, referenceHz: 440 }, velocity01: event.velocity01, expression: event.expression }, frame, operation.execution);
          else if (event.kind === 'update') outcome = operation.backend.update('control-fixture', event.expression, frame, operation.execution);
          else outcome = operation.backend.end('control-fixture', { seconds: releaseSeconds }, frame, operation.execution);
          outcomes.push(outcome); if (outcome?.status !== 'accepted') throw failure('audition-command-rejected', 'Audition command was rejected: ' + outcome?.reason);
          if (requiresApplication) {
            if (!Number.isSafeInteger(outcome.sequence) || applications.has(outcome.sequence)) throw failure('application-evidence-unavailable', 'Renderer command identity is unavailable or repeated.');
            applications.set(outcome.sequence, { sequence: outcome.sequence, kind: event.kind, targetFrame: frame, appliedFrame: null });
          }
        }
        let markedPlaying = false;
        while (true) {
          check(); if (context !== audio.getAudioContext() || context.state !== 'running') throw failure('audio-interrupted', 'Audition audio clock was interrupted.');
          if (commandFailure) throw failure('audition-command-not-applied', 'The renderer rejected or canceled an audition command: ' + commandFailure.reason);
          const now = Math.floor(context.currentTime * rate), applied = !requiresApplication || [...applications.values()].every(value => value.appliedFrame != null);
          const onsetApplied = !requiresApplication || [...applications.values()].some(value => value.kind === 'begin' && value.appliedFrame != null);
          if (!markedPlaying && now >= base && onsetApplied) { operation.auditionLease?.markPlaying(); markedPlaying = true; }
          if (now >= endFrame && applied) break;
          if (now > endFrame + 2 * rate) throw failure('application-evidence-unavailable', 'Audition finished its clock range without complete command-application evidence.');
          await delay(30, signal);
        }
        check(); const fixtureHash = await hashData(fixture); check();
        receipt = freezeData({ schema: 'lemmings-isolated-sound-audition/v1', contentHash: lease.metadata.contentHash, patchIdentity,
          definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, fixtureHash, fixtureId: fixture.id,
          sampleRate: rate, targetFrame: base, endFrame, commandsAccepted: outcomes.length, source: fixture.source,
          commandsApplied: requiresApplication ? applications.size : null, applications: [...applications.values()],
          status: 'control-fixture-completed', evidenceClass: requiresApplication ? 'render-kernel-command-application-and-running-clock' : 'backend-api-command-admission-and-running-clock', physicalTakeEvidence: false,
          renderQualification: 'not-independently-qualified', acousticReceipt: false, monitorRoute: audio.getMonitorRouteState?.() || null,
          auditionLease: operation.auditionLease?.snapshot() || null });
      } catch (failure) { error = failure; operation.controller.abort(failure); }
      finally {
        clearTimeout(deadline); externalSignal?.removeEventListener('abort', cancel); lease.signal.removeEventListener('abort', cancel); signal.removeEventListener('abort', stop);
        operation.retirement = createProcgenRetirementScope().retire([
          { name: 'command-observation', run: () => operation.stopObservation?.() },
          { name: 'audition-stop', run: stop },
          { name: 'execution', run: () => { if (operation.execution) return operation.backend.retireExecution(operation.execution); } },
          { name: 'backend', run: () => operation.backend?.dispose() }, { name: 'audio-session', run: () => operation.session?.dispose() }
        ]);
        await operation.retirement.completion;
        let finalReceipt = operation.retirement;
        if (finalReceipt.outcome === 'complete') {
          finalReceipt = createProcgenRetirementScope().retire([{ name: 'source-lease', run: () => lease.release() }]);
        }
        if (finalReceipt.outcome !== 'complete') {
          unknown.add(operation); error = Object.assign(failure('retirement-unknown', 'Audition stopped with unresolved ownership.', error), { retirement: finalReceipt });
        }
        operation.auditionLease?.close(finalReceipt); if (active === operation) active = null;
      }
      if (error) throw error;
      const owned = Object.freeze({ contentHash: receipt.contentHash, patchIdentity, definitionHash: receipt.definitionHash, engineRequirement: receipt.engineRequirement });
      completedAuditions.set(receipt, owned); let entries = stageReceipts.get(stage); if (!entries) { entries = new Map(); stageReceipts.set(stage, entries); } entries.set(patchIdentity, receipt);
      return receipt;
    })();
    return operation.promise;
  };
  const install = async (stage, { referenceOnly = false, signal, isCurrent } = {}) => {
    if (disposed || unknown.size) throw failure('owner-retired', 'Sound installation is unavailable.');
    const receipts = stageReceipts.get(stage);
    if (!referenceOnly && !receipts?.size) throw failure('audition-required', 'Complete an isolated audition before installing playable content.');
    const receipt = await registry.commitStage(stage, { signal, isCurrent }); installed.set(stage, receipt); return receipt;
  };
  const applyCandidate = (stage, patchIdentity) => {
    if (disposed || unknown.size || !installed.has(stage)) throw failure('installation-required', 'Commit this staged pack before applying an instrument.');
    const receipt = stageReceipts.get(stage)?.get(patchIdentity), metadata = stage.metadata();
    if (!inspectSoundContentAudition(receipt, { contentHash: metadata.contentHash, patchIdentity })) throw failure('audition-required', 'Audition this exact patch revision before Apply.');
    const lease = borrowSoundContentStage(stage);
    try {
      const patch = lease.prepared.patches.find(entry => entry.identity === patchIdentity);
      return freezeData({ reference: { schema: 'lemmings-sound-reference/v1', packHash: metadata.contentHash, patchId: patch.definition.id,
        revision: patch.definition.revision, definitionHash: patch.definitionHash, engineRequirement: patch.engineRequirement, assetHashes: [...patch.dependencies].sort() },
      definition: patch.archivedDefinition, audition: receipt, laneApplication: 'not-requested' });
    } finally { lease.release(); }
  };
  return Object.freeze({ audition, install, applyCandidate, fixture, stop() { active?.controller.abort(failure('cancelled', 'Sound audition stopped.')); },
    async acknowledgeInstalled(stage, { signal } = {}) {
      if (disposed) throw failure('owner-retired', 'Sound installation owner retired.');
      const lease = borrowSoundContentStage(stage);
      try { const saved = await registry.loadPack(lease.metadata.contentHash, { signal, engineDescriptors: (await getCatalog()).descriptors });
        if (!saved) throw failure('installation-required', 'The exact staged sound pack is not installed.');
        try { if (saved.prepared.contentHash !== lease.metadata.contentHash) throw failure('content-mismatch', 'Installed content identity changed.');
          lease.prepared; const receipt = Object.freeze({ state: 'already-installed', contentHash: saved.prepared.contentHash }); installed.set(stage, receipt); return receipt;
        } finally { saved.release(); }
      } finally { lease.release(); }
    },
    getAudition: (stage, identity) => stageReceipts.get(stage)?.get(identity) || null,
    diagnostics: () => Object.freeze({ active: !!active, unknownRetirement: unknown.size, disposed }),
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt();
      disposed = true; const pending = active; pending?.controller.abort(failure('owner-retired', 'Sound installation owner retired.'));
      return retirement.retire([
        ...(pending ? [{ name: 'active-audition', run: () => pending.promise.then(() => pending.retirement, () => pending.retirement) }] : []),
        ...[...unknown].map((operation, index) => ({ name: 'unknown-audition-' + index, run: () => operation.retirement }))
      ]); }
  });
}
