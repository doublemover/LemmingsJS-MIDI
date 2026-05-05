import { expect } from 'chai';
import { installE2EHarness } from '../js/app/e2eHarness.js';

const preserveGlobal = (name) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, name);
  const value = globalThis[name];
  return () => {
    if (had) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value
      });
    } else {
      delete globalThis[name];
    }
  };
};

describe('e2e harness diagnostics', function () {
  it('returns deterministic diagnostics from getState/getDiagnostics', async function () {
    const restoreWindow = preserveGlobal('window');
    const restoreDocument = preserveGlobal('document');
    const restoreNavigator = preserveGlobal('navigator');
    const restoreCaches = preserveGlobal('caches');
    const restoreE2E = preserveGlobal('__E2E__');
    try {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: {
          location: {
            search: '?e2e=1',
            protocol: 'https:',
            hostname: 'example.com',
            pathname: '/index.html'
          }
        }
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: {
          getElementById() {
            return null;
          }
        }
      });
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: {
          serviceWorker: {
            controller: { scriptURL: 'sw.js' }
          }
        }
      });
      Object.defineProperty(globalThis, 'caches', {
        configurable: true,
        writable: true,
        value: {
          async keys() {
            return ['z-cache', 'a-cache'];
          }
        }
      });

      const view = {
        getRuntimeDiagnostics() {
          return {
            profile: 'perf',
            rolloutFlags: {
              historyCodec: false,
              renderPresentPath: true
            },
            capabilities: {
              webMidi: { supported: false, enabled: false, fallbackPath: 'audio_only' },
              renderPaths: {
                presentPathSupported: false,
                offscreenPresentSupported: false,
                workerOffscreenSupported: false,
                deterministicFallback: 'canvas2d_main_thread'
              }
            },
            featureFlags: {
              debug: true,
              midiEnabled: true
            },
            caches: {
              fileProvider: {
                memoryEntries: 3,
                localStorageBytes: 10,
                indexedDbBytes: 11
              },
              midiOverrideKeys: ['beta', 'alpha']
            }
          };
        }
      };

      const api = installE2EHarness({ view });
      const state = api.getState();
      expect(state.diagnostics).to.not.equal(null);
      expect(state.diagnostics.profile).to.equal('perf');
      expect(state.diagnostics.rolloutFlags.historyCodec).to.equal(false);
      expect(state.diagnostics.capabilities.webMidi.supported).to.equal(false);
      expect(state.diagnostics.caches.midiOverrideKeys).to.deep.equal(['alpha', 'beta']);
      expect(state.diagnostics.caches.cacheStorageKeys).to.equal(null);
      expect(state.diagnostics.serviceWorker.controlled).to.equal(true);

      const diagnostics = await api.getDiagnostics();
      expect(diagnostics.caches.cacheStorageKeys).to.deep.equal(['a-cache', 'z-cache']);
      expect(diagnostics.location.hostname).to.equal('example.com');
      expect(diagnostics.featureFlags.debug).to.equal(true);
      expect(diagnostics.rolloutFlags.renderPresentPath).to.equal(true);
      expect(diagnostics.capabilities.renderPaths.deterministicFallback).to.equal('canvas2d_main_thread');
    } finally {
      restoreE2E();
      restoreCaches();
      restoreNavigator();
      restoreDocument();
      restoreWindow();
    }
  });
});
