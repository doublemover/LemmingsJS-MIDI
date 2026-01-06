import { expect } from 'chai';
import { withConsoleStub } from './helpers/console.js';
import {
  Lemmings,
  setDependency,
  useGlobalLemmings,
  withGlobalLemmings,
  withMissingGlobalLemmings,
  withShowDebug
} from './helpers/lemmings.js';
import '../js/util/LogHandler.js';

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

const captureConsole = () => {
  const calls = { infos: [], warns: [], errors: [], logs: [] };
  const restore = withConsoleStub({
    info: msg => calls.infos.push(String(msg)),
    warn: msg => calls.warns.push(String(msg)),
    error: msg => calls.errors.push(String(msg)),
    log: msg => calls.logs.push(String(msg))
  });
  return {
    calls,
    restore
  };
};

const withDebugConsole = (fn) => withShowDebug(true, () => {
  const consoleCapture = captureConsole();
  try {
    return fn(consoleCapture);
  } finally {
    consoleCapture.restore();
  }
});

useGlobalLemmings({ game: { showDebug: false } });

describe('LogHandler', function() {
  let origHandler;
  before(function() {
    origHandler = Lemmings.LogHandler;
    setDependency('LogHandler', RecordingHandler);
  });
  after(function() {
    setDependency('LogHandler', origHandler);
  });

  it('uses custom handler for BaseLogger', function() {
    RecordingHandler.messages.length = 0;
    const d = new Dummy();
    expect(d.log).to.be.instanceOf(RecordingHandler);
    expect(RecordingHandler.messages).to.eql([Dummy.name]);
  });
});

describe('Logger output levels', function() {
  it('formats info, warning and error messages', function() {
    withDebugConsole(({ calls }) => {
      const logger = new Lemmings.Logger('Mod');
      logger.info('hello');
      logger.warn('caution');
      logger.error('boom', new Error('bad'));
      expect(calls.infos).to.eql(['Mod\thello']);
      expect(calls.warns).to.eql(['Mod\tcaution']);
      expect(calls.errors).to.eql(['Mod\tboom', 'Mod\tbad']);
    });
  });

  it('toggles debug logging based on environment', function() {
    withDebugConsole(({ calls }) => {
      const logger = new Lemmings.Logger('Dbg');
      withShowDebug(false, () => {
        logger.debug('off');
        expect(calls.logs).to.eql([]);
      });
      logger.debug('on');
      expect(calls.logs).to.eql(['Dbg\ton']);
    });
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
    withGlobalLemmings({ performanceAPI: true }, () => {
      const fn = (a, b) => a + b;
      const wrapped = Lemmings.withPerformance('sum', { t: 1 }, fn);
      const result = wrapped(2, 3);
      expect(result).to.equal(5);
      expect(performance.measureCalls.length).to.equal(1);
      expect(performance.measureCalls[0].name).to.equal('sum');

      performance.measureCalls.length = 0;
      withGlobalLemmings({ performanceAPI: false, perfMetrics: false }, () => {
        wrapped(1, 1);
        expect(performance.measureCalls.length).to.equal(0);
      });
    });
  });
});

describe('startMeasure and withPerformance error handling', function() {        
  let origPerf;
  beforeEach(function() {
    origPerf = globalThis.performance;
  });
  afterEach(function() {
    globalThis.performance = origPerf;
  });

  it('returns noop when metrics disabled', function() {
    withGlobalLemmings({ perfMetrics: false, debug: false }, () => {
      globalThis.performance = { now() { throw new Error('called'); }, measure() { throw new Error('called'); } };
      const dummy = new Dummy();
      const end = dummy.startMeasure('t');
      expect(() => end()).to.not.throw();
    });
  });

  it('records measures when performance metrics are enabled', function() {
    const calls = [];
    withGlobalLemmings({ perfMetrics: true }, () => {
      globalThis.performance = {
        now() { return 1; },
        measure(name, opts) { calls.push({ name, opts }); }
      };
      const dummy = new Dummy();
      const end = dummy.startMeasure('tick', { tag: 'x' });
      end();
      expect(calls.length).to.equal(1);
      expect(calls[0].name).to.equal('tick');
    });
  });

  it('swallows measure errors', function() {
    let count = 0;
    withGlobalLemmings({ perfMetrics: true, debug: true }, () => {
      globalThis.performance = { now() { return 0; }, measure() { count++; throw new Error('boom'); } };
      const fn = Lemmings.withPerformance('t', {}, x => x + 1);
      const result = fn(1);
      expect(result).to.equal(2);
      expect(count).to.equal(1);
    });
  });

  it('swallows startMeasure errors', function() {
    withGlobalLemmings({ perfMetrics: true, debug: true }, () => {
      globalThis.performance = { now() { return 0; }, measure() { throw new Error('boom'); } };
      const dummy = new Dummy();
      const end = dummy.startMeasure('oops');
      expect(() => end()).to.not.throw();
    });
  });

  it('returns noop when lemmings is undefined', function() {
    withMissingGlobalLemmings(() => {
      globalThis.performance = { now() { return 0; }, measure() { throw new Error('boom'); } };
      const dummy = new Dummy();
      const end = dummy.startMeasure('noop');
      expect(() => end()).to.not.throw();
      const wrapped = Lemmings.withPerformance('noop', {}, x => x + 1);
      expect(wrapped(1)).to.equal(2);
    });
  });
});
