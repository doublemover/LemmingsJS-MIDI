import { Lemmings } from './LemmingsNamespace.js';

class Logger {
  constructor(moduleName) {
    this._moduleName = moduleName;
  }

  _enabled() {
    return typeof lemmings !== 'undefined' &&
            lemmings.game && lemmings.game.showDebug === true;
  }

  /** log an info message */
  info(msg) {
    if (this._enabled()) {
      console.info(`${this._moduleName}\t${msg}`);
    }
  }

  /** log a warning */
  warn(msg) {
    if (this._enabled()) {
      console.warn(`${this._moduleName}\t${msg}`);
    }
  }

  /** log an error */
  error(msg, exception) {
    if (this._enabled()) {
      console.error(`${this._moduleName}\t${msg}`);
      if (exception) {
        console.error(`${this._moduleName}\t${exception.message}`);
      }
    }
  }

  // backwards compatibility
  log(msg, exception) {
    this.error(msg, exception);
  }

  /** write a debug message. If [msg] is not a String it is displayed: as {prop:value} */
  debug(msg) {
    if (!this._enabled()) return;
    if (typeof msg === 'string') {
      console.log(`${this._moduleName}\t${msg}`);
    } else {
      console.dir(msg);
    }
  }
}

class BaseLogger {
  constructor(name) {
    const Handler = Lemmings.LogHandler || Lemmings.Logger;
    this.log = new Handler(name || this.constructor.name);
  }

  /**
     * Start a performance measurement and return a function that records the
     * measure when invoked.
     * @param {string} name
     * @param {object} devtools
     * @returns {Function}
     */
  startMeasure(name, devtools = {}) {
    if (!(typeof lemmings !== 'undefined' &&
              lemmings.perfMetrics === true &&
              lemmings.debug === true) ||
            typeof performance === 'undefined' ||
            typeof performance.now !== 'function' ||
            typeof performance.measure !== 'function') {
      return () => {};
    }
    const start = performance.now();
    return () => {
      try {
        performance.measure(name, {
          start,
          detail: { devtools }
        });
      } catch {
        /* ignored */
      }
    };
  }
}

function withPerformance(name, devtools = {}, fn) {
  return function(...args) {
    if (!(typeof lemmings !== 'undefined' &&
              lemmings.perfMetrics === true &&
              lemmings.debug === true) ||
            typeof performance === 'undefined' ||
            typeof performance.now !== 'function' ||
            typeof performance.measure !== 'function') {
      return fn.apply(this, args);
    }
    const start = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      try {
        performance.measure(name, {
          start,
          detail: { devtools }
        });
      } catch {
        /* ignored */
      }
    }
  };
}

Lemmings.Logger = Logger;
Lemmings.BaseLogger = BaseLogger;
Lemmings.withPerformance = withPerformance;
// Backwards compatibility
Lemmings.LogHandler = Logger;

export { Logger, BaseLogger, withPerformance };
