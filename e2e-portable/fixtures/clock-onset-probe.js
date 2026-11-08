globalThis.registerProcessor('lemmings-clock-onset-probe', class extends globalThis.AudioWorkletProcessor {
  constructor(options) {
    super(); this.id = options.processorOptions.id; this.first = null; this.last = null; this.firstWhileBlocked = null; this.retired = false; this.ready = false;
    this.observation = new Int32Array(options.processorOptions.observation);
    this.port.onmessage = event => {
      if (event.data?.kind === 'retire') this.retired = true;
      else if (event.data?.kind === 'snapshot') this.port.postMessage({ schema: 'lemmings-native-onset-probe/v1', id: this.id,
        request: event.data.request, first: this.first, last: this.last, firstWhileBlocked: this.firstWhileBlocked, observedThrough: globalThis.currentFrame });
    };
  }
  process(inputs) {
    if (this.retired) return false;
    globalThis.Atomics.store(this.observation, 0, globalThis.currentFrame);
    if (!this.ready) { this.ready = true; this.port.postMessage({ kind: 'ready', id: this.id, frame: globalThis.currentFrame }); }
    const input = inputs[0]?.[0];
    if (input) for (let index = 0; index < input.length; index++) if (Math.abs(input[index]) > 1e-7) {
      const frame = globalThis.currentFrame + index; this.last = frame;
      if (this.first == null) {
        this.first = frame;
        if (globalThis.Atomics.load(this.observation, 1) === 1) { this.firstWhileBlocked = frame; globalThis.Atomics.add(this.observation, 2, 1); }
        this.port.postMessage({ schema: 'lemmings-native-onset-probe/v1', id: this.id, first: frame });
      }
    }
    return true;
  }
});
