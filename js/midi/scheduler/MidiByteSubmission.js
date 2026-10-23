const contexts = new WeakMap();

// WebMidi channel helpers may lower one call into several messages. Observe the
// instance byte boundary during that synchronous call, including accepted prefixes.
export function observeMidiByteSubmission(output, listener) {
  if (!output?.channels || typeof output.send !== 'function') return null;
  let context = contexts.get(output);
  if (!context) {
    const original = output.send;
    context = { original, listeners: [] };
    const wrapper = function(message, options) {
      const observe = context.listeners.at(-1), data = Array.from(message?.data || message || []);
      let result;
      try {
        result = original.call(this, message, options);
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
    try { output.send = wrapper; } catch { return null; }
    if (output.send !== wrapper) return null;
    contexts.set(output, context);
  }
  let observed = 0, rejected = false;
  const observe = event => { observed++; rejected ||= !event.accepted; listener(event); };
  context.listeners.push(observe);
  return {
    get observed() { return observed; },
    get rejected() { return rejected; },
    dispose() {
      const index = context.listeners.lastIndexOf(observe);
      if (index >= 0) context.listeners.splice(index, 1);
      if (!context.listeners.length) {
        if (output.send === context.wrapper) output.send = context.original;
        contexts.delete(output);
      }
    }
  };
}
