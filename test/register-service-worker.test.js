import { expect } from 'chai';
import {
  registerServiceWorker,
  shouldBypassServiceWorker
} from '../js/app/registerServiceWorker.js';

const flush = async () => {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
};

describe('registerServiceWorker', function () {
  it('bypasses service worker in perf/e2e/dev contexts', function () {
    const baseLocation = {
      protocol: 'https:',
      hostname: 'example.com',
      search: ''
    };
    expect(shouldBypassServiceWorker({ profile: 'perf', location: baseLocation })).to.equal(true);
    expect(shouldBypassServiceWorker({ profile: 'gameplay', e2e: true, location: baseLocation })).to.equal(true);
    expect(shouldBypassServiceWorker({
      profile: 'gameplay',
      location: { ...baseLocation, search: '?e2e=1' }
    })).to.equal(true);
    expect(shouldBypassServiceWorker({
      profile: 'gameplay',
      location: { protocol: 'https:', hostname: 'localhost', search: '' }
    })).to.equal(true);
    expect(shouldBypassServiceWorker({ profile: 'gameplay', location: baseLocation })).to.equal(false);
  });

  it('registers service worker with runtime revision when enabled', async function () {
    const calls = [];
    const registration = {
      waiting: null,
      update() {
        return Promise.resolve();
      },
      addEventListener() {}
    };
    const serviceWorker = {
      controller: null,
      register(url, options) {
        calls.push({ url, options });
        return Promise.resolve(registration);
      },
      addEventListener() {}
    };
    const windowRef = {
      location: {
        protocol: 'https:',
        hostname: 'example.com',
        search: ''
      },
      setInterval() {},
      addEventListener() {}
    };
    const documentRef = {
      readyState: 'complete',
      visibilityState: 'visible',
      addEventListener() {}
    };

    registerServiceWorker({
      profile: 'gameplay',
      revision: 'phase30b',
      window: windowRef,
      document: documentRef,
      location: windowRef.location,
      navigator: { serviceWorker }
    });
    await flush();

    expect(calls).to.have.lengthOf(1);
    expect(calls[0].url).to.equal('service-worker.js?rev=phase30b');
    expect(calls[0].options).to.deep.equal({ updateViaCache: 'none' });
  });

  it('unregisters active service workers and clears app caches when bypassing', async function () {
    const unregistered = [];
    const deletedCaches = [];
    const serviceWorker = {
      getRegistrations() {
        return Promise.resolve([
          { unregister() { unregistered.push('a'); return Promise.resolve(true); } },
          { unregister() { unregistered.push('b'); return Promise.resolve(true); } }
        ]);
      },
      register() {
        throw new Error('register should not be called while bypassing');
      }
    };
    const cacheStorage = {
      keys() {
        return Promise.resolve([
          'lemmings-core-v1',
          'lem-other-cache',
          'lemmings-runtime-v2'
        ]);
      },
      delete(key) {
        deletedCaches.push(key);
        return Promise.resolve(true);
      }
    };
    const windowRef = {
      location: {
        protocol: 'https:',
        hostname: 'example.com',
        search: ''
      },
      addEventListener() {}
    };
    const documentRef = {
      readyState: 'complete',
      addEventListener() {}
    };

    registerServiceWorker({
      profile: 'perf',
      window: windowRef,
      document: documentRef,
      location: windowRef.location,
      navigator: { serviceWorker },
      cacheStorage
    });
    await flush();

    expect(unregistered).to.deep.equal(['a', 'b']);
    expect(deletedCaches).to.deep.equal(['lemmings-core-v1', 'lemmings-runtime-v2']);
  });
});
