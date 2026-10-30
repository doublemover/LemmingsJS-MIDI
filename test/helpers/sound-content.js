import { createHash } from 'node:crypto';
import { canonicalDataText, hashDataText } from '../../js/core/CanonicalData.js';
import { prepareSoundContentPack, SOUND_CONTENT_SCHEMA } from '../../js/midi/content/SoundContentPack.js';
import { SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } from '../../js/app/midi-ui/SoundContentArchive.js';

export const soundFixture = async () => {
  const bytes = new Uint8Array([11, 22, 33, 44]), sha256 = createHash('sha256').update(bytes).digest('hex');
  const license = { id: 'fixture', text: 'Synthetic fixture terms only.', url: 'urn:fixture:terms' }; license.sha256 = await hashDataText(license.text);
  const rights = kind => ({ kind, creator: 'Fixture', sourceUrl: 'urn:fixture:source', licenseId: license.id, licenseUrl: license.url,
    licenseTextHash: license.sha256, attribution: 'Fixture', modifications: [], declaredUse: 'redistributable' });
  const engine = { engineId: 'fixture', engineVersion: 1, artifactHash: 'a'.repeat(64), parameterSchemaHash: 'b'.repeat(64), parameters: [], capabilities: {} };
  const definition = { schemaVersion: 2, id: 'fixture', revision: 1, name: 'Fixture', author: 'Fixture', tags: [], engineId: engine.engineId, engineVersion: 1,
    parameters: {}, modulations: [], sampleRefs: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 1, steal: 'reject' }, mix: { gain01: 0.5, pan01: 0 } };
  const pack = { schema: SOUND_CONTENT_SCHEMA, id: 'fixture-pack', version: '1.0.0', name: 'Fixture pack', author: 'Fixture', sourceUrl: 'urn:fixture:pack',
    licenseId: 'mixed', licenseUrl: null, attribution: 'Fixture', modifications: [], redistributionPolicy: 'portable', licenses: [license],
    files: [{ path: 'data/fixture.bin', sha256, bytes: bytes.length, kind: 'generated-data', mediaType: 'application/octet-stream', parents: [], rights: rights('derived-data') }],
    patches: [{ definition, dependencies: [sha256], engineRequirement: { engineId: engine.engineId, engineVersion: 1, artifactHash: engine.artifactHash, parameterSchemaHash: engine.parameterSchemaHash }, rights: rights('patch-recipe') }] };
  const prepared = await prepareSoundContentPack(pack, { engineDescriptors: [engine] });
  const archive = ({ mode = 'portable', payload = bytes, extra = [], transformHeader = value => value, headerText = null } = {}) => {
    const header = transformHeader({ format: SOUND_ARCHIVE_FORMAT, mode, contentHash: prepared.contentHash, pack: prepared.pack,
      payloads: mode === 'portable' ? [{ sha256, bytes: bytes.length }] : [], rightsReview: [], qualification: 'verified-material-not-render-qualified' });
    const encoded = new TextEncoder().encode(headerText ?? canonicalDataText(header, { maxBytes: 4 * 1048576 }).text), prefix = new Uint8Array(12);
    prefix.set(new TextEncoder().encode(SOUND_ARCHIVE_MAGIC)); new DataView(prefix.buffer).setUint32(8, encoded.byteLength, false);
    return new Blob([prefix, encoded, ...(mode === 'portable' ? [payload] : []), ...extra]);
  };
  return { bytes, sha256, pack, prepared, engine, archive };
};
