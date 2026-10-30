import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalDataText } from '../js/core/CanonicalData.js';
import { extendSoundIdentityLedger, loadSoundIdentityLedger } from '../scripts/SoundContentIdentityLedger.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const prepared = (version = '1.0.0', revision = 1, gain = 0.5) => {
  const pack = { id: 'identity-fixture', version, patches: [{ definition: { id: 'identity.patch', revision, parameters: { gain } } }] };
  return { pack, contentHash: digest(canonicalDataText(pack).text) };
};
describe('published sound identity history', () => {
  it('preserves retired identities and rejects changed bytes without mutating prior history', () => {
    const first = extendSoundIdentityLedger(null, [prepared()]), snapshot = JSON.stringify(first);
    const second = extendSoundIdentityLedger(first.ledger, [prepared('2.0.0', 2, 0.7)]);
    expect(second.ledger.packs).to.have.length(2); expect(second.ledger.patches).to.have.length(2);
    expect(() => extendSoundIdentityLedger(second.ledger, [prepared('1.0.0', 3, 0.9)])).to.throw('pack conflicts');
    expect(() => extendSoundIdentityLedger(second.ledger, [prepared('3.0.0', 1, 0.9)])).to.throw('patch conflicts');
    expect(JSON.stringify(first)).to.equal(snapshot);
    expect(extendSoundIdentityLedger(second.ledger, [prepared()]).text).to.equal(second.text);
  });
  it('binds compiled effective mappings as well as the patch entry', () => {
    const first = prepared(); first.pack.compilation = { artifacts: [{ id: 'identity.patch', revision: 1, renderKey: 'a'.repeat(64) }] };
    first.contentHash = digest(canonicalDataText(first.pack).text);
    const ledger = extendSoundIdentityLedger(null, [first]);
    const changed = structuredClone(first); changed.pack.version = '2.0.0'; changed.pack.compilation.artifacts[0].renderKey = 'b'.repeat(64);
    changed.contentHash = digest(canonicalDataText(changed.pack).text);
    expect(() => extendSoundIdentityLedger(ledger.ledger, [changed])).to.throw('patch conflicts');
  });
  it('rejects fabricated hashes and conflicting or unsupported history', () => {
    expect(() => extendSoundIdentityLedger(null, [{ ...prepared(), contentHash: 'a'.repeat(64) }])).to.throw('content hash');
    const prior = extendSoundIdentityLedger(null, [prepared()]).ledger;
    prior.patches.push({ ...prior.patches[0], contentHash: 'b'.repeat(64) });
    expect(() => extendSoundIdentityLedger(prior)).to.throw('patch conflicts');
    expect(() => extendSoundIdentityLedger({ schema: 'future', packs: [], patches: [] })).to.throw('Unsupported');
  });
  let directory;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sound-identities-')); });
  afterEach(async () => {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('sound-identities-')) throw new Error('Unexpected fixture cleanup target.');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const publish = async content => {
    const catalog = canonicalDataText({ schema: 'lemmings-sound-catalog/v1', packs: [{ id: content.pack.id, version: content.pack.version,
      contentHash: content.contentHash, manifest: content.contentHash + '/pack.json' }] }).text + '\n';
    const catalogHash = digest(catalog), folder = path.join(directory, catalogHash, content.contentHash);
    await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, 'pack.json'), canonicalDataText(content.pack).text + '\n');
    await fs.writeFile(path.join(directory, catalogHash, 'catalog.json'), catalog);
    return { catalogHash, path: catalogHash + '/catalog.json' };
  };
  it('bootstraps all prior immutable catalogs rather than only the current head', async () => {
    await publish(prepared()); const head = await publish(prepared('2.0.0', 2, 0.7));
    const ledger = await loadSoundIdentityLedger({ outputDir: directory, head });
    expect(ledger.packs).to.have.length(2);
    expect(() => extendSoundIdentityLedger(ledger, [prepared('3.0.0', 1, 0.9)])).to.throw('patch conflicts');
  });
  it('loads the exact canonical ledger and detects changed bytes before reuse', async () => {
    const publication = extendSoundIdentityLedger(null, [prepared()]), identityPath = publication.identityHash + '.identities.json';
    await fs.writeFile(path.join(directory, identityPath), publication.text);
    const head = { identityHash: publication.identityHash, identityPath };
    expect(await loadSoundIdentityLedger({ outputDir: directory, head })).to.deep.equal(publication.ledger);
    await fs.appendFile(path.join(directory, identityPath), ' ');
    let error; try { await loadSoundIdentityLedger({ outputDir: directory, head }); } catch (failure) { error = failure; }
    expect(error.message).to.include('hash changed');
  });
  it('does not replace a missing historical head with an empty library', async () => {
    let error; try { await loadSoundIdentityLedger({ outputDir: directory, head: { catalogHash: 'a'.repeat(64) } }); } catch (failure) { error = failure; }
    expect(error.message).to.include('no immutable source catalog');
  });
});
