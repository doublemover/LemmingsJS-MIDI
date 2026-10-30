import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { createOwnedResourceReservation } from '../resources/OwnedResourceReservation.js';

const PROTOCOL = 'lemmings-performance/v1', LOCK = 'lemmingsjs-midi:performance:v1:default';
const ROLES = new Set(['live', 'cue', 'capture']), STATUSES = new Set(['idle', 'requesting', 'owned', 'busy', 'uncoordinated', 'stopping', 'blocked', 'disposed']);
const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const failure = reason => Object.assign(new Error('Performance ownership: ' + reason), { code: reason });
const randomIdentity = () => {
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes); return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
};

export function createBrowserPerformanceLease({ locks = globalThis.navigator?.locks,
  BroadcastChannel = globalThis.window?.BroadcastChannel, window = globalThis.window, document = globalThis.document,
  clientId = randomIdentity(), onState = () => {}, resourceBudget = null, timeoutMs = 5000,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
  if (!id(clientId) || typeof onState !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Invalid performance lease configuration.');
  const reservation = createOwnedResourceReservation({ budget: resourceBudget, owner: 'browser-performance-' + clientId, category: 'audio', kind: 'cross-context-performance', bytes: 65536 });
  const sources = new Map(), peers = new Map(), listeners = [], tokens = new WeakMap(), observers = new Set([onState]);
  let status = 'idle', reason = null, epoch = 0, sequence = 0, held = false, heldEpoch = -1, uncoordinated = false, locksUnavailable = false, disposed = false, finalized = false, disposalWork = null, channel = null;
  let holdRelease = null, released = null, attempt = null, pendingTakeover = null, stopping = null, otherOwner = null, activeRequests = 0;
  const snapshot = () => Object.freeze({ protocol: PROTOCOL, applicationScope: LOCK, clientId, leaseEpoch: epoch,
    status: status === 'idle' && otherOwner ? 'busy' : status, reason: status === 'idle' && otherOwner ? 'another-tab-owns-performance' : reason,
    exclusive: held && !uncoordinated, coordination: uncoordinated ? 'uncoordinated' : locks?.request ? 'web-locks' : 'unavailable',
    heldResourceScopes: Object.freeze([...sources.values()].filter(source => source.active || source.unknown).map(source => source.scope)),
    roles: Object.freeze([...new Set([...sources.values()].filter(source => source.active).flatMap(source => source.roles))]),
    activeDocumentIdentities: Object.freeze([...new Set([...sources.values()].filter(source => source.active && source.documentIdentity).map(source => source.documentIdentity))]),
    otherOwner: otherOwner ? Object.freeze({ ...otherOwner, roles: Object.freeze([...otherOwner.roles]) }) : null, pendingRequests: activeRequests, disposed });
  const report = () => { const state = snapshot(); for (const observer of observers) try { observer(state); } catch { /* Views cannot grant output authority. */ } };
  const send = (type, extra = {}) => {
    if (!channel || sequence === Number.MAX_SAFE_INTEGER) return;
    const roles = [...new Set([...sources.values()].filter(source => source.active).flatMap(source => source.roles))];
    try { channel.postMessage(JSON.stringify({ protocol: PROTOCOL, type, sender: clientId, sequence: ++sequence, epoch, status, roles, ...extra })); } catch { /* Web Locks remain authoritative. */ }
  };
  const setState = (next, code = null) => { status = next; reason = code; report(); send('status'); };
  const advanceEpoch = () => { if (epoch === Number.MAX_SAFE_INTEGER) throw failure('epoch-exhausted'); return ++epoch; };
  const finalizeDisposed = () => {
    if (!disposed || finalized || held || attempt || stopping || [...sources.values()].some(source => source.active || source.unknown || source.pending)) return;
    try { reservation.release(); } catch { setState('blocked', 'metadata-retirement-unconfirmed'); return; }
    finalized = true; sources.clear(); peers.clear(); setState('disposed'); observers.clear();
  };
  const ready = () => held && !disposed && !stopping && !['blocked', 'stopping'].includes(status);
  const releaseIfIdle = async () => {
    if (!held || stopping || activeRequests || [...sources.values()].some(source => source.active || source.unknown || source.pending || source.retiring)) return false;
    held = false; const release = holdRelease, completion = released, releasedEpoch = epoch; holdRelease = null; released = null; release?.();
    try { await completion; } catch { if (epoch === releasedEpoch) setState('blocked', 'lock-release-unconfirmed'); return false; }
    if (!held && epoch === releasedEpoch) setState(disposed ? 'disposed' : 'idle'); finalizeDisposed(); return true;
  };
  const attemptClaim = () => {
    if (disposed || stopping || status === 'blocked') return Promise.resolve(false);
    if (held) return Promise.resolve(ready());
    if (attempt) return attempt.promise;
    const uncoordinatedClaim = () => { heldEpoch = advanceEpoch(); held = true; uncoordinated = true; released = null; setState('uncoordinated', 'web-locks-unavailable'); queueMicrotask(() => { void releaseIfIdle(); }); return true; };
    if (!locks?.request || locksUnavailable) return Promise.resolve(uncoordinatedClaim());
    let resolve; const promise = new Promise(done => { resolve = done; }), operation = { promise, resolve, epoch, canceled: false, timer: null };
    attempt = operation; setState('requesting');
    operation.timer = setTimer(() => { operation.canceled = true; resolve(false); setState('blocked', 'lock-request-unconfirmed'); }, timeoutMs);
    try {
      // ifAvailable cannot be combined with signal; cancel locally and retire late grants.
      const work = locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, lock => {
        clearTimer(operation.timer);
        if (!lock) { resolve(false); if (!disposed && !operation.canceled) { setState('busy', 'another-tab-owns-performance'); send('probe'); } return; }
        if (disposed || stopping || operation.canceled || operation.epoch !== epoch) { resolve(false); return; }
        heldEpoch = advanceEpoch(); held = true; uncoordinated = false; const holding = new Promise(done => { holdRelease = done; });
        setState('owned'); resolve(true); queueMicrotask(() => { void releaseIfIdle(); }); return holding;
      });
      released = Promise.resolve(work);
      released.then(() => {
        clearTimer(operation.timer); if (attempt === operation) attempt = null;
        if (!held && !disposed && !stopping && operation.canceled && reason === 'lock-request-unconfirmed') setState('idle');
        if (!held && !disposed && status === 'requesting') setState('idle');
        finalizeDisposed();
      }, () => {
        clearTimer(operation.timer); if (attempt === operation) attempt = null;
        if (!held && !disposed && !stopping && !operation.canceled) { locksUnavailable = true; resolve(uncoordinatedClaim()); }
        else { resolve(false); if (held && !disposed) { advanceEpoch(); setState('blocked', 'web-lock-failed'); void stopAll('web-lock-failed'); } finalizeDisposed(); }
      });
      // A granted callback stays pending for the actual held lifetime.
      promise.then(granted => { if (granted && attempt === operation) attempt = null; });
    } catch {
      clearTimer(operation.timer); attempt = null; locksUnavailable = true; resolve(!disposed && !stopping && !operation.canceled ? uncoordinatedClaim() : false); finalizeDisposed();
    }
    return promise;
  };
  const retireSources = (selected, stopReason, priorStop = null) => {
    for (const source of selected) { if (source.active || source.unknown) source.cleanupGeneration ??= source.generation; source.generation++; source.active = false; }
    return createProcgenRetirementScope({ deadlineMs: timeoutMs }).retire(selected.map(source => ({ name: source.scope, run: async () => {
      const receipt = await source.stop(stopReason, selected.length === 1 ? priorStop : null); if (receipt?.schema !== 'lemmings-retirement/v1' || typeof receipt.completion?.then !== 'function') throw failure('stop-frontier-unconfirmed');
      await receipt.completion; if (receipt.outcome !== 'complete') throw failure('stop-frontier-unconfirmed'); source.unknown = false;
    } })));
  };
  const stopAll = (stopReason = 'performer-stopped') => {
    if (stopping) return stopping;
    let resolve; const completion = new Promise(done => { resolve = done; }); stopping = completion;
    const selected = [...sources.values()]; for (const source of selected) { if (source.active || source.unknown) source.cleanupGeneration ??= source.generation; source.unknown = source.active || source.unknown; source.pendingController?.abort(); }
    pendingTakeover?.settle(false);
    advanceEpoch(); if (attempt) { attempt.canceled = true; attempt.resolve(false); } setState('stopping', stopReason);
    const receipt = retireSources(selected, stopReason);
    receipt.completion.then(async () => {
      let complete = receipt.outcome === 'complete';
      const retired = await Promise.allSettled(selected.map(source => source.retiring).filter(Boolean));
      if (retired.some(result => result.status !== 'fulfilled' || result.value !== true)) complete = false;
      await Promise.allSettled(selected.map(source => source.pending).filter(Boolean)); stopping = null;
      if (complete) { for (const source of selected) { source.unknown = false; source.cleanupGeneration = null; } await releaseIfIdle(); }
      else { for (const source of selected) source.unknown = true; setState('blocked', 'stop-frontier-unconfirmed'); }
      finalizeDisposed(); resolve(Object.freeze({ complete, receipt }));
    }); return completion;
  };
  const releaseSource = (source, priorStop = null) => {
    if (source.retiring) return source.retiring;
    if (!source.active && !source.unknown && !source.pending && (!priorStop || priorStop.schema === 'lemmings-retirement/v1' && priorStop.state === 'retired' && priorStop.outcome === 'complete')) return Promise.resolve(true);
    let resolve; const completion = new Promise(done => { resolve = done; }); source.retiring = completion;
    source.unknown = source.active || source.unknown;
    source.pendingController?.abort();
    const receipt = retireSources([source], 'source-stopped', priorStop);
    receipt.completion.then(async () => {
      source.retiring = null;
      if (receipt.outcome !== 'complete') { source.unknown = true; setState('blocked', 'stop-frontier-unconfirmed'); resolve(false); return; }
      source.unknown = false; if (!stopping) source.cleanupGeneration = null; await releaseIfIdle(); resolve(true);
    }); return completion;
  };
  const waitForClaim = (work, signal) => new Promise(resolve => {
    const abort = () => resolve(false); signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(resolve, () => resolve(false)).finally(() => signal?.removeEventListener('abort', abort)); if (signal?.aborted) abort();
  });
  const takeOver = async ({ signal } = {}) => {
    signal?.throwIfAborted(); if (disposed || stopping || pendingTakeover) return false;
    if (await waitForClaim(attemptClaim(), signal)) return true;
    if (signal?.aborted || status !== 'busy') return false;
    if (!channel) { setState('busy', 'handoff-channel-unavailable'); return false; }
    let finish; const promise = new Promise(resolve => { finish = resolve; }), requestId = randomIdentity();
    const pending = { requestId, finish, timer: null, abort: null }; pendingTakeover = pending;
    const settle = value => { if (pendingTakeover !== pending) return; pendingTakeover = null; clearTimer(pending.timer); signal?.removeEventListener('abort', pending.abort); finish(value); };
    pending.settle = settle; pending.abort = () => settle(false); signal?.addEventListener('abort', pending.abort, { once: true });
    pending.timer = setTimer(() => { setState('busy', 'old-owner-stop-unconfirmed'); settle(false); }, timeoutMs);
    send('takeover', { requestId }); const acknowledged = await promise; if (!acknowledged || signal?.aborted || disposed) return false;
    return waitForClaim(attemptClaim(), signal);
  };
  const receive = event => {
    if (typeof event.data !== 'string' || event.data.length > 2048) return;
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (!message || message.protocol !== PROTOCOL || !id(message.sender) || message.sender === clientId || !Number.isSafeInteger(message.sequence) || message.sequence < 1 ||
        !Number.isSafeInteger(message.epoch) || message.epoch < 0 || !STATUSES.has(message.status) || !['status', 'probe', 'takeover', 'stopped', 'refused'].includes(message.type) ||
        !Array.isArray(message.roles) || message.roles.length > 3 || message.roles.some(role => !ROLES.has(role)) || Object.keys(message).some(key => !['protocol', 'type', 'sender', 'sequence', 'epoch', 'status', 'roles', 'requestId', 'target'].includes(key))) return;
    if (['takeover', 'stopped', 'refused'].includes(message.type) && !id(message.requestId) || message.target != null && !id(message.target)) return;
    const previous = peers.get(message.sender); if (previous && (message.sequence <= previous.sequence || message.epoch < previous.epoch)) return;
    if (!peers.has(message.sender) && peers.size === 32) peers.delete(peers.keys().next().value); peers.set(message.sender, { sequence: message.sequence, epoch: message.epoch });
    if (message.type === 'probe') { send('status'); return; }
    if (message.type === 'status') { if (['owned', 'stopping', 'blocked'].includes(message.status)) otherOwner = { clientId: message.sender, epoch: message.epoch, status: message.status, roles: message.roles }; else if (otherOwner?.clientId === message.sender) otherOwner = null; report(); return; }
    if (message.type === 'takeover' && held) {
      if (disposed || status === 'blocked' || stopping) { send('refused', { target: message.sender, requestId: message.requestId }); return; }
      void stopAll('cooperative-takeover').then(result => send(result.complete ? 'stopped' : 'refused', { target: message.sender, requestId: message.requestId })); return;
    }
    if (message.target === clientId && pendingTakeover?.requestId === message.requestId) pendingTakeover.settle(message.type === 'stopped');
  };
  try { if (typeof BroadcastChannel === 'function') { channel = new BroadcastChannel(LOCK); channel.onmessage = receive; send('probe'); } } catch { channel = null; }
  const listen = (target, type, handler) => { target?.addEventListener?.(type, handler); listeners.push(() => target?.removeEventListener?.(type, handler)); };
  listen(window, 'pagehide', () => { void stopAll('page-suspended'); }); listen(document, 'freeze', () => { void stopAll('page-frozen'); });
  listen(window, 'pageshow', event => { if (event.persisted) void stopAll('bfcache-revalidation'); });
  return Object.freeze({ state: snapshot, takeOver, stop: stopAll,
    subscribe(observer) { if (disposed || typeof observer !== 'function' || observers.size === 64) throw failure('observer-capacity'); observers.add(observer); return () => observers.delete(observer); },
    register({ scope, role = 'live', stop } = {}) {
      if (disposed || !/^[a-z0-9-]{1,64}$/.test(scope || '') || !ROLES.has(role) || typeof stop !== 'function' || sources.has(scope) || sources.size === 32) throw failure('invalid-resource-registration');
      const source = { scope, roles: [role], stop, active: false, unknown: false, closed: false, documentIdentity: null, pending: null, pendingController: null, retiring: null, generation: 0, cleanupGeneration: null }; sources.set(scope, source);
      return Object.freeze({
        acquire({ signal, takeOver: transfer = false } = {}) {
          if (source.closed || signal?.aborted) return Promise.resolve(null); if (source.pending) return source.pending; if (disposed || source.retiring || source.unknown || stopping) return Promise.resolve(null);
          if (source.active && ready()) { const token = Object.freeze({ clientId, leaseEpoch: epoch, scope }); tokens.set(token, { source, generation: source.generation, epoch }); return Promise.resolve(token); }
          const controller = new AbortController(), cancel = () => controller.abort(signal.reason); signal?.addEventListener('abort', cancel, { once: true }); source.pendingController = controller;
          const generation = source.generation; activeRequests++; let resolve;
          const operation = new Promise(done => { resolve = done; }); source.pending = operation;
          void (async () => {
            try {
              const granted = await waitForClaim(transfer ? takeOver({ signal: controller.signal }) : attemptClaim(), controller.signal);
              if (!granted || source.closed || controller.signal.aborted || generation !== source.generation || !ready()) return null;
              source.active = true; source.cleanupGeneration = null; const token = Object.freeze({ clientId, leaseEpoch: epoch, scope }); tokens.set(token, { source, generation, epoch }); report(); send('status'); return token;
            } finally { signal?.removeEventListener('abort', cancel); activeRequests--; source.pending = null; source.pendingController = null; void releaseIfIdle(); finalizeDisposed(); }
          })().then(resolve, () => resolve(null)); return operation;
        },
        isCurrent(token) { const owned = tokens.get(token); return owned?.source === source && owned.generation === source.generation && owned.epoch === epoch && source.active && ready(); },
        canRelease(token) { const owned = tokens.get(token); return owned?.source === source && owned.epoch === heldEpoch && owned.generation === source.cleanupGeneration && held && (source.unknown || !!stopping); },
        setDocumentIdentity(value) { if (source.closed) return false; if (value != null && (typeof value !== 'string' || !value.length || value.length > 128)) throw failure('invalid-document-identity'); source.documentIdentity = value; report(); return true; },
        setRoles(roles) { if (source.closed) return false; if (!Array.isArray(roles) || roles.length > 3 || roles.some(role => !ROLES.has(role))) throw failure('invalid-resource-roles'); source.roles = [...new Set(roles)]; report(); send('status'); return true; },
        release: ({ receipt = null } = {}) => releaseSource(source, receipt),
        async dispose({ receipt = null } = {}) { source.closed = true; const complete = await releaseSource(source, receipt); if (complete) { sources.delete(scope); report(); } return complete; }
      });
    },
    dispose() {
      if (disposalWork) return disposalWork;
      let resolve; disposalWork = new Promise(done => { resolve = done; }); disposed = true; pendingTakeover?.settle(false);
      void stopAll('performance-owner-disposed').then(result => {
        for (const remove of listeners.splice(0)) remove(); channel?.close(); channel = null; finalizeDisposed(); resolve(Object.freeze({ ...result, complete: result.complete && finalized }));
      }); return disposalWork;
    }
  });
}

let shared = null;
export const getBrowserPerformanceLease = (options = {}) => {
  if (globalThis.window !== globalThis || !globalThis.document) return null;
  if (!shared) shared = createBrowserPerformanceLease(options); return shared;
};
