import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalDataText } from '../js/core/CanonicalData.js';

const SCHEMA = 'lemmings-sound-identities/v1';
const MAX_BYTES = 16 * 1048576, MAX_PACKS = 8192, MAX_PATCHES = 65536;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(value);
const digest = text => createHash('sha256').update(text).digest('hex');
const canonical = value => canonicalDataText(value, { maxBytes: MAX_BYTES, maxNodes: 600000 }).text;
const before = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const conflict = (kind, identity) => { throw new Error('Immutable sound ' + kind + ' conflicts with published history: ' + identity + '. Use a new version/revision or fork identity.'); };

export function extendSoundIdentityLedger(previous = null, packs = []) {
  const packMap = new Map(), patchMap = new Map();
  const insert = (map, entry, kind) => {
    const version = kind === 'pack' ? entry.version : entry.revision;
    if (!id(entry.id) || !hash(entry.contentHash) || (kind === 'pack' ? typeof version !== 'string' || !version || version.length > 64 : !Number.isSafeInteger(version) || version < 1))
      throw new Error('Invalid published sound ' + kind + ' identity.');
    const key = JSON.stringify([entry.id, version]);
    if (map.has(key) && map.get(key).contentHash !== entry.contentHash) conflict(kind, entry.id + '@' + version);
    map.set(key, { id: entry.id, [kind === 'pack' ? 'version' : 'revision']: version, contentHash: entry.contentHash });
    if (map.size > (kind === 'pack' ? MAX_PACKS : MAX_PATCHES)) throw new Error('Published sound identity history exceeds its bounded capacity.');
  };
  if (previous) {
    if (previous.schema !== SCHEMA || !Array.isArray(previous.packs) || previous.packs.length > MAX_PACKS || !Array.isArray(previous.patches) || previous.patches.length > MAX_PATCHES)
      throw new Error('Unsupported published sound identity history.');
    for (const entry of previous.packs) insert(packMap, entry, 'pack');
    for (const entry of previous.patches) insert(patchMap, entry, 'patch');
  }
  for (const { pack, contentHash } of packs) {
    if (!pack || digest(canonical(pack)) !== contentHash) throw new Error('Published sound pack differs from its immutable content hash.');
    insert(packMap, { id: pack.id, version: pack.version, contentHash }, 'pack');
    if (!Array.isArray(pack.patches) || pack.patches.length > 256) throw new Error('Invalid published sound patch inventory.');
    const renderKeys = new Map((pack.compilation?.artifacts || []).map(artifact => [JSON.stringify([artifact.id, artifact.revision]), artifact.renderKey]));
    for (const patch of pack.patches) {
      const definition = patch.definition, renderKey = renderKeys.get(JSON.stringify([definition?.id, definition?.revision])) ?? null;
      if (renderKey != null && !hash(renderKey)) throw new Error('Invalid compiled sound render identity.');
      insert(patchMap, { id: definition?.id, revision: definition?.revision, contentHash: digest(canonical({ patch, renderKey })) }, 'patch');
    }
  }
  const sorted = map => [...map.entries()].sort(([left], [right]) => before(left, right)).map(([, entry]) => entry);
  const ledger = { schema: SCHEMA, packs: sorted(packMap), patches: sorted(patchMap) };
  const text = canonical(ledger) + '\n';
  return { ledger, text, identityHash: digest(text) };
}

export async function loadSoundIdentityLedger({ outputDir, head = null, fsImpl = fs } = {}) {
  const root = await fsImpl.realpath(outputDir); let totalBytes = 0;
  const read = async (relative, bound) => {
    const filename = await fsImpl.realpath(path.join(root, relative)), location = path.relative(root, filename);
    if (!location || location === '..' || location.startsWith('..' + path.sep) || path.isAbsolute(location)) throw new Error('Published sound history escapes its output directory.');
    const stat = await fsImpl.stat(filename);
    if (!stat.isFile() || stat.size > bound || (totalBytes += stat.size) > 256 * 1048576) throw new Error('Published sound history exceeds its metadata budget.');
    const text = await fsImpl.readFile(filename, 'utf8');
    if (Buffer.byteLength(text) !== stat.size || Buffer.byteLength(text) > bound) throw new Error('Published sound history changed during inspection.');
    return { text, value: JSON.parse(text) };
  };
  if (head?.identityHash != null) {
    if (!hash(head.identityHash) || head.identityPath !== head.identityHash + '.identities.json') throw new Error('Invalid sound identity history head.');
    const stored = await read(head.identityPath, MAX_BYTES);
    if (digest(stored.text) !== head.identityHash) throw new Error('Published sound identity history hash changed.');
    const admitted = extendSoundIdentityLedger(stored.value);
    if (admitted.text !== stored.text) throw new Error('Published sound identity history is not canonical.');
    return admitted.ledger;
  }
  let ledger = null, catalogs = 0, entries = 0, foundHead = !head;
  const directory = await fsImpl.opendir(root);
  for await (const entry of directory) {
    if (++entries > 8192) throw new Error('Sound publication directory exceeds its bounded inventory.');
    if (!entry.isDirectory() || !hash(entry.name)) continue;
    if (++catalogs > 4096) throw new Error('Sound catalog history exceeds its bounded inventory.');
    const catalog = await read(entry.name + '/catalog.json', 4 * 1048576);
    if (digest(catalog.text) !== entry.name || catalog.value.schema !== 'lemmings-sound-catalog/v1' || !Array.isArray(catalog.value.packs) || catalog.value.packs.length > 256)
      throw new Error('Invalid immutable sound catalog history.');
    const packs = [];
    for (const reference of catalog.value.packs) {
      if (!hash(reference.contentHash) || reference.manifest !== reference.contentHash + '/pack.json') throw new Error('Invalid historical sound pack reference.');
      const stored = await read(entry.name + '/' + reference.manifest, 4 * 1048576);
      if (stored.value.id !== reference.id || stored.value.version !== reference.version) throw new Error('Historical sound pack identity differs from its catalog.');
      packs.push({ pack: stored.value, contentHash: reference.contentHash });
    }
    ledger = extendSoundIdentityLedger(ledger, packs).ledger;
    if (entry.name === head?.catalogHash) foundHead = true;
  }
  if (!foundHead) throw new Error('Published sound head has no immutable source catalog.');
  return ledger;
}
