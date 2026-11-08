import { AudioAssetError } from './AudioAssetRef.js';

// This namespace contains only app-owned encoded audio assets, never recordings
// or executable modules. The loader verifies the content hash after every read.
export function createAudioAssetStore({ cacheStorage = globalThis.caches, cacheName = 'lemmings-audio-assets-v1',
  baseUrl = globalThis.location?.origin || 'http://localhost' } = {}) {
  if (!cacheStorage?.open || !/^lemmings-audio-assets-[a-z0-9-]+$/.test(cacheName)) throw new AudioAssetError('persistent-audio-store-unavailable');
  const url = hash => {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new AudioAssetError('invalid-asset-store-key');
    return new URL('/__audio_asset_cache__/' + hash, baseUrl).href;
  };
  return Object.freeze({
    async get(hash) { return (await cacheStorage.open(cacheName)).match(url(hash)); },
    async has(hash) { return !!await (await cacheStorage.open(cacheName)).match(url(hash)); },
    async put(hash, bytes) {
      await (await cacheStorage.open(cacheName)).put(url(hash), new globalThis.Response(bytes, { headers: { 'Content-Type': 'audio/wav' } }));
    },
    async remove(hash) { return (await cacheStorage.open(cacheName)).delete(url(hash)); },
    namespace: cacheName
  });
}
