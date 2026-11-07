import { getBundledSoundById } from './BundledSoundMaterial.js';
import { generateProceduralSoundSource } from './ProceduralSoundSources.js';
import { readBrowserBuildResponse } from '../../runtime/BrowserGenerationService.js';

const recordings = Object.freeze({
  'nps-rain': new URL('../../../content/sounds/field-recordings/nps-rain.json', import.meta.url),
  'nps-rockfall': new URL('../../../content/sounds/field-recordings/nps-rockfall.json', import.meta.url),
  'nps-stream': new URL('../../../content/sounds/field-recordings/nps-stream.json', import.meta.url),
  'nps-snowplow': new URL('../../../content/sounds/field-recordings/nps-snowplow.json', import.meta.url)
});
export async function loadBundledSoundSource(identity, { signal, readAsset = null } = {}) {
  const expected = getBundledSoundById(identity?.id);
  if (identity !== expected) throw new TypeError('Use the admitted immutable bundled material identity.');
  signal?.throwIfAborted();
  if (expected.materialType !== 'recording') return generateProceduralSoundSource(expected);
  const encodedLength = 4 * Math.ceil(expected.bytes / 3), maximum = encodedLength + 512;
  const url = recordings[expected.id];
  if (!url) throw new TypeError('Unknown bundled recording.');
  const encoded = readAsset ? await readAsset(url, { signal, maximum }) :
    await readBrowserBuildResponse(await fetch(url, { credentials: 'same-origin', redirect: 'error', signal }), maximum, signal);
  signal?.throwIfAborted();
  if (!(encoded instanceof Uint8Array) || encoded.byteLength > maximum) throw new TypeError('Bundled recording exceeds its encoded inventory.');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded));
  const base64 = data.base64;
  if (data.schema !== 'lemmings-bundled-recording/v1' || data.id !== expected.id || Object.keys(data).length !== 3 ||
      typeof base64 !== 'string' || base64.length !== encodedLength || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) ||
      base64.endsWith('==') !== (expected.bytes % 3 === 1) || base64.endsWith('=') !== (expected.bytes % 3 !== 0)) throw new TypeError('Bundled recording inventory changed.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', table = new Int16Array(128).fill(-1);
  for (let index = 0; index < alphabet.length; index++) table[alphabet.charCodeAt(index)] = index;
  const bytes = new Uint8Array(expected.bytes); let cursor = 0;
  for (let index = 0; index < base64.length; index += 4) {
    if (!(index & 16383)) signal?.throwIfAborted();
    const a = table[base64.charCodeAt(index)], b = table[base64.charCodeAt(index + 1)],
      c = base64[index + 2] === '=' ? 0 : table[base64.charCodeAt(index + 2)], d = base64[index + 3] === '=' ? 0 : table[base64.charCodeAt(index + 3)];
    const value = a * 262144 + b * 4096 + c * 64 + d;
    bytes[cursor++] = value >>> 16;
    if (cursor < bytes.length) bytes[cursor++] = value >>> 8;
    if (cursor < bytes.length) bytes[cursor++] = value;
  }
  if (cursor !== expected.bytes) throw new TypeError('Bundled recording byte inventory changed.');
  return bytes;
}
