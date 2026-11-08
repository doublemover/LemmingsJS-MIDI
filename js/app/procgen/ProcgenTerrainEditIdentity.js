const fail = () => { throw Object.assign(new Error('Terrain edit evidence has inconsistent patch data.'), { name: 'SurveyStateProjectionError', code: 'invalid-terrain-edit-state' }); };
const typedLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const lengthOf = value => {
  if (!ArrayBuffer.isView(value) || value instanceof DataView) fail();
  return typedLength.call(value);
};
const own = (value, key) => {
  const descriptor = value && Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(); return descriptor.value;
};
const append = (runs, start, length, value) => {
  const last = runs.at(-1);
  if (last && last[0] + last[1] === start && last[2] === value) last[1] += length;
  else runs.push([start, length, value]);
};
const rawRuns = (values, chunkLength) => {
  if (!(values instanceof Uint8Array) || lengthOf(values) !== chunkLength) fail();
  const runs = [];
  for (let start = 0; start < chunkLength;) {
    const value = values[start]; if (!value) { start++; continue; }
    let end = start + 1; while (end < chunkLength && values[end] === value) end++;
    runs.push([start, end - start, value]); start = end;
  }
  return runs;
};
const packedRuns = (record, chunkLength) => {
  if (!record || typeof record !== 'object') fail();
  const raw = Object.getOwnPropertyDescriptor(record, 'raw');
  if (raw) { if (!Object.hasOwn(raw, 'value')) fail(); return rawRuns(raw.value, chunkLength); }
  const spans = own(record, 'runs'), values = own(record, 'values'), count = lengthOf(values);
  if (!(spans instanceof Uint16Array) || !(values instanceof Uint8Array) || lengthOf(spans) !== count * 2) fail();
  const runs = []; let previousEnd = 0;
  for (let index = 0; index < count; index++) {
    const start = spans[index * 2], length = spans[index * 2 + 1], value = values[index];
    if (!length || !value || start < previousEnd || start + length > chunkLength) fail();
    append(runs, start, length, value); previousEnd = start + length;
  }
  return runs;
};

export function captureTerrainEditIdentity(edits) {
  const chunkLength = own(edits, 'chunkLength'), cold = own(edits, 'cold');
  if (!Number.isSafeInteger(chunkLength) || chunkLength < 1 || chunkLength > 65536 || !(cold instanceof Map)) fail();
  const patches = [], keys = new Set();
  const add = (key, runs) => {
    if (!Number.isSafeInteger(key) || key < 0 || keys.has(key)) fail(); keys.add(key);
    if (runs.length) patches.push({ key, runs });
  };
  for (const [key, values] of Map.prototype.entries.call(edits)) add(key, rawRuns(values, chunkLength));
  for (const [key, record] of Map.prototype.entries.call(cold)) add(key, packedRuns(record, chunkLength));
  patches.sort((a, b) => a.key - b.key);
  return { codec: 'logical-edit-runs-v1', chunkLength, patches };
}
