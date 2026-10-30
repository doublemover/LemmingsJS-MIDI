const contexts = new WeakMap();
const nativeContexts = new WeakMap();
const rejectedSubmission = reason => Object.assign(new Error(reason), { midiSubmissionRejected: true });
const allowed = check => { try { return !check || check() === true; } catch { return false; } };
const nativeGuard = (output, required) => {
  const native = output?._midiOutput;
  if (!native) return null;
  let context = nativeContexts.get(native);
  if (!context && !required) return null;
  if (!context) {
    if (typeof native.send !== 'function') throw rejectedSubmission('Native MIDI submission boundary is unavailable.');
    const original = native.send, clear = native.clear; context = { original, clear, active: [], references: 0 };
    context.wrapper = function(data, timestamp) {
      if (!allowed(context.active.at(-1))) throw rejectedSubmission('Performance ownership no longer admits this MIDI packet.');
      return original.call(this, data, timestamp);
    };
    if (typeof clear === 'function') context.clearWrapper = function() {
      if (!allowed(context.active.at(-1))) throw rejectedSubmission('Performance ownership no longer admits native MIDI queue cleanup.');
      return clear.call(this);
    };
    try {
      native.send = context.wrapper;
      if (context.clearWrapper) native.clear = context.clearWrapper;
      if (native.send !== context.wrapper || context.clearWrapper && native.clear !== context.clearWrapper) throw rejectedSubmission('Native MIDI boundary cannot be guarded.');
    } catch {
      try { if (native.send === context.wrapper) native.send = original; if (context.clearWrapper && native.clear === context.clearWrapper) native.clear = clear; } catch {}
      throw rejectedSubmission('Native MIDI boundary cannot be guarded.');
    }
    nativeContexts.set(native, context);
  }
  context.references++;
  return { context, release() {
    if (--context.references) return;
    if (native.send === context.wrapper) native.send = context.original;
    if (context.clearWrapper && native.clear === context.clearWrapper) native.clear = context.clear;
    nativeContexts.delete(native);
  } };
};
export function withMidiSubmissionGuard(output, canSubmit, action) {
  if (!canSubmit) return action();
  const guarded = nativeGuard(output, true), native = guarded?.context;
  try {
    if (!allowed(canSubmit)) return false;
    if (native?.active.length >= 64) throw rejectedSubmission('MIDI submission nesting exceeds its bound.');
    native?.active.push(canSubmit);
    try { return action(); } finally { native?.active.pop(); }
  } finally { guarded?.release(); }
}

// WebMidi channel helpers may lower one call into several messages. Observe the
// instance byte boundary during that synchronous call, including accepted prefixes.
export function observeMidiByteSubmission(output, listener, canSubmit = null) {
  if (!output?.channels || typeof output.send !== 'function') return null;
  const guarded = nativeGuard(output, !!canSubmit);
  let context = contexts.get(output);
  if (!context) {
    const original = output.send;
    context = { original, listeners: [] };
    const wrapper = function(message, options) {
      const observe = context.listeners.at(-1), data = Array.from(message?.data || message || []);
      let result;
      try {
        if (!allowed(observe?.canSubmit)) throw rejectedSubmission('Performance ownership no longer admits this MIDI packet.');
        const native = observe?.native;
        if (native?.active.length >= 64) throw rejectedSubmission('MIDI submission nesting exceeds its bound.');
        native?.active.push(observe.canSubmit);
        try { result = original.call(this, message, options); } finally { native?.active.pop(); }
      } catch (error) {
        observe?.({ data, options, accepted: false, reason: error?.message || String(error) });
        throw error;
      }
      observe?.({ data, options, accepted: result !== false });
      if (result === false) {
        const error = new Error('MIDI byte submission rejected'); error.midiSubmissionRejected = true; throw error;
      }
      return result;
    };
    context.wrapper = wrapper;
    try { output.send = wrapper; } catch { guarded?.release(); return null; }
    if (output.send !== wrapper) { guarded?.release(); return null; }
    contexts.set(output, context);
  }
  if (context.listeners.length >= 64) { guarded?.release(); throw rejectedSubmission('MIDI observation nesting exceeds its bound.'); }
  let observed = 0, rejected = false, disposed = false;
  const observe = event => { observed++; rejected ||= !event.accepted; listener(event); };
  observe.canSubmit = canSubmit; observe.native = guarded?.context;
  context.listeners.push(observe);
  return {
    get observed() { return observed; },
    get rejected() { return rejected; },
    dispose() {
      if (disposed) return; disposed = true;
      const index = context.listeners.lastIndexOf(observe);
      if (index >= 0) context.listeners.splice(index, 1);
      if (!context.listeners.length) {
        if (output.send === context.wrapper) output.send = context.original;
        contexts.delete(output);
      }
      guarded?.release();
    }
  };
}
