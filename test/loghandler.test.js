import { expect } from 'chai';
import { Lemmings } from '../js/LemmingsNamespace.js';
import '../js/LogHandler.js';

/* Test custom LogHandler usage and withPerformance wrapper */

class RecordingHandler {
  constructor(name) {
    this.name = name;
    RecordingHandler.messages.push(name);
  }
  log() {}
  debug() {}
}
RecordingHandler.messages = [];

class Dummy extends Lemmings.BaseLogger {
  constructor() { super(); }
}

describe('LogHandler', function() {
  let origHandler;
  before(function() {
    globalThis.lemmings = { game: { showDebug: false } };
    origHandler = Lemmings.LogHandler;
    Lemmings.LogHandler = RecordingHandler;
  });
  after(function() {
    Lemmings.LogHandler = origHandler;
    delete globalThis.lemmings;
  });

  it('uses custom handler for BaseLogger', function() {
    RecordingHandler.messages.length = 0;
    const d = new Dummy();
    expect(d.log).to.be.instanceOf(RecordingHandler);
    expect(RecordingHandler.messages).to.eql([Dummy.name]);
  });
});

describe('withPerformance', function() {
  let origPerf;
  before(function() {
    origPerf = globalThis.performance;
    globalThis.performance = {
      nowCalls: 0,
      measureCalls: [],
      now() { this.nowCalls++; return 1; },
      measure(name, opts) { this.measureCalls.push({ name, opts }); }
    };
  });
  after(function() {
    globalThis.performance = origPerf;
  });

  it('measures only when flags enabled', function() {
    globalThis.lemmings = { perfMetrics: true, debug: true };
    const fn = (a, b) => a + b;
    const wrapped = Lemmings.withPerformance('sum', { t: 1 }, fn);
    const result = wrapped(2, 3);
    expect(result).to.equal(5);
    expect(performance.measureCalls.length).to.equal(1);
    expect(performance.measureCalls[0].name).to.equal('sum');

    performance.measureCalls.length = 0;
    globalThis.lemmings = { perfMetrics: true, debug: false };
    wrapped(1, 1);
    expect(performance.measureCalls.length).to.equal(0);
  });
});
