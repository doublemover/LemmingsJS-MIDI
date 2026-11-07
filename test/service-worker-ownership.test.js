import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../service-worker.js', import.meta.url)), 'utf8');

const fixture = ({ installing = null } = {}) => {
  const listeners = new Map(), deleted = [], claims = [];
  const self = {
    registration: { scope: 'https://example.test/lemmings/', installing, waiting: null },
    location: { origin: 'https://example.test' },
    clients: { async claim() { claims.push(1); } },
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  const caches = {
    async keys() { return ['lemmings-core-%2Flemmings%2F-v0', 'lemmings-core-%2Flemmings%2F-v1',
      'lemmings-runtime-%2Flemmings%2F-v2', 'lemmings-core-%2Fother%2F-v0', 'lemmings-core-v0', 'other-app-recording-cache']; },
    async delete(key) { deleted.push(key); return true; }
  };
  vm.runInNewContext(source, { self, caches, URL, Request, fetch: () => Promise.reject(new Error('unexpected fetch')) });
  const activate = async () => {
    let task;
    listeners.get('activate')({ waitUntil(value) { task = value; } });
    await task;
  };
  return { activate, deleted, claims };
};

describe('service worker cache ownership', () => {
  it('uses exact staged script/style bytes and preserves offline route and revision identity', async () => {
    const listeners = new Map(), cacheData = new Map(); let offline = false;
    const scope = 'https://example.test/subdir/', key = request => typeof request === 'string' ? request : request.url;
    const caches = { async open(name) {
      if (!cacheData.has(name)) cacheData.set(name, new Map()); const entries = cacheData.get(name);
      return { async put(request, response) { entries.set(key(request), response.clone()); },
        async match(request) { return entries.get(key(request))?.clone(); } };
    } };
    const self = { registration: { scope }, location: { origin: 'https://example.test' }, skipWaiting() {},
      addEventListener(name, listener) { listeners.set(name, listener); } };
    vm.runInNewContext(source, { self, caches, URL, Request, fetch: async request => {
      if (offline) throw new Error('Offline'); return new globalThis.Response(new URL(key(request)).pathname);
    } });
    let installed; listeners.get('install')({ waitUntil(task) { installed = task; } }); await installed; offline = true;
    const get = async (name, destination = 'script') => {
      const request = new Request(new URL(name, scope)); Object.defineProperty(request, 'destination', { value: destination });
      if (destination === 'document') Object.defineProperty(request, 'mode', { value: 'navigate' });
      let response; listeners.get('fetch')({ request, respondWith(value) { response = value; } }); return (await response).text();
    };
    expect(await get('css/game.css', 'style')).to.equal('/subdir/css/game.css');
    expect(await get('js/app/boot.js')).to.equal('/subdir/js/app/boot.js');
    expect(await get('procgen.html', 'document')).to.equal('/subdir/procgen.html');
    expect(await get('editor.html?seed=4', 'document')).to.equal('/subdir/editor.html');
    for (const [name, destination] of [['js/app/boot.js?rev=other', 'script'], ['procgen.html?rev=other', 'document'], ['missing.html', 'document']]) {
      let error; try { await get(name, destination); } catch (failure) { error = failure; } expect(error.message).to.equal('Offline');
    }
    let status; listeners.get('message')({ data: { type: 'OFFLINE_STATUS' }, ports: [{ postMessage(value) { status = value; } }] });
    expect(status).to.include({ offlineReady: false, status: 'unqualified-shell' });
  });
  it('deletes only an older cache of its own scope while keeping newer and sibling caches', async () => {
    const worker = fixture();
    await worker.activate();
    expect(worker.deleted).to.deep.equal(['lemmings-core-%2Flemmings%2F-v0']);
    expect(worker.claims).to.have.length(1);
  });

  it('keeps all caches when a candidate worker is installing', async () => {
    const worker = fixture({ installing: { state: 'installing' } });
    await worker.activate();
    expect(worker.deleted).to.deep.equal([]);
  });
});
