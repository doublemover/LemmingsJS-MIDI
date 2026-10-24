import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { createSoundContentArchiver, SOUND_ARCHIVE_FORMAT, SOUND_ARCHIVE_MAGIC } from '../../js/app/midi-ui/SoundContentArchive.js';
import { prepareSoundContentPack, planSoundContentSelection, SOUND_CONTENT_SCHEMA } from '../../js/midi/content/SoundContentPack.js';
import { hashDataText } from '../../js/core/CanonicalData.js';
import { createBackgroundJobService } from '../../js/app/resources/BackgroundJobService.js';
import { createBackgroundWorkerAdmission } from '../../js/app/resources/BackgroundWorkerAdmission.js';
import { createResourceBudget } from '../../js/app/resources/ResourceBudget.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const rejects = async (promise, code) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error?.code).to.equal(code); return error; };
describe('selected sound material archive preparation', () => {
  let prepared, bytes, secret;
  before(async () => {
    bytes = new Uint8Array([1, 2, 3, 4]); secret = new Uint8Array([9, 8, 7]);
    const license = { id: 'fixture', text: 'Synthetic terms for archive fixtures only.', url: 'urn:fixture:terms' }; license.sha256 = await hashDataText(license.text);
    const rights = kind => ({ kind, creator: 'Fixture', sourceUrl: 'urn:fixture:source', licenseId: 'fixture', licenseUrl: license.url,
      licenseTextHash: license.sha256, attribution: 'Fixture', modifications: [], declaredUse: 'redistributable' });
    const engine = { engineId: 'fixture', engineVersion: 1, artifactHash: 'a'.repeat(64), parameterSchemaHash: 'b'.repeat(64), parameters: [], capabilities: {} };
    const patch = { schemaVersion: 2, id: 'selected', revision: 1, name: 'Selected', author: 'Fixture', tags: [], engineId: engine.engineId, engineVersion: 1,
      parameters: {}, modulations: [], sampleRefs: [], macros: [], causalBindings: [], voicePolicy: { maxVoices: 1, steal: 'reject' }, mix: { gain01: 0.5, pan01: 0 } };
    prepared = await prepareSoundContentPack({ schema: SOUND_CONTENT_SCHEMA, id: 'pack', version: '1.0.0', name: 'Fixture pack', author: 'Fixture', sourceUrl: 'urn:fixture:pack',
      licenseId: 'mixed', licenseUrl: null, attribution: 'Fixture', modifications: [], redistributionPolicy: 'portable', licenses: [license],
      files: [{ path: 'data/selected.bin', sha256: sha256(bytes), bytes: bytes.length, kind: 'generated-data', mediaType: 'application/octet-stream', parents: [], rights: rights('derived-data') },
        { path: 'data/private.bin', sha256: sha256(secret), bytes: secret.length, kind: 'generated-data', mediaType: 'application/octet-stream', parents: [], rights: { ...rights('derived-data'), declaredUse: 'private' } }],
      patches: [{ definition: patch, dependencies: [sha256(bytes)], engineRequirement: { engineId: engine.engineId, engineVersion: 1, artifactHash: engine.artifactHash, parameterSchemaHash: engine.parameterSchemaHash }, rights: rights('patch-recipe') }] }, { engineDescriptors: [engine] });
  });
  const setup = extra => {
    const budget = createResourceBudget(), admission = createBackgroundWorkerAdmission(), jobs = createBackgroundJobService({ admission, Worker: null, yieldTask: async () => {} });
    const archiver = createSoundContentArchiver({ resourceBudget: budget, jobs, ...extra });
    return { budget, jobs, admission, archiver, dispose() { archiver.dispose(); jobs.dispose(); admission.dispose(); } };
  };
  const request = extra => ({ prepared, selection: ['selected@1'], mode: 'portable', reviewRights: entry => ({ decision: 'allow', receiptId: 'fixture-review', contentHash: entry.contentHash, rightsHash: entry.rightsHash }),
    readAsset: async () => new globalThis.Response(bytes), ...extra });
  it('creates a bounded immutable artifact containing only selected material and credits', async () => {
    const owner = setup(), requested = [];
    const result = await owner.archiver.prepareExport(request({ readAsset: async file => { requested.push(file.sha256); return new globalThis.Response(bytes); } }));
    try {
      const lease = result.artifact.borrow(), archive = new Uint8Array(await lease.blob.arrayBuffer()); lease.release();
      expect(new TextDecoder().decode(archive.slice(0, 8))).to.equal(SOUND_ARCHIVE_MAGIC);
      const size = new DataView(archive.buffer).getUint32(8, false), header = JSON.parse(new TextDecoder().decode(archive.slice(12, 12 + size)));
      expect(header).to.include({ format: SOUND_ARCHIVE_FORMAT, mode: 'portable', qualification: 'verified-material-not-render-qualified' });
      expect(header.pack.files.map(file => file.sha256)).to.deep.equal([sha256(bytes)]);
      expect(header.pack.origin.contentHash).to.equal(prepared.contentHash); expect(header.pack.patches).to.have.length(1);
      expect([...archive.slice(12 + size)]).to.deep.equal([...bytes]); expect(requested).to.deep.equal([sha256(bytes)]);
      expect(owner.budget.diagnostics().categories.export.entries).to.equal(1);
    } finally { result.artifact.discard(); await result.artifact.digest(); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); owner.dispose(); }
  });
  it('prepares a reference-only artifact without opening any asset source', async () => {
    const owner = setup(); let opened = 0;
    const result = await owner.archiver.prepareExport(request({ mode: 'reference-only', reviewRights: undefined, readAsset: async () => { opened++; } }));
    expect(opened).to.equal(0); expect(result.mode).to.equal('reference-only'); result.artifact.discard(); await result.artifact.digest(); owner.dispose();
  });
  it('preserves the immutable pack identity when exporting its complete already-minimal inventory', async () => {
    const owner = setup(), requirement = prepared.pack.patches[0].engineRequirement;
    const minimal = await prepareSoundContentPack({ ...prepared.pack, files: prepared.pack.files.filter(file => file.sha256 === sha256(bytes)) },
      { engineDescriptors: [{ ...requirement, parameters: [], capabilities: {} }] });
    const result = await owner.archiver.prepareExport(request({ prepared: minimal, mode: 'reference-only' }));
    expect(result.selectedPackHash).to.equal(minimal.contentHash);
    const lease = result.artifact.borrow(), archive = new Uint8Array(await lease.blob.arrayBuffer()); lease.release();
    const size = new DataView(archive.buffer).getUint32(8, false), header = JSON.parse(new TextDecoder().decode(archive.subarray(12, 12 + size)));
    expect(header.pack.id).to.equal(minimal.pack.id); expect(header.contentHash).to.equal(minimal.contentHash);
    result.artifact.discard(); await result.artifact.digest(); owner.dispose();
  });
  it('rejects missing rights, copied preparation labels and changed payload bytes before publication', async () => {
    const owner = setup(); let opened = 0;
    await rejects(owner.archiver.prepareExport(request({ reviewRights: undefined, readAsset: async () => { opened++; } })), 'reference-only-required'); expect(opened).to.equal(0);
    expect(() => planSoundContentSelection(structuredClone(prepared), ['selected@1'])).to.throw('invalid selection plan');
    await rejects(owner.archiver.prepareExport(request({ readAsset: async () => new globalThis.Response(secret) })), 'asset-size-mismatch');
    await rejects(owner.archiver.prepareExport(request({ readAsset: async () => new globalThis.Response(new Uint8Array(4)) })), 'content-mismatch');
    expect(owner.budget.diagnostics().accountedBytes).to.equal(0); owner.dispose();
  });
  it('settles a deadline while retaining a nonabortable source reservation until the actual callback returns', async () => {
    const owner = setup({ timeoutMs: 1000, maxPending: 1 }); let finish, started;
    const opened = new Promise(resolve => { started = resolve; });
    const pending = owner.archiver.prepareExport(request({ readAsset: () => { started(); return new Promise(resolve => { finish = resolve; }); } }));
    await opened; await rejects(pending, 'deadline'); expect(owner.archiver.diagnostics().unknownRetirement).to.equal(1);
    expect(owner.budget.diagnostics().accountedBytes).to.be.greaterThan(0); await rejects(owner.archiver.prepareExport(request()), 'archive-capacity');
    finish(new globalThis.Response(bytes)); await new Promise(resolve => setTimeout(resolve, 0));
    expect(owner.archiver.diagnostics().pending).to.equal(0); expect(owner.budget.diagnostics().accountedBytes).to.equal(0); owner.dispose();
  });
});
