import { createBrowserPerformanceLease } from '../../js/app/midi-ui/BrowserPerformanceLease.js';
import { createProcgenRetirementScope } from '../../js/app/procgen/ProcgenRetirement.js';

export const turn = () => new Promise(resolve => setImmediate(resolve));
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const receipt = work => createProcgenRetirementScope({ deadlineMs: 100 }).retire(work ? [{ name: 'sink', run: work }] : []);
const target = () => { const listeners = new Map(); return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, emit(name, event = {}) { for (const fn of listeners.get(name) || []) fn(event); } }; };
export const environment = () => {
  const requests = [], messages = [], channels = new Set(); let owner = null, nextClient = 0;
  const locks = { request(name, options, callback) {
    requests.push({ name, options });
    return Promise.resolve().then(async () => {
      if (owner) return callback(null);
      const lock = {}; owner = lock;
      try { return await callback(lock); } finally { if (owner === lock) owner = null; }
    });
  } };
  class Channel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage(data) { messages.push(data); for (const channel of channels) if (channel !== this && channel.name === this.name) queueMicrotask(() => { if (channels.has(channel)) channel.onmessage?.({ data }); }); }
    close() { channels.delete(this); }
  }
  const make = (extra = {}) => { const window = target(), document = target(); const lease = createBrowserPerformanceLease({ locks, BroadcastChannel: Channel, window, document,
    clientId: (++nextClient).toString(16).padStart(32, '0'), timeoutMs: 100, ...extra }); return { lease, window, document }; };
  const source = (lease, stop = () => receipt(), scope = 'live') => lease.register({ scope, stop });
  return { make, source, locks, Channel, requests, messages, channels, owned: () => !!owner };
};
