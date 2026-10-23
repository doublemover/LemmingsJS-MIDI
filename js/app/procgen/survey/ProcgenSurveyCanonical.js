const SURVEY_STATE_SCHEMA = 3;
const SURVEY_CANONICAL_SCHEMA = 2;
const SUPPORTED_VIEWS = new Set(['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']);
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonicalSurveyJson = value => {
  const encode = item => {
    if (item === undefined) return ['undefined'];
    if (typeof item === 'number') return ['number', Object.is(item, -0) ? '-0' : Number.isFinite(item) ? item : String(item)];
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') throw new Error('Unsupported canonical value');
      return item === null ? ['null'] : [typeof item, item];
    }
    if (item instanceof DataView) return ['data-view', item.byteOffset, item.byteLength,
      Array.from(new Uint8Array(item.buffer, item.byteOffset, item.byteLength))];
    if (ArrayBuffer.isView(item)) {
      const type = item.constructor.name;
      if (!SUPPORTED_VIEWS.has(type)) throw new Error(`Unsupported canonical view: ${type}`);
      return ['typed-v2', type, item.byteOffset, item.byteLength, item.length,
        Array.from(item, value => typeof value === 'bigint' ? ['bigint', value.toString()] : encode(value))];
    }
    if (item instanceof ArrayBuffer) return ['array-buffer', item.byteLength, Array.from(new Uint8Array(item))];
    if (Array.isArray(item)) return ['array', item.map(encode)];
    if (item instanceof Map) return ['map', [...item].map(([key, entry]) => [encode(key), encode(entry)]).sort((a, b) => compareText(JSON.stringify(a[0]), JSON.stringify(b[0])))];
    if (item instanceof Set) return ['set', [...item].map(encode).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)))];
    const out = [];
    for (const key of Object.keys(item).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Canonical data cannot contain getters');
      out.push([key, encode(descriptor.value)]);
    }
    return ['object', out];
  };
  return JSON.stringify(encode(value));
};
// Portable evidence checksums; asset provenance uses the loader's SHA-256.
const hashSurveyValue = value => {
  const text = canonicalSurveyJson(value); let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index); first = Math.imul(first ^ code, 0x01000193); second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
};
const semanticSurveyRandom = (seed, ...keys) => parseInt(hashSurveyValue(['semantic-random-v1', seed, ...keys]).slice(0, 8), 16) / 0x100000000;
const freezeSurveyData = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const entry of Object.values(value)) freezeSurveyData(entry); Object.freeze(value); }
  return value;
};
export { SURVEY_STATE_SCHEMA, SURVEY_CANONICAL_SCHEMA, canonicalSurveyJson, hashSurveyValue, semanticSurveyRandom, freezeSurveyData };
