const fail = message => { throw new TypeError('Browser deployment: ' + message); };
const bridgeOrigin = value => {
  if (value === null) return null;
  const url = new URL(value);
  if (!['ws:', 'wss:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/midi' || url.search || url.hash || url.username || url.password)
    fail('Allow only the explicitly selected loopback /midi bridge.');
  return url.origin;
};
export async function createBrowserDeploymentHeaders({ html = null, isolated = false, nativeBridgeUrl = null } = {}) {
  if (typeof isolated !== 'boolean' || html !== null && (typeof html !== 'string' || html.length > 2 * 1048576)) fail('Use a bounded application document and explicit isolation mode.');
  const hashes = new Set(), bridge = bridgeOrigin(nativeBridgeUrl);
  if (html !== null) {
    if (/\s+on[a-z]+\s*=/i.test(html)) fail('Inline event handlers must move to application listeners.');
    let scripts = 0;
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/i.test(match[1]) || /\btype\s*=\s*["'](?:application\/(?:ld\+)?json|importmap)["']/i.test(match[1])) continue;
      if (++scripts > 64) fail('The inline bootstrap inventory exceeds its bound.');
      const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[2]));
      hashes.add('\'sha256-' + btoa(String.fromCharCode(...new Uint8Array(digest))) + '\'');
    }
  }
  const policy = ['default-src \'self\'', 'script-src \'self\' \'wasm-unsafe-eval\'' + (hashes.size ? ' ' + [...hashes].sort().join(' ') : ''), 'script-src-attr \'none\'',
    'worker-src \'self\'', 'connect-src \'self\'' + (bridge ? ' ' + bridge : ''), 'img-src \'self\' data: blob:', 'media-src \'self\' blob:',
    'style-src \'self\' \'unsafe-inline\'', 'font-src \'self\'', 'object-src \'none\'', 'base-uri \'none\'', 'frame-src \'none\'', 'frame-ancestors \'none\'', 'form-action \'none\''].join('; ');
  return Object.freeze({ 'Content-Security-Policy': policy, 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'cross-origin-isolated=(self), midi=(self), fullscreen=(self), speaker-selection=(self)',
    ...(isolated ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}) });
}

export function readBrowserRuntimeCapabilities(realm = globalThis, context = null) {
  const isolated = realm.crossOriginIsolated === true, secureContext = realm.isSecureContext === true;
  const sharedMemory = isolated && typeof realm.SharedArrayBuffer === 'function' && typeof realm.Atomics === 'object';
  const worklet = secureContext && typeof realm.AudioWorkletNode === 'function' && (!context || typeof context.audioWorklet?.addModule === 'function');
  return Object.freeze({ schema: 'lemmings-browser-runtime-capabilities/v1', secureContext, crossOriginIsolated: isolated, sharedMemory,
    ownedAudioTransport: worklet ? 'bounded-transferable-message-port' : 'unavailable', worklet,
    wasmAPI: typeof realm.WebAssembly?.compile === 'function', wasmExecution: 'requires-actual-pinned-module-compilation',
    isolatedOnlyEngines: sharedMemory ? 'require-separate-engine-and-budget-admission' : 'unavailable',
    fallback: worklet ? 'message-port-does-not-require-isolation' : 'explicit-native-instrument-selection', measuredPerformance: false });
}

export function admitBrowserAudioTransport({ sharedMemoryRequired = false, realm = globalThis, context = null } = {}) {
  if (typeof sharedMemoryRequired !== 'boolean') fail('Declare whether this exact engine requires shared memory.');
  const capabilities = readBrowserRuntimeCapabilities(realm, context);
  if (!capabilities.worklet) return Object.freeze({ status: 'unavailable', reason: capabilities.secureContext ? 'audio-worklet-unavailable' : 'secure-context-required',
    namedFallback: 'explicit-native-instrument-selection', capabilities });
  if (sharedMemoryRequired && !capabilities.sharedMemory) return Object.freeze({ status: 'unavailable', reason: 'cross-origin-isolation-required',
    namedFallback: 'explicit-owned-message-port-engine-selection', capabilities });
  return Object.freeze({ status: 'available', transport: sharedMemoryRequired ? 'engine-owned-shared-memory;separate-budget-required' : 'bounded-transferable-message-port',
    isolationFallback: !capabilities.sharedMemory && !sharedMemoryRequired, capabilities, evidence: 'API-capability-preflight;actual-module-readiness-still-required' });
}
