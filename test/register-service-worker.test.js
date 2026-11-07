import { expect } from 'chai';
import {
  disableActiveServiceWorker,
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
    expect(shouldBypassServiceWorker({ profile: 'classic', e2e: true, location: baseLocation })).to.equal(true);
    expect(shouldBypassServiceWorker({
      profile: 'classic',
      location: { ...baseLocation, search: '?e2e=1' }
    })).to.equal(true);
    expect(shouldBypassServiceWorker({
      profile: 'classic',
      location: { protocol: 'https:', hostname: 'localhost', search: '' }
    })).to.equal(true);
    expect(shouldBypassServiceWorker({
      profile: 'classic',
      location: { protocol: 'https:', hostname: 'localhost', search: '?sw=1' }
    })).to.equal(false);
    expect(shouldBypassServiceWorker({
      profile: 'classic',
      location: { protocol: 'https:', hostname: 'localhost', search: '?sw=1&noSw=1' }
    })).to.equal(true);
    expect(shouldBypassServiceWorker({ profile: 'classic', location: baseLocation })).to.equal(false);
    expect(shouldBypassServiceWorker({ profile: 'e2e', location: baseLocation })).to.equal(true);
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
      profile: 'classic',
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

  it('returns a disposable runtime that removes update listeners and intervals', async function () {
    const removed = [];
    const cleared = [];
    const registration = {
      waiting: null,
      update() {
        return Promise.resolve();
      },
      addEventListener() {},
      removeEventListener(type) {
        removed.push(`registration:${type}`);
      }
    };
    const serviceWorker = {
      controller: null,
      register() {
        return Promise.resolve(registration);
      },
      addEventListener() {},
      removeEventListener(type) {
        removed.push(`sw:${type}`);
      }
    };
    const windowRef = {
      location: {
        protocol: 'https:',
        hostname: 'example.com',
        search: ''
      },
      setInterval() {
        return 7;
      },
      clearInterval(id) {
        cleared.push(id);
      },
      addEventListener() {},
      removeEventListener(type) {
        removed.push(`window:${type}`);
      }
    };
    const documentRef = {
      readyState: 'complete',
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener(type) {
        removed.push(`document:${type}`);
      }
    };

    const runtime = registerServiceWorker({
      profile: 'classic',
      window: windowRef,
      document: documentRef,
      location: windowRef.location,
      navigator: { serviceWorker }
    });
    await flush();
    runtime.dispose();

    expect(cleared).to.deep.equal([7]);
    expect(removed).to.include.members([
      'registration:updatefound',
      'sw:controllerchange',
      'document:visibilitychange',
      'window:focus',
      'window:online'
    ]);
  });

  it('leaves registrations and caches intact when the profile only bypasses registration', async function () {
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

    expect(unregistered).to.deep.equal([]);
    expect(deletedCaches).to.deep.equal([]);
  });

  it('cleans only a verified app worker and cache namespace under a subdirectory', async function () {
    const removed = [], deleted = [];
    const owned = { scope: 'https://example.com/lemmings/', active: { scriptURL: 'https://example.com/lemmings/service-worker.js?rev=old' },
      async unregister() { removed.push('owned'); return true; } };
    const sibling = { scope: 'https://example.com/other/', active: { scriptURL: 'https://example.com/other/service-worker.js' },
      async unregister() { removed.push('sibling'); return true; } };
    const impostor = { scope: owned.scope, active: { scriptURL: 'https://example.com/lemmings/service-worker-other.js' },
      async unregister() { removed.push('impostor'); return true; } };
    const serviceWorker = { async getRegistrations() { return [owned, sibling, impostor]; } };
    const cacheStorage = { async keys() { return ['lemmings-core-%2Flemmings%2F-v1', 'lemmings-runtime-%2Flemmings%2F-v2',
      'lemmings-core-%2Fother%2F-v1', 'lemmings-core-v0', 'other-app-recording-cache']; },
    async delete(key) { deleted.push(key); return true; } };
    await disableActiveServiceWorker(serviceWorker, cacheStorage, { location: { href: 'https://example.com/lemmings/editor.html' } });
    expect(removed).to.deep.equal(['owned']);
    expect(deleted).to.deep.equal(['lemmings-core-%2Flemmings%2F-v1', 'lemmings-runtime-%2Flemmings%2F-v2']);
  });

  it('does not clean if the registration generation was disposed during discovery', async function () {
    const removed = [], deleted = [];
    let current = true;
    await disableActiveServiceWorker({ async getRegistrations() { current = false; return [{ scope: 'https://example.com/',
      active: { scriptURL: 'https://example.com/service-worker.js' }, async unregister() { removed.push(1); } }]; } },
    { async keys() { return ['lemmings-core-v0']; }, async delete(key) { deleted.push(key); } },
    { location: { href: 'https://example.com/index.html' }, shouldContinue: () => current });
    expect(removed).to.deep.equal([]); expect(deleted).to.deep.equal([]);
  });

  it('reports an owned active controller and reloads only after explicit owned removal', async function () {
    const calls = [];
    const registration = { scope: 'https://example.com/lemmings/', active: { scriptURL: 'https://example.com/lemmings/service-worker.js?rev=1' },
      async unregister() { calls.push('unregister'); return true; } };
    const serviceWorker = { controller: registration.active, async getRegistrations() { return [registration]; } };
    const location = { href: 'https://example.com/lemmings/procgen.html', protocol: 'https:', hostname: 'example.com', search: '',
      reload() { calls.push('reload'); } };
    const runtime = registerServiceWorker({ profile: 'perf', navigator: { serviceWorker },
      window: { location }, document: { readyState: 'complete' }, location });
    await flush();
    expect(runtime.getState()).to.deep.equal({ mode: 'bypassed-controlled', offlineInstallation: 'unqualified', controlledByOwnedWorker: true, controlled: true });
    expect(calls).to.deep.equal([]);
    expect(await runtime.removeOwnedAndReload()).to.equal(true);
    expect(calls).to.deep.equal(['unregister', 'reload']);
    expect(runtime.getState().mode).to.equal('reload-pending');
    runtime.dispose();
  });
});
