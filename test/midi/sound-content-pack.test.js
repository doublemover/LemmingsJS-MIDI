import { singleSampleMap } from '../helpers/sampleMap.js';
import { expect } from 'chai';
import { canonicalDataText, hashDataText } from '../../js/core/CanonicalData.js';
import { SOUND_CONTENT_SCHEMA, prepareSoundContentPack, planSoundContentSelection } from '../../js/midi/content/SoundContentPack.js';

const copy = value => structuredClone(value);
const rejects = async (promise, message) => { let error; try { await promise; } catch (failure) { error = failure; } expect(error).to.be.instanceOf(Error); expect(error.message).to.include(message); };
describe('canonical sound material and rights closure', () => {
  let pack, engine;
  const a = 'a'.repeat(64), b = 'b'.repeat(64), secret = 'c'.repeat(64);
  before(async () => {
    const license = { id: 'fixture-terms', text: 'Synthetic fixture permission; no shipped sound asset is licensed by this text.', url: 'https://example.invalid/fixture-license' };
    license.sha256 = await hashDataText(license.text);
    const rights = (kind, declaredUse = 'redistributable') => ({ kind, creator: 'Fixture Author', sourceUrl: 'urn:fixture:original', licenseId: 'fixture-terms',
      licenseUrl: license.url, attribution: 'Fixture Author', modifications: [], declaredUse, licenseTextHash: license.sha256 });
    const file = (path, sha256, parents = [], declaredUse) => ({ path, sha256, bytes: 46, mediaType: 'audio/wav', kind: 'sample', parents, rights: rights('sample-recording', declaredUse) });
    engine = { engineId: 'native-sample', engineVersion: 1, artifactHash: 'd'.repeat(64), parameterSchemaHash: 'e'.repeat(64), parameters: [], capabilities: { samples: true, sampleMaps: true } };
    const definition = (id, sha256) => ({ schemaVersion: 2, id, revision: 1, name: id, author: 'Fixture Author', tags: [], engineId: engine.engineId, engineVersion: 1,
      parameters: {}, modulations: [], macros: [], causalBindings: [], sampleRefs: [{ id: 'material', sha256, bytes: 46, required: true }], sampleMap: singleSampleMap(sha256, { frames: 1, id: id + '-map' }),
      voicePolicy: { maxVoices: 8, steal: 'reject' }, mix: { gain01: 0.5, pan01: 0 } });
    const patch = (id, sha256) => ({ definition: definition(id, sha256), dependencies: [sha256], engineRequirement: {
      engineId: engine.engineId, engineVersion: 1, artifactHash: engine.artifactHash, parameterSchemaHash: engine.parameterSchemaHash }, rights: rights('patch-recipe') });
    pack = { schema: SOUND_CONTENT_SCHEMA, id: 'fixture-pack', version: '1.0.0', name: 'Fixture', author: 'Fixture Author', sourceUrl: 'urn:fixture:pack',
      licenseId: 'mixed', licenseUrl: null, attribution: 'Per-file fixture rights', modifications: [], redistributionPolicy: 'portable', licenses: [license],
      files: [file('samples/source.wav', a), file('samples/derived.wav', b, [a]), file('samples/private.wav', secret, [], 'private')],
      patches: [patch('derived', b), patch('private', secret)] };
  });
  const prepare = input => prepareSoundContentPack(input, { engineDescriptors: [engine] });
  const reviewed = entry => ({ decision: 'allow', receiptId: 'fixture-local-rights-review', contentHash: entry.contentHash, rightsHash: entry.rightsHash });
  it('selects only the declared patch and its ancestry while keeping credits and playability separate', async () => {
    const admitted = await prepare(pack), selected = planSoundContentSelection(admitted, ['derived@1'], { availableHashes: [a, b], reviewRights: reviewed });
    expect(selected.files.map(file => file.sha256)).to.deep.equal([a, b]); expect(selected.files.some(file => file.sha256 === secret)).to.equal(false);
    expect(selected.credits.map(entry => entry.rights.creator)).to.deep.equal(['Fixture Author', 'Fixture Author', 'Fixture Author']);
    expect(selected).to.include({ portability: 'portable-material', playability: 'definition-ready-not-auditioned', qualification: 'dependency-and-rights-preflight-only' });
    expect(admitted.qualification).to.equal('bounded-declarative-inventory-only');
    expect(planSoundContentSelection(admitted, ['derived@1']).portability).to.equal('reference-only');
    expect(planSoundContentSelection(admitted, ['private@1'], { availableHashes: [secret], reviewRights: reviewed }).portability).to.equal('reference-only');
  });
  it('normalizes unordered inventories and preserves immutable original revisions', async () => {
    const shuffled = copy(pack); shuffled.files.reverse(); shuffled.patches.reverse(); shuffled.licenses.reverse();
    expect((await prepare(shuffled)).contentHash).to.equal((await prepare(pack)).contentHash);
    const admitted = await prepare(pack); expect(Object.isFrozen(admitted.pack.files[0].rights.modifications)).to.equal(true);
    expect(admitted.patches.find(patch => patch.identity === 'derived@1').definition.revision).to.equal(1);
    expect(pack.patches[0].definition.name).to.equal('derived');
  });
  it('does not grant redistribution from imported claims or apply recipe rights to recordings', async () => {
    const raw = copy(pack); raw.files[0].rights.creator = null;
    expect(planSoundContentSelection(await prepare(raw), ['derived@1'], { reviewRights: reviewed }).portability).to.equal('reference-only');
    raw.files[0].rights.kind = 'engine-code'; await rejects(prepare(raw), 'cannot stand in');
    const changed = copy(pack); changed.licenses[0].text += 'changed'; await rejects(prepare(changed), 'hash mismatch');
  });
  it('keeps unknown engines and missing ancestor references inspectable without making them playable', async () => {
    const unknown = await prepareSoundContentPack(pack), plan = planSoundContentSelection(unknown, ['derived@1'], { availableHashes: [a, b], reviewRights: reviewed });
    expect(plan.unavailableEngines[0].state).to.equal('engine-unavailable'); expect(plan.playability).to.equal('requirements-unmet');
    expect(unknown.patches[0].archivedDefinition).to.have.property('schemaVersion', 2);
    const missing = copy(pack); missing.files = missing.files.filter(file => file.sha256 !== a);
    const unresolved = planSoundContentSelection(await prepare(missing), ['derived@1'], { availableHashes: [b], reviewRights: reviewed });
    expect(unresolved.missingReferences).to.deep.equal([a]); expect(unresolved.portability).to.equal('reference-only');
  });
  it('rejects unsafe paths, executable payload kinds, cycles, source mismatch and future manifests before publication', async () => {
    for (const path of ['../private.wav', '/private.wav', 'samples\\private.wav', 'samples/execute.js']) {
      const raw = copy(pack); raw.files[0].path = path; await rejects(prepare(raw), 'asset inventory');
    }
    const cycle = copy(pack); cycle.files[0].parents = [b]; await rejects(prepare(cycle), 'cyclic');
    const mismatch = copy(pack); mismatch.patches[0].definition.sampleRefs[0].bytes = 900; await rejects(prepare(mismatch), 'byte count differs');
    const future = copy(pack); future.schema = 'lemmings-sound-content/v99'; await rejects(prepare(future), 'unsupported pack header');
    const hidden = copy(pack); hidden.privateRecording = { world: 'unrelated project data' }; await rejects(prepare(hidden), 'unknown field');
    const abort = new AbortController(); abort.abort(); await rejects(prepareSoundContentPack(pack, { signal: abort.signal }), 'aborted');
  });
  it('uses bounded canonical own-data encoding without invoking imported accessors', () => {
    let invoked = 0; const getter = {}; Object.defineProperty(getter, 'callback', { enumerable: true, get() { invoked++; return 1; } });
    expect(() => canonicalDataText(getter)).to.throw('own data properties'); expect(invoked).to.equal(0);
    expect(canonicalDataText({ z: -0, a: 1 }).text).to.equal('{"a":1,"z":-0}');
    expect(() => canonicalDataText(new Array(2))).to.throw('own data properties');
    expect(() => canonicalDataText(Array(20).fill(0), { maxNodes: 8 })).to.throw('structural budget');
  });
});
