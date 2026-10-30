import { expect } from 'chai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBrowserGenerationService, readBrowserBuildResponse } from '../js/runtime/BrowserGenerationService.js';
import { browserGenerationFixture, memoryGenerationCaches } from './helpers/browserGenerationFixture.js';

describe('complete immutable browser installation', () => {
  let fixture, caches, unavailable, fetches, scope;
  beforeEach(async () => { fixture = await browserGenerationFixture(); caches = memoryGenerationCaches(); unavailable = null; fetches = []; scope = 'https://app.invalid/lemmings/'; });
  afterEach(async () => fixture.close());
  const network = async url => {
    const relative = new URL(url).pathname.slice(new URL(scope).pathname.length); fetches.push(relative);
    if (unavailable?.(relative)) return new globalThis.Response('missing', { status: 404 });
    try { return new globalThis.Response(await fs.readFile(path.join(fixture.root, 'dist/browser', relative))); }
    catch { return new globalThis.Response('missing', { status: 404 }); }
  };
  const owner = (build, extra = {}) => createBrowserGenerationService({ scopeUrl: scope, buildId: build.buildId, cacheStorage: caches, fetchFile: network, getDurableBuildPins: async () => ({ status: 'complete', buildIds: [] }), retentionLocks: { request: (_name, _options, operation) => operation({}) }, ...extra });
  const request = (relative, mode) => ({ url: new URL(relative, scope).href, method: 'GET', mode });
  it('publishes completeness last, restores after worker restart and resolves each offline route exactly', async () => {
    const build = await fixture.build(), service = owner(build), first = service.install();
    expect(service.install()).to.equal(first); expect(service.getState().offlineReady).to.equal(false);
    await first; expect(service.getState()).to.include({ status: 'installed', offlineReady: true });
    const restarted = owner(build, { fetchFile: () => { throw new Error('Offline restore must not fetch.'); } });
    await restarted.restore(); expect(restarted.getState().offlineReady).to.equal(true);
    for (const route of ['index.html', 'editor.html', 'procgen.html', 'procgen-survey.html']) {
      const redirect = await restarted.responseFor(request(route + '?seed=123', 'navigate'));
      expect(redirect.headers.get('location')).to.equal(scope + build.buildId + '/' + route + '?seed=123');
      const response = await restarted.responseFor(request(build.buildId + '/' + route + '?seed=123', 'navigate'));
      expect(await response.text()).to.equal(await fs.readFile(path.join(build.path, route), 'utf8'));
    }
    const style = await restarted.responseFor(request(build.buildId + '/css/shell.css'));
    expect(style.status).to.equal(200); expect(style.headers.get('content-type')).to.equal('text/css');
    expect((await restarted.responseFor(request(build.buildId + '/css/shell.css?rev=wrong'))).status).to.equal(503);
    expect((await restarted.responseFor(request(build.buildId + '/js/not-declared.js'))).status).to.equal(503);
    expect(await restarted.responseFor(request('not-an-app-route'))).to.equal(null);
    expect((await restarted.responseFor(request(build.buildId + '/runtime-build.json'))).status).to.equal(200);
    const checking = restarted.verifyInstalledBuild(build.buildId);
    expect(restarted.verifyInstalledBuild(build.buildId)).to.equal(checking);
    expect(await checking).to.include({ buildId: build.buildId, offlineReady: true, resourceDelivery: 'verified-immutable-responses' });
  });
  it('keeps an installed A and unrelated recording cache when interrupted B cannot finish', async () => {
    const a = await fixture.build(); await owner(a).install();
    await (await caches.open('other-app-recordings')).put('https://app.invalid/recording', new globalThis.Response('keep'));
    await fs.writeFile(path.join(fixture.root, 'classic/MAIN.DAT'), 'build B'); const b = await fixture.build();
    unavailable = file => file === b.buildId + '/js/entry.js';
    const candidate = owner(b); let error; try { await candidate.install(); } catch (failure) { error = failure; }
    expect(error).to.be.instanceOf(Error); expect(candidate.getState()).to.include({ status: 'failed', offlineReady: false });
    expect((await caches.keys()).some(name => name.includes(b.buildId))).to.equal(false);
    const previous = owner(a); await previous.restore(); expect(previous.getState().offlineReady).to.equal(true);
    expect((await caches.keys()).includes('other-app-recordings')).to.equal(true);
  });
  it('retains an old generation while a live client owns it, then trims only the inactive owned generation', async () => {
    const a = await fixture.build(); await owner(a).install();
    await fs.writeFile(path.join(fixture.root, 'classic/MAIN.DAT'), 'build B'); const b = await fixture.build();
    let clients = [{ url: scope + a.buildId + '/procgen.html' }];
    const next = owner(b, { getClients: async () => clients }); await next.install(); await next.trim();
    expect((await caches.keys()).some(name => name.includes(a.buildId))).to.equal(true);
    expect((await next.responseFor(request(a.buildId + '/js/entry.js'))).status).to.equal(200);
    clients = []; await next.trim(); expect((await caches.keys()).some(name => name.includes(a.buildId))).to.equal(false);
    expect((await next.responseFor(request(a.buildId + '/js/entry.js'))).status).to.equal(503);
  });
  it('retains durable recovery generations without clients and refuses uncertain or unlocked pruning', async () => {
    const a = await fixture.build(); await owner(a).install();
    await fs.writeFile(path.join(fixture.root, 'classic/MAIN.DAT'), 'build B'); const b = await fixture.build();
    let pins = { status: 'complete', buildIds: [a.buildId] };
    const next = owner(b, { getDurableBuildPins: async () => pins }); await next.install();
    expect((await next.trim()).retainedBuildIds).to.include(a.buildId);
    pins = { status: 'unknown', buildIds: [], reason: 'legacy-recovery-pin-schema' };
    expect((await next.trim()).status).to.equal('deferred');
    expect((await owner(b, { retentionLocks: null }).trim()).reason).to.equal('retention-lock-unavailable');
    expect((await caches.keys()).some(name => name.includes(a.buildId))).to.equal(true);
    pins = { status: 'complete', buildIds: [] }; await next.trim();
    expect((await caches.keys()).some(name => name.includes(a.buildId))).to.equal(false);
  });
  it('does not call a restarted cache complete if a declared dependency was removed or modified', async () => {
    const build = await fixture.build(); await owner(build).install();
    const cache = await caches.open((await caches.keys())[0]);
    await cache.put(scope + build.buildId + '/js/entry.js', new globalThis.Response('changed'));
    const restarted = owner(build); let error; try { await restarted.restore(); } catch (failure) { error = failure; }
    expect(error?.code).to.equal('generation-unavailable'); expect(restarted.getState().offlineReady).to.equal(false);
    expect((await restarted.responseFor(request(build.buildId + '/js/entry.js'))).status).to.equal(503);
    expect((await restarted.responseFor(request('procgen.html', 'navigate'))).status).to.equal(503);
  });
  it('rejects response bounds before reads and assembles many tiny chunks within bounded slabs', async () => {
    let opened = false, error;
    try { await readBrowserBuildResponse({ ok: true, headers: { get: () => '1000' }, body: { getReader() { opened = true; } } }, 10); } catch (failure) { error = failure; }
    expect(error.code).to.equal('response-capacity'); expect(opened).to.equal(false);
    let count = 0;
    const stream = new globalThis.ReadableStream({ pull(controller) { if (count === 8193) controller.close(); else controller.enqueue(new Uint8Array([count++ % 256])); } });
    const bytes = await readBrowserBuildResponse(new globalThis.Response(stream), 9000);
    expect(bytes.byteLength).to.equal(8193); expect(bytes[8192]).to.equal(0);
    try { await readBrowserBuildResponse(new globalThis.Response(new Uint8Array(11)), 10); } catch (failure) { error = failure; }
    expect(error.code).to.equal('response-capacity');
  });
  it('does not open a cached BYOB reader whose final EOF observation can remain pending', async () => {
    const bytes = new Uint8Array(65537).fill(29), response = new globalThis.Response(bytes), modes = [];
    const observed = { ok: true, headers: response.headers, body: { getReader(options) {
      modes.push(options?.mode || 'default');
      if (options?.mode === 'byob') throw new Error('Cached BYOB EOF is not a usable completion boundary.');
      return response.body.getReader();
    } } };
    expect([...await readBrowserBuildResponse(observed, bytes.length)]).to.deep.equal([...bytes]);
    expect(modes).to.deep.equal(['default']);
  });
});
