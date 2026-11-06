const byte = value => Number.isInteger(value) && value >= 0 && value <= 127;
export function validateDevicePatchIntent(value) {
  if (value == null) return null;
  if (value.schema !== 'lemmings-device-patch-intent/v1' || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 256 ||
      typeof value.collection !== 'string' || !/^[A-Za-z0-9_]{1,36}$/.test(value.collection) ||
      !Array.isArray(value.bankPC) || value.bankPC.length !== 3 || !value.bankPC.every(byte) ||
      typeof value.catalogDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.catalogDigest) || !value.deviceIdentity ||
      !['manufacturer', 'family', 'model', 'revision'].every(key => Number.isSafeInteger(value.deviceIdentity[key]) && value.deviceIdentity[key] >= 0 && value.deviceIdentity[key] <= 0x0fffffff)) throw new Error('Invalid reproducible device patch intent');
  return Object.freeze({ schema: value.schema, title: value.title, collection: value.collection, bankPC: Object.freeze([...value.bankPC]),
    catalogDigest: value.catalogDigest, deviceIdentity: Object.freeze(Object.fromEntries(['manufacturer', 'family', 'model', 'revision'].map(key => [key, value.deviceIdentity[key]]))),
    fallback: 'local-preview-approximation', authorization: 'requires-explicit-current-device-selection-and-recall' });
}

export function sameDevicePatchIntent(left, right) { return !!(left && right && left.collection === right.collection && left.catalogDigest === right.catalogDigest && left.bankPC.every((value, index) => value === right.bankPC[index]) && ['manufacturer', 'family', 'model', 'revision'].every(key => left.deviceIdentity[key] === right.deviceIdentity[key])); }
