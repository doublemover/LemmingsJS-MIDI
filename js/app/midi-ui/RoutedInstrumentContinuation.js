import { cloneData, canonicalDataText } from '../../core/CanonicalData.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
const fail = message => { throw Object.assign(new Error(message), { name: 'AudioRestoreError', code: 'routed-source-continuation' }); };
const same = (a, b) => canonicalDataText(a, { maxBytes: 131072, maxNodes: 16384 }).text === canonicalDataText(b, { maxBytes: 131072, maxNodes: 16384 }).text;
const keyFor = (epoch, voiceId) => JSON.stringify([epoch, voiceId]);
let serial = 0;
export function createRoutedInstrumentContinuation({ children, assignments, executions, voices, switches, getContext, getBindings, executionFor, reserveMetadata, retireExecution, retireChild, collect, isDisposed, maxVoices, maxChildren, resourceBudget } = {}) {
  let pending = null;
  const capture = ({ audioFrame } = {}) => {
    const context = getContext();
    if (isDisposed() || pending || switches.size || context?.state !== 'running' || !Number.isSafeInteger(audioFrame) || audioFrame < 0 || [...voices.values()].some(voice => voice.prior?.length)) fail('Capture routing at a stable owned boundary after held/topology transitions settle.');
    const sources = [...children.values()].filter(child => typeof child.backend?.detachSourceState === 'function').map(child => {
      const reference = child.backend.sourceContentReference?.();
      if (!reference || typeof child.backend.captureExecutionBindings !== 'function') fail('Every routed source requires its exact patch and opaque execution ancestry.');
      return { sourceId: child.backend.sourceId, reference, instrumentKey: child.instrumentKey || child.key, lanes: [...assignments].filter(([, value]) => value === child).map(([lane]) => lane),
        bodyId: child.bodyId ?? null, macroIds: child.macroIds || [], releaseSeconds: child.releaseSeconds ?? null, oneShotTailSeconds: child.oneShotTailSeconds ?? null, realization: child.realization || null,
        executionBindings: child.backend.captureExecutionBindings() };
    });
    const sourceIds = new Map(sources.map(row => [row.sourceId, row]));
    if (sources.length > 16 || sources.some(row => typeof row.sourceId !== 'string' || !row.sourceId) || new Set(sources.map(row => row.sourceId)).size !== sources.length || [...voices.values()].some(voice => !sourceIds.has(voice.child.backend.sourceId))) fail('A native/unrepresented voice lies outside the complete owned routing cone.');
    const bindings = getBindings().filter(row => executions.has(row.epoch));
    if ([...executions.keys()].some(epoch => !bindings.some(row => row.epoch === epoch))) fail('Anonymous or retired router executions cannot be rebound as owned history.');
    const rows = [...voices.values()].map(voice => ({ sourceId: voice.child.backend.sourceId, epoch: voice.epoch, voiceId: voice.voiceId, laneId: voice.laneId, sourceLaneId: voice.sourceLaneId,
      intent: voice.intent, expression: voice.expression, mix: voice.mix, mixFault: voice.mixFault, startFrame: voice.startFrame, ...(voice.mixFrame == null ? {} : { mixFrame: voice.mixFrame }),
      ended: voice.ended, performanceIdentity: voice.performanceIdentity, performanceInput: voice.performanceInput, observations: [...voice.observations],
      articulation: { releaseSeconds: voice.articulation.releaseSeconds ?? null, oneShotTailSeconds: voice.articulation.oneShotTailSeconds ?? null } }));
    return cloneData({ schema: 'lemmings-routed-source-continuation/v1', audioFrame, sampleRate: context.sampleRate, sources, executions: bindings, voices: rows,
      leases: [...executions].map(([epoch, execution]) => ({ epoch, generation: execution.generation, until: execution.leaseUntil })) }, { maxBytes: 2 * 1048576, maxNodes: 131072 });
  };
  const stage = ({ state, sources, bindings } = {}) => {
    if (isDisposed() || pending || voices.size || executions.size || switches.size || state?.schema !== 'lemmings-routed-source-continuation/v1' || state.sampleRate !== getContext()?.sampleRate ||
        !Array.isArray(state.sources) || state.sources.length > 16 || !Array.isArray(state.voices) || state.voices.length > maxVoices || !Array.isArray(state.executions) || state.executions.length > 64 ||
        !Array.isArray(sources) || sources.length !== state.sources.length || new Set(sources.map(row => row?.sourceId)).size !== sources.length || !Array.isArray(bindings) || bindings.length !== state.executions.length) fail('Prepare a complete routing image in a fresh empty matching router.');
    const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'routed-continuation:' + (++serial), kind: 'routing-image-and-staged-voice-bindings', category: 'audio', bytes: 8 * 1048576 }), retirement = createProcgenRetirementScope();
    const entry = { state: null, sources: [], rows: [], roots: bindings.slice(), created: [], childPins: [], phase: 'validating', reservation, retirement }; pending = entry;
    const cancel = () => {
      if (entry.phase === 'complete') return false;
      if (retirement.getReceipt()) return retirement.getReceipt(); entry.phase = 'retiring';
      const roots = createProcgenRetirementScope();
      const receipt = retirement.retire([{ name: 'fresh-routing-executions', run: () => roots.retire(entry.roots.map((row, index) => ({ name: 'execution-' + index, run: () => { const result = retireExecution(row.execution); if (result?.status !== 'accepted') fail('A restored root execution did not acknowledge retirement.'); return result.retirement; } }))) },
        { name: 'continuation-renderers-and-image', run: async () => {
          await roots.getReceipt().completion; if (roots.getReceipt().outcome !== 'complete') fail('Restored source roots still own their renderers.');
          const rows = createProcgenRetirementScope().retire(entry.created.map(child => ({ name: child.key, run: () => retireChild(child) }))); await rows.completion;
          if (rows.outcome !== 'complete') throw Object.assign(new Error('Continuation source renderer retirement remains unresolved.'), { retirement: rows });
          for (const child of entry.childPins) child.pins--; entry.state = null; entry.sources.length = entry.rows.length = entry.roots.length = entry.childPins.length = entry.created.length = 0; reservation.release();
        } }]);
      receipt.completion.then(() => { if (receipt.outcome === 'complete' && pending === entry) { pending = null; collect(); } }); return receipt;
    };
    entry.cancel = cancel;
    try {
      entry.state = cloneData(state, { maxBytes: 2 * 1048576, maxNodes: 131072 });
      const rootMap = new Map();
      for (const old of entry.state.executions) { const binding = bindings.find(row => row.fromExecutionEpoch === old.epoch); if (!binding || rootMap.has(old.epoch) || binding.generation !== old.generation) fail('Each historical routed execution requires one fresh generation-matching opaque root.'); rootMap.set(old.epoch, binding); }
      const sourceMap = new Map();
      for (const old of entry.state.sources) {
        const fresh = sources.find(row => row.sourceId === old.sourceId), metadata = fresh?.metadata, reference = fresh?.backend?.sourceContentReference?.();
        if (!fresh || sourceMap.has(old.sourceId) || !same(reference, old.reference) || metadata?.audioFrame !== state.audioFrame || metadata.cut?.sampleRate !== state.sampleRate || metadata.cut.patchDefinitionHash !== old.reference.definitionHash || metadata.cut.engineArtifactHash !== old.reference.engineRequirement.artifactHash || typeof fresh.backend.restoreSourceState !== 'function') fail('A restored child differs from its exact source cut, patch, rate or artifact.');
        let child = [...children.values()].find(child => child.backend === fresh.backend);
        if (!child) {
          if (old.lanes.length || children.size >= maxChildren) fail('Prepare all assigned lanes before registering an unassigned historical tail source.');
          reserveMetadata({ renderers: 1 }); child = { key: '@continuation:' + old.sourceId + ':' + serial, instrumentKey: old.instrumentKey, backend: fresh.backend, assignedLanes: 0, pins: 0, retirement: null,
            releaseSeconds: old.releaseSeconds, oneShotTailSeconds: old.oneShotTailSeconds, bodyId: old.bodyId, macroIds: [...old.macroIds], realization: old.realization }; children.set(child.key, child); entry.created.push(child);
        }
        if (child.retirementScope || child.blocked || old.lanes.some(lane => assignments.get(lane) !== child) || !same({ instrumentKey: child.instrumentKey || child.key, bodyId: child.bodyId ?? null, macroIds: child.macroIds || [], releaseSeconds: child.releaseSeconds ?? null, oneShotTailSeconds: child.oneShotTailSeconds ?? null },
          { instrumentKey: old.instrumentKey, bodyId: old.bodyId, macroIds: old.macroIds, releaseSeconds: old.releaseSeconds, oneShotTailSeconds: old.oneShotTailSeconds })) fail('The incoming routing assignment or articulation differs from the captured source.');
        child.pins = (child.pins || 0) + 1; entry.childPins.push(child);
        const epochs = new Map(old.executionBindings.map(row => [row.epoch, row])), needed = new Set(metadata.host.voices.map(voice => voice.executionEpoch));
        for (const command of metadata.host.inFlight) { const pair = metadata.host.epochs.find(([, token]) => token === command.data[0]); if (!pair) fail('A future source command omitted its historical execution.'); needed.add(pair[0]); }
        const sourceBindings = [], epochMap = new Map();
        for (const epoch of needed) { const historical = epochs.get(epoch), root = historical && rootMap.get(historical.executionEpoch); if (!root || historical.generation !== root.generation) fail('A held voice/future command has no fresh routed root.');
          const execution = executionFor(child, root.epoch, root.generation); if (!execution) fail('Fresh child execution admission failed.'); sourceBindings.push({ fromExecutionEpoch: epoch, execution }); epochMap.set(epoch, root); }
        sourceMap.set(old.sourceId, { child, fresh, epochMap }); entry.sources.push(Object.freeze({ sourceId: old.sourceId, backend: fresh.backend, bindings: Object.freeze(sourceBindings) }));
      }
      const identities = new Set();
      for (const row of entry.state.voices) {
        const source = sourceMap.get(row.sourceId), root = rootMap.get(row.epoch), host = source?.fresh.metadata.host;
        const actual = host?.voices.find(voice => voice.voiceId === row.voiceId && source.epochMap.get(voice.executionEpoch) === root);
        if (!source || !root || !actual || actual.generation !== root.generation || actual.audioLaneId !== row.laneId || actual.intentId !== row.intent.intentId || actual.onsetId !== row.intent.onsetId || identities.has(keyFor(root.epoch, row.voiceId))) fail('The routing inventory differs from its actual restored source voices.');
        identities.add(keyFor(root.epoch, row.voiceId)); const execution = executionFor(source.child, root.epoch, root.generation); entry.rows.push({ row, child: source.child, root, execution });
      }
      if ([...sourceMap.values()].reduce((sum, source) => sum + source.fresh.metadata.host.voices.length, 0) !== entry.rows.length) fail('A restored source voice has no routing/terminal owner.');
      entry.phase = 'staged';
      return Object.freeze({ schema: 'lemmings-routed-restoration-plan/v1', sources: () => { if (!['staged', 'committed'].includes(entry.phase)) fail('The routing plan no longer owns its prepared source bindings.'); return entry.sources.slice(); },
        commit({ audioFrame } = {}) {
          if (pending !== entry || entry.phase !== 'staged' || !Number.isSafeInteger(audioFrame) || audioFrame < 0) fail('Commit routing once at the aggregate audio activation frontier.');
          reserveMetadata({ voices: entry.rows.length }); const shift = audioFrame - entry.state.audioFrame;
          for (const { row, child, root, execution } of entry.rows) voices.set(keyFor(root.epoch, row.voiceId), { ...row, child, execution, epoch: root.epoch, prior: [], observations: new Map(row.observations),
            startFrame: Math.max(audioFrame, row.startFrame + shift), ...(row.mixFrame == null ? {} : { mixFrame: Math.max(audioFrame, row.mixFrame + shift) }) });
          for (const lease of entry.state.leases) { const root = rootMap.get(lease.epoch), execution = root && executions.get(root.epoch); if (execution && lease.until != null) execution.leaseUntil = lease.until + shift; }
          entry.phase = 'committed'; return Object.freeze({ status: 'accepted', stage: 'routed-voice-ownership-staged', voices: entry.rows.length, audioFrame, outputRequested: false });
        },
        complete() { if (pending !== entry || entry.phase !== 'committed') fail('Complete routing only after aggregate source/rack activation.'); entry.phase = 'complete'; for (const child of entry.childPins) child.pins--; entry.state = null; entry.rows.length = entry.sources.length = entry.roots.length = entry.childPins.length = entry.created.length = 0; reservation.release(); pending = null; return true; }, cancel });
    } catch (error) { error.retirement = cancel(); throw error; }
  };
  return Object.freeze({ capture, stage, pending: () => !!pending, dispose: () => pending?.cancel() || null });
}
