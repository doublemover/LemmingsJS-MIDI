export const IMPORT_CORPUS_SEED = 0x987412;
export function createSeededImportCorpus({ seed = IMPORT_CORPUS_SEED, count = 64 } = {}) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff || !Number.isInteger(count) || count < 1 || count > 128) throw new RangeError('Invalid bounded import corpus.');
  let state = seed;
  const draw = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const tree = depth => depth === 0 ? draw() / 0xffffffff : draw() % 2 ? [tree(depth - 1), tree(depth - 1)] : { ['field' + draw() % 16]: tree(depth - 1) };
  const paths = [['project'], ['settings'], ['world'], ['transport'], ['patterns'], ['patterns', 'lanes'], ['world', 'graph', 'nodes'], ['world', 'graph', 'owners'], ['format'], ['version'], []];
  const cases = [];
  for (let index = 0; index < count; index++) {
    const path = paths[index % paths.length], variant = draw() % 6;
    let value = [null, false, draw() % 10000, 'invalid-' + draw(), [], [tree(1 + draw() % 5)]][variant];
    if (path[0] === 'format') value = 'unsupported-' + draw();
    if (path[0] === 'version') value = 2 + draw() % 1000;
    cases.push({ name: 'seeded-' + index + '-' + (path.join('.') || 'root'), seed, ordinal: index, path, value });
  }
  for (let index = cases.length - 1; index > 0; index--) { const other = draw() % (index + 1); [cases[index], cases[other]] = [cases[other], cases[index]]; }
  return cases;
}
export function mutateImportSession(original, mutation) {
  if (!mutation.path.length) return structuredClone(mutation.value);
  const value = structuredClone(original); let target = value;
  for (const part of mutation.path.slice(0, -1)) target = target[part];
  target[mutation.path.at(-1)] = structuredClone(mutation.value); return value;
}
