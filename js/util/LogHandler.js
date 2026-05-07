import { getDependency, getAppContext } from '../core/dependencies.js';
import { recordPerformanceMeasure } from './performanceInstrumentation.js';

const NOOP = () => {};

class Logger {
  constructor(moduleName) {
    this._moduleName = moduleName;
  }

  _enabled() {
    const app = getAppContext();
    return !!app &&
            !!app.game &&
            app.game.showDebug === true;
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
    const Handler = getDependency('LogHandler', Logger);
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
    const app = getAppContext();
    const perfEnabled = !!app &&
            (app.performanceAPI === true || app.perfMetrics === true);
    if (!perfEnabled ||
            typeof performance === 'undefined' ||
            typeof performance.now !== 'function' ||
            typeof performance.measure !== 'function') {
      return NOOP;
    }
    const start = performance.now();
    return () => {
      recordPerformanceMeasure(name, {
        start,
        detail: { devtools }
      });
    };
  }
}

function withPerformance(name, devtools = {}, fn) {
  return function(...args) {
    const app = getAppContext();
    const perfEnabled = !!app &&
            (app.performanceAPI === true || app.perfMetrics === true);
    if (!perfEnabled ||
            typeof performance === 'undefined' ||
            typeof performance.now !== 'function' ||
            typeof performance.measure !== 'function') {
      return fn.apply(this, args);
    }
    const start = performance.now();
    try {
      return fn.apply(this, args);
    } finally {
      recordPerformanceMeasure(name, {
        start,
        detail: { devtools }
      });
    }
  };
}

const LogHandler = Logger;

export { Logger, BaseLogger, LogHandler, withPerformance };
