import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
const fail = message => Object.assign(new Error(message), { code: 'owned-source-transport' });
export function createOwnedSourceTransportObserver({ resources, owner, getProducer, getContext } = {}) {
  let entry = null, serial = 0;
  const settle = (pending, error, value) => { if (!pending) return; clearTimeout(pending.timer); error ? pending.reject(error) : pending.resolve(value); };
  const request = (type, data = {}) => new Promise((resolve, reject) => {
    const pending = { resolve, reject, timer: setTimeout(() => { if (entry) entry.failed ||= fail('The source transport capture fence did not acknowledge.'); reject(entry?.failed || fail('Capture owner retired.')); }, 5000) };
    if (type === 'source-transport-observe') entry.start = pending; else entry.stop = pending;
    try { entry.producer.port.postMessage({ type, captureId: entry.id, ...data }); } catch (error) { settle(pending, error); }
  });
  const close = () => {
    if (!entry) return null; const captured = entry;
    return captured.retirement.retire([{ name: 'source-command-capture-fence', run: async () => {
      await captured.ready; const fence = await request('source-transport-stop');
      if (captured.failed) throw captured.failed; captured.listener(fence); captured.lease.release(); if (entry === captured) entry = null;
    } }]);
  };
  return Object.freeze({
    async observe({ audioFrame, onPacket } = {}) {
      const producer = getProducer(), context = getContext();
      if (entry || !producer?.port || context?.state !== 'running' || !Number.isSafeInteger(audioFrame) || audioFrame < Math.ceil(context.currentTime * context.sampleRate) || typeof onPacket !== 'function' || !Number.isSafeInteger(serial + 1)) throw fail('Prepare one future-frame source capture in its current running producer.');
      const lease = resources.reserve({ kind: 'owned-source-command-capture', owner, estimateBytes: 4 * 1048576, consumerOwned: true });
      const captured = entry = { id: ++serial, producer, listener: onPacket, lease, next: 1, failed: null, start: null, stop: null, ready: null, retirement: createProcgenRetirementScope() };
      captured.ready = request('source-transport-observe', { audioFrame });
      try { const receipt = await captured.ready; return Object.freeze({ receipt, close, state: () => ({ active: entry === captured, failure: captured.failed?.message || null }) }); }
      catch (error) { captured.failed ||= error; lease.retainUnknown(error); error.retirement = close(); throw error; }
    },
    consume(data) {
      if (!String(data?.type || '').startsWith('source-transport-')) return false;
      if (!entry || data.captureId !== entry.id) return true;
      const captured = entry;
      if (data.type === 'source-transport-started') settle(captured.start, null, data);
      else if (data.type === 'source-transport-stopped') { if (data.sequence !== captured.next - 1) captured.failed ||= fail('The source command capture lost its terminal sequence.'); settle(captured.stop, null, data); }
      else if (data.type === 'source-transport-overflow') { captured.failed ||= fail('The bounded render-realm command capture exhausted its acknowledged credits.'); try { captured.listener(data); } catch {} }
      else if (data.type === 'source-transport-packet') {
        try {
          if (captured.failed || data.sequence !== captured.next++ || !Number.isSafeInteger(data.frame) || data.frame < 0) throw captured.failed || fail('The actual render-realm command sequence is incomplete.');
          if (captured.listener(data) === false) throw fail('The causal journal refused an actual source command packet.');
          captured.producer.port.postMessage({ type: 'source-transport-ack', captureId: captured.id, sequence: data.sequence });
        } catch (error) { captured.failed ||= error; try { captured.listener({ type: 'source-transport-overflow', captureId: captured.id, reason: error.message }); } catch {} }
      }
      return true;
    }, close, active: () => !!entry
  });
}
