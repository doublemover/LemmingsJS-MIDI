import { createNativeMidiRoutes } from '../../midi/native/NativeMidiRoutes.js';
import { createResourceBudget } from '../resources/ResourceBudget.js';
import { attachProcgenNativeSimulationOutput } from './ProcgenSimulationOutputConsumer.js';
import { getActiveExecutionIdentity, compareActiveExecutionIdentity } from '../../runtime/ActiveExecutionIdentity.js';
import { cloneData } from '../../core/CanonicalData.js';
const PROTOCOL = 'lemmings-native-simulation-output/v1';
export function createProcgenNativeOutputWorkerEndpoint({ postMessage, close, timers = globalThis } = {}) {
  const budget = createResourceBudget({ limitBytes: 96 * 1048576 }), assignments = new Map();
  let owner = null, routes = null, output = null, lanes = [], scoreContext = null, pending = null, closing = null, timer = null, failure = null, sequence = 0, receipts = 0, stateSequence = 0, statePending = 0, stateDirty = false;
  const send = (type, fields = {}) => postMessage({ protocol: PROTOCOL, ownerId: owner, type, ...fields });
  const state = () => {
    const route = routes?.state(), direct = output?.state();
    return { phase: closing ? 'retiring' : failure ? 'failed' : output ? 'attached-paused-or-running-by-simulation-owner' : route?.state || 'uninitialized', failure: failure?.message || null,
      connectionEpoch: route?.connectionEpoch || 0, inventory: route?.inventory || null, grants: (route?.grants || []).map(row => ({ grant: row.grant, direction: row.direction, groupMask: row.groupMask, name: row.name || row.endpoint?.name || 'Native output' })),
      assignments: [...assignments].filter(([laneId, outputId]) => routes.resolve(outputId, laneId)).map(([laneId, outputId]) => ({ laneId, outputId })), clock: route?.clock || null, capabilities: routes?.client.capabilities || null,
      attached: !!output, batches: direct?.batches || 0, submittedIntents: direct?.submittedIntents || 0, receipts, sourceIdentity: output ? { worldId: direct.worldId, generation: direct.generation } : null,
      path: 'authoritative-simulation-worker-to-native-client-worker;no-ui-event-relay', profile: 'fresh-pairing-and-grants;baseline-dedicated-native-routes;quiescent-initial-voice-boundary', acousticReceipt: false };
  };
  const report = () => { stateDirty = true; if (timer !== null || closing || statePending) return; timer = timers.setTimeout(() => { timer = null; if (closing || statePending) return; statePending = ++stateSequence; stateDirty = false; send('state', { state: state(), sequence: statePending }); }, 250); };
  const fail = error => { failure ||= error instanceof Error ? error : new Error(String(error)); if (owner) send('state', { state: state() }); };
  const retire = () => {
    if (closing) return closing;
    if (timer !== null) timers.clearTimeout(timer); timer = null;
    const work = pending;
    closing = (async () => {
      await work?.catch(() => {}); const receipt = output?.dispose(); await receipt?.completion;
      if (receipt && receipt.outcome !== 'complete') throw new Error('Native execution retirement is unconfirmed.'); output = null;
      await routes?.dispose(); routes = null; lanes = []; assignments.clear(); send('retired', { outcome: 'complete' }); close();
    })().catch(error => { fail(error); send('retired', { outcome: 'unknown', error: error.message }); close(); }); return closing;
  };
  return Object.freeze({ fail, dispose: retire, receive(request) {
    if (request?.protocol !== PROTOCOL || typeof request.ownerId !== 'string' || !request.ownerId || request.ownerId.length > 128) return;
    if (owner && request.ownerId !== owner) return;
    if (request.type === 'state-ack') { if (owner && request.sequence === statePending) { statePending = 0; if (stateDirty) report(); } return; }
    if (request.type === 'dispose') { if (owner) void retire(); return; }
    if (closing || pending || !Number.isSafeInteger(request.requestId) || request.requestId <= sequence) { if (owner) send('response', { requestId: request.requestId, error: 'Finish the active native worker operation first.' }); return; }
    sequence = request.requestId;
    pending = (async () => {
      let value;
      if (!owner) {
        owner = request.ownerId;
        const execution = getActiveExecutionIdentity();
        if (request.type !== 'initialize' || execution.activeExecution !== 'bound' || !compareActiveExecutionIdentity(request.executionIdentity).matched) throw new Error('The native consumer realm requires the exact bound application generation.');
        routes = createNativeMidiRoutes({ resourceBudget: budget, canObserveInput: () => false, onTrace: report }); routes.subscribe(report); value = { executionIdentity: execution };
      } else if (output) throw new Error('Retire the attached simulation output before changing native grants or routes.');
      else if (request.type === 'connect') {
        if (routes.client.state !== 'disconnected') throw new Error('Start a fresh independently paired native connection.');
        routes.client.setUrl(request.options.url); value = await routes.connect({ pairingCode: request.options.pairingCode }); request.options.pairingCode = null;
      } else if (request.type === 'select-backend') value = await routes.client.selectBackend(request.api);
      else if (request.type === 'enumerate') value = await routes.enumerate();
      else if (request.type === 'open') {
        const endpoint = routes.state().inventory?.endpoints.find(row => row.endpointToken === request.options.endpointToken);
        if (endpoint?.direction !== 'output') throw new Error('Select an explicitly reviewed native output endpoint.');
        value = await routes.open({ ...request.options, permissions: 0 });
      } else if (request.type === 'assign') {
        const options = request.options;
        if (!['midi1', 'midi2'].includes(options.protocol) || !Array.isArray(options.laneIds) || options.laneIds.length < 1 || options.laneIds.length > 1024 || options.laneIds.some(id => typeof id !== 'string' || !id || id.length > 128)) throw new Error('Choose explicit native protocol and bounded dedicated lane addresses.');
        await routes.prepareOutput(options.grant); const rows = routes.allocateDedicated(options.laneIds, { grant: options.grant, protocol: options.protocol });
        for (const row of rows) if (row.status === 'assigned') assignments.set(row.laneId, row.route.outputId);
        value = rows.map(row => ({ laneId: row.laneId, status: row.status, reason: row.reason || null, outputId: row.route?.outputId || row.outputId || null, group: row.route?.group ?? null, channel: row.route?.channel ?? null, protocol: row.route?.protocol || null }));
      } else if (request.type === 'attach') {
        const options = request.options, manifest = options?.manifest;
        if (!request.port?.postMessage || typeof manifest?.ownerId !== 'string' || !Number.isSafeInteger(manifest.ownerEpoch) || !Number.isSafeInteger(manifest.documentRevision) || options.initialHeldVoices !== 0 || !Array.isArray(options.lanes) || options.lanes.length < 1 || options.lanes.length > 1024) throw new Error('Attach a paused exact worker identity with an explicit empty initial voice inventory.');
        lanes = cloneData(options.lanes, { maxBytes: 2 * 1048576, maxNodes: 131072 }); scoreContext = cloneData(options.scoreContext || {}, { maxBytes: 4096, maxNodes: 512 });
        if (lanes.some(lane => lane.mode === 'pattern' || lane.devicePatch || lane.deviceParameters?.length || lane.percussion || lane.orchestral || lane.piano || lane.organ || !routes.resolve(assignments.get(lane.id), lane.id))) throw new Error('The direct baseline worker requires complete dedicated physical lane routes; device profiles and saved device state need their own reviewed bindings.');
        lanes = lanes.map(lane => ({ ...lane, outputId: assignments.get(lane.id) }));
        output = attachProcgenNativeSimulationOutput({ port: request.port, manifest, resourceBudget: budget, routes, getLanes: () => lanes, now: () => performance.now(), getScoreContext: () => scoreContext,
          onReceipt: () => { receipts++; report(); }, onFailure: fail }); value = { status: 'attached', source: manifest, playback: 'explicit-simulation-resume-required', restoreCapability: 'quiescent-start;no-native-hidden-state-transplant' };
      } else throw new Error('Unsupported native consumer realm control.');
      send('response', { requestId: request.requestId, value, state: state() });
    })().catch(error => { if (owner) send('response', { requestId: request.requestId, error: String(error.message).slice(0, 512), state: state() }); else postMessage({ protocol: PROTOCOL, ownerId: request.ownerId, type: 'response', requestId: request.requestId, error: String(error.message).slice(0, 512) }); }).finally(() => { pending = null; });
  } });
}
