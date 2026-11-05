export async function isolateAudioClockProbe(page) {
  const receipt = await page.evaluate(async () => {
    const url = new URL(location.href); url.search = ''; url.hash = '';
    if (!/\/dist\/browser\/[a-f0-9]{64}\/procgen\.html$/.test(url.pathname)) throw new Error('The render observer needs the installed immutable document.');
    const names = await caches.keys(), modified = [], scripts = [], prefix = new URL('./', url).pathname; let totalBytes = 0;
    if (names.length > 8) throw new Error('Unexpected native probe cache population.');
    const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    for (const name of names) {
      const cache = await caches.open(name), requests = await cache.keys();
      if (requests.length > 4096) throw new Error('Native probe cache exceeds its entry bound.');
      for (const request of requests) {
        const target = new URL(request.url), document = target.href === url.href;
        if (target.origin !== url.origin || !document && !(target.pathname.startsWith(prefix) && /\.[cm]?js$/.test(target.pathname))) continue;
        const response = await cache.match(request), bytes = await response.arrayBuffer(); totalBytes += bytes.byteLength;
        if (bytes.byteLength > 8 * 1048576 || totalBytes > 64 * 1048576) throw new Error('Native probe source headers exceed their byte bound.');
        const before = await hash(bytes), headers = new window.Headers(response.headers);
        if (document) headers.set('cross-origin-opener-policy', 'same-origin');
        headers.set('cross-origin-embedder-policy', 'require-corp'); headers.set('cross-origin-resource-policy', 'same-origin');
        await cache.put(request, new window.Response(bytes, { status: response.status, statusText: response.statusText, headers }));
        const after = await hash(await (await cache.match(request)).arrayBuffer());
        if (before !== after) throw new Error('Isolated probe headers changed immutable source bytes.');
        if (document) modified.push({ document: url.pathname, bytes: bytes.byteLength, before, after, headersOnly: true });
        else scripts.push({ path: target.pathname, bytes: bytes.byteLength, before, after });
      }
    }
    if (modified.length !== 1 || !scripts.length) throw new Error('Expected one installed native probe document and its worker-capable scripts.');
    scripts.sort((a, b) => a.path.localeCompare(b.path));
    return { policy: 'controlled-observer-COOP-COEP;immutable-source-bytes-unchanged', modified,
      scriptHeaders: { files: scripts.length, bytes: totalBytes - modified[0].bytes, digest: await hash(new window.TextEncoder().encode(JSON.stringify(scripts))) } };
  });
  await page.route('**/e2e-portable/fixtures/*.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' } });
  });
  await page.reload();
  await page.waitForFunction(() => { if (!window.__PROCGEN_STUDIO__ || !window.__PROCGEN_LANES__?.world?.terrain) return false; window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); return true; });
  await page.evaluate(receipt => { if (!window.crossOriginIsolated) throw new Error('Native probe document did not enter its isolated observer environment.'); window.__nativeClockHeaderReceipt = receipt; }, receipt);
}

export async function observeNativeAudioClock(page) {
  await page.addInitScript(() => {
    const Context = window.AudioContext || window.webkitAudioContext;
    window.__nativeClockObservation = { contexts: [], starts: [], stops: [], ends: [] };
    if (typeof Context !== 'function') return;
    window.AudioContext = class extends Context {
      constructor(options) { super(options); window.__nativeClockObservation.contexts.push(this); }
    };
    const start = window.OscillatorNode.prototype.start, stop = window.OscillatorNode.prototype.stop, ordinals = new WeakMap();
    window.OscillatorNode.prototype.start = function(when = 0) {
      const observation = window.__nativeClockObservation, row = { ordinal: observation.starts.length, context: observation.contexts.indexOf(this.context),
        targetSeconds: when, submittedSeconds: this.context.currentTime, submittedHostMs: performance.now(), sampleRate: this.context.sampleRate };
      if (observation.starts.length < 512) observation.starts.push(row);
      ordinals.set(this, row.ordinal);
      this.addEventListener('ended', event => {
        const end = { ordinal: row.ordinal, context: observation.contexts.indexOf(this.context), sampleRate: this.context.sampleRate, contextSeconds: this.context.currentTime, hostMs: performance.now(), trusted: event.isTrusted, acknowledgment: 'native-source-ended' };
        window.__nativeClockEndProbe?.(this, end);
        if (observation.ends.length < 512) observation.ends.push(end);
      }, { once: true });
      window.__nativeClockStartProbe?.(this, row);
      return start.call(this, when);
    };
    window.OscillatorNode.prototype.stop = function(when = 0) {
      const observation = window.__nativeClockObservation;
      const row = { ordinal: ordinals.get(this), context: observation.contexts.indexOf(this.context), targetSeconds: when, submittedSeconds: this.context.currentTime, submittedHostMs: performance.now(), sampleRate: this.context.sampleRate };
      if (observation.stops.length < 1024) observation.stops.push(row);
      window.__nativeClockStopProbe?.(this, row, 'before');
      const result = stop.call(this, when);
      window.__nativeClockStopProbe?.(this, row, 'after');
      return result;
    };
  });
}
