// @ts-check
import { normalizeAudioRuntimeConfig } from './AudioRuntimeConfig.js';
/** @typedef {import('./AudioRuntimeContracts.js').AudioRuntimeTransitionResult} TransitionResult */
/** @param {unknown} error */
const errorCode = error => {
  let name; try { name = Reflect.get(Object(error), 'name'); } catch { /* Native errors can have inaccessible properties. */ }
  return ['NotAllowedError', 'NotFoundError', 'InvalidAccessError', 'AbortError', 'InvalidStateError', 'NotSupportedError'].includes(name) ? String(name) : 'AudioRuntimeError';
};
/** One native configuration owner. Cancellation revokes publication, not native ownership.
 * @param {import('./AudioRuntimeContracts.js').AudioRuntimeTransitionPorts} ports
 * @returns {import('./AudioRuntimeContracts.js').AudioRuntimeTransition}
 */
export function createAudioRuntimeTransition(ports) {
  /** @type {{ canceled: boolean; promise: Promise<TransitionResult> } | null} */
  let pending = null;
  /** @type {import('./AudioRuntimeContracts.js').AudioRuntimeTransitionPhase} */
  let phase = 'idle';
  /** @type {TransitionResult | null} */
  let last = null;
  let disposed = false;
  const notify = () => { try { ports.onChange?.(); } catch { /* Observers do not own native transitions. */ } };
  /** @param {TransitionResult['status']} status @param {string | null} [error] @returns {TransitionResult} */
  const result = (status, error = null) => Object.freeze({ status, errorCode: error, requiresEnable: status === 'configured' || status === 'rebuild-ready', acousticReceipt: false });
  const request = (input, choose = false) => {
    if (disposed || ports.isRetired()) return Promise.resolve(result('retired'));
    if (pending) return Promise.resolve(result('busy'));
    // Validate before permission, stopping output or touching a native adapter.
    const config = normalizeAudioRuntimeConfig(input), context = ports.getContext(), previous = ports.getConfig(), chooser = ports.chooseOutput;
    if (disposed || ports.isRetired()) return Promise.resolve(result('retired'));
    const routeMatches = sink => !context || !('sinkId' in context) || context.sinkId === sink;
    const rebuild = config.latencyProfile !== previous.latencyProfile || config.preferredSampleRate !== previous.preferredSampleRate;
    const changeSink = config.sinkPreference !== previous.sinkPreference || !routeMatches(config.sinkPreference);
    if (choose && (!ports.chooseOutput || context && typeof context.setSinkId !== 'function') || !choose && context && !rebuild && changeSink && typeof context.setSinkId !== 'function') return Promise.resolve(result('unsupported'));
    if (!choose && !rebuild && !changeSink) return Promise.resolve(result('unchanged'));
    /** @type {(value: TransitionResult) => void} */
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const operation = { canceled: false, promise }; pending = operation;
    const current = () => !disposed && !operation.canceled && !ports.isRetired() && ports.getContext() === context;
    /** @param {import('./AudioRuntimeContracts.js').AudioRuntimeTransitionPhase} value */
    const stage = value => { phase = value; notify(); };
    // Run directly so the browser's output chooser retains the calling gesture.
    const run = async () => {
      let next = config;
      if (choose) {
        stage('selecting'); if (!current()) return result('canceled');
        if (!chooser) return result('unsupported');
        const sink = await chooser();
        if (!current()) return result('canceled');
        next = normalizeAudioRuntimeConfig({ ...config, sinkPreference: sink });
        if (next.sinkPreference === previous.sinkPreference && !rebuild && routeMatches(next.sinkPreference)) return result('unchanged');
        if (context && !rebuild && typeof context.setSinkId !== 'function') return result('unsupported');
      }
      stage('stopping'); if (!current()) return result('canceled');
      if (!await ports.quiesce()) return result('failed', 'OutputRetirementUnconfirmed');
      if (!current()) return result('canceled');
      if (context && rebuild) {
        stage('closing'); if (!current()) return result('canceled');
        if (!await ports.retireContext(context)) return result('failed', 'ContextRetirementUnconfirmed');
        // Retirement deliberately removes the old context; no other replacement is allowed.
        if (disposed || operation.canceled || ports.isRetired() || ports.getContext() !== null) return result('canceled');
      } else if (context) {
        stage('switching'); if (!current()) return result('canceled');
        const select = context.setSinkId;
        if (!current()) return result('canceled');
        if (typeof select !== 'function') return result('unsupported');
        await Reflect.apply(select, context, [next.sinkPreference]);
        if (!current()) return result('canceled');
        if (context.sinkId !== next.sinkPreference) return result('failed', 'OutputSelectionUnconfirmed');
      }
      if (disposed || operation.canceled || ports.isRetired()) return result('canceled');
      ports.commit(next);
      return result(rebuild && context ? 'rebuild-ready' : 'configured');
    };
    const settle = value => { last = value; if (pending === operation) { pending = null; phase = 'idle'; } resolve(value); notify(); };
    run().then(settle, error => settle(result(disposed || operation.canceled || ports.isRetired() ? 'canceled' : 'failed', errorCode(error))));
    return promise;
  };
  return Object.freeze({ request, choose: () => disposed || ports.isRetired() ? Promise.resolve(result('retired')) : request(ports.getConfig(), true), isPending: () => pending !== null,
    state: () => Object.freeze({ phase, pending: pending !== null, last }),
    invalidate() { if (pending) pending.canceled = true; },
    dispose() { disposed = true; if (pending) { pending.canceled = true; return pending.promise.then(() => {}); } return Promise.resolve(); }
  });
}
