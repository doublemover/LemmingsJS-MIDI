import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createBrowserSurveyTrial, verifiedBrowserFiles, hexSha256, surveyDecodeBytes, MAX_SOURCE_BYTES } from '../js/app/procgen/survey/ProcgenSurveyBrowserAssets.js';
import { normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { createSurveySourceManifest, createNodeSurveyTrial } from '../scripts/procgen-survey/SurveyNodeWorld.js';
import { SURVEY_STATE_SCHEMA, SURVEY_CANONICAL_SCHEMA } from '../js/app/procgen/survey/ProcgenSurveyCanonical.js';
import { createResourceBudget } from '../js/app/resources/ResourceBudget.js';
import { createBrowserSurveyReplaySession } from '../js/app/procgen/survey/ProcgenSurveyReplaySession.js';

const fileFetch = async url => {
  const data = await fs.readFile(url);
  return new globalThis.Response(data);
};
const copy = value => JSON.parse(JSON.stringify(value));
const rejects = async (operation, message) => {
  let failure = null; try { await operation(); } catch (error) { failure = error; }
  expect(failure, 'expected a failed verified replay').to.be.instanceOf(Error); expect(failure.message).to.include(message);
};
describe('verified selected browser survey asset contracts', function() {
  this.timeout(30000); let sourceManifest, controlled, generated;
  before(async () => {
    const scenes = [normalizeSurveyScenario({ id: 'verified-flat', horizonTicks: 64 }), normalizeSurveyScenario({ id: 'verified-real-source', mode: 'generated', pack: 'lemmings_ohNo', groundSet: 0, horizonTicks: 192, laneHeight: 144 })];
    sourceManifest = await createSurveySourceManifest(scenes);
    expect(sourceManifest.canonicalStateVersion).to.equal(SURVEY_STATE_SCHEMA);
    expect(sourceManifest.canonicalEncodingVersion).to.equal(SURVEY_CANONICAL_SCHEMA);
    expect(sourceManifest.executionIdentity.status).to.equal('unbound');
    [controlled, generated] = scenes.map(scene => normalizeSurveyScenario({ ...scene, engineCommit: sourceManifest.engineCommit, assetHashes: sourceManifest.assetHashes }));
  });
  it('decodes real masks and preserves headless controlled physical and logical hashes', async () => {
    const browser = await createBrowserSurveyTrial({ scenario: controlled, sourceManifest, fetchFile: fileFetch });
    const node = await createNodeSurveyTrial({ scenario: controlled });
    browser.step(64); node.step(64);
    expect(browser.result()).to.deep.equal(node.result()); expect(browser.sourceVerification.codeDigest).to.equal(sourceManifest.codeDigest);
    expect(browser.sourceVerification.codeFiles).to.equal(Object.keys(sourceManifest.codeHashes).length);
    expect(browser.sourceVerification).to.include({ artifactIntegrity: 'verified', activeExecution: 'unbound' });
    browser.dispose(); node.dispose();
  });
  it('uses fresh exact source terrain with the same generated ownership, physics and events as Node', async () => {
    const browser = await createBrowserSurveyTrial({ scenario: generated, sourceManifest, fetchFile: fileFetch });
    const node = await createNodeSurveyTrial({ scenario: generated });
    expect(browser.world.terrain).not.to.equal(node.world.terrain); expect(browser.initialScenarioStateHash).to.equal(node.initialScenarioStateHash);
    browser.step(192); node.step(192); expect(browser.result()).to.deep.equal(node.result());
    const before = browser.snapshot(); for (let at = 0; at < 20; at++) browser.preview(); expect(browser.snapshot()).to.deep.equal(before);
    browser.dispose(); node.dispose();
  });
  it('refuses changed saved source bytes and changed scenario provenance before creating a trial', async () => {
    let requested = 0;
    await rejects(() => createBrowserSurveyTrial({ scenario: { ...controlled, engineCommit: 'a'.repeat(40) }, sourceManifest, fetchFile: async () => { requested++; } }), 'Scenario source identity');
    expect(requested).to.equal(0);
    await rejects(() => createBrowserSurveyTrial({ scenario: controlled, sourceManifest, fetchFile: async (url, options) => {
      expect(options).to.include({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
      if (url.pathname.endsWith('/ProcgenSurveyCore.js')) return new globalThis.Response('stale code');
      return fileFetch(url);
    } }), 'differs from the saved trial');
  });
  it('compares saved physical assets under current modules without requiring historical executable files', async () => {
    const historical = copy(sourceManifest), requested = [];
    for (const name of Object.keys(historical.codeHashes)) historical.codeHashes[name] = 'a'.repeat(64);
    historical.codeDigest = await hexSha256(new TextEncoder().encode(JSON.stringify(historical.codeHashes)));
    const browser = await createBrowserSurveyTrial({ scenario: controlled, sourceManifest: historical, artifactPolicy: 'saved-assets-only', fetchFile: async url => {
      requested.push(url.pathname); expect(url.pathname).not.to.match(/\.[cm]?js$/); return fileFetch(url);
    } });
    const node = await createNodeSurveyTrial({ scenario: controlled });
    try {
      browser.step(64); node.step(64); expect(browser.result()).to.deep.equal(node.result());
      expect(browser.sourceVerification).to.include({ activeExecution: 'unbound', artifactIntegrity: 'assets-verified',
        codeArtifactIntegrity: 'not-checked', codeFiles: 0, declaredCodeFiles: Object.keys(historical.codeHashes).length });
      expect(requested).to.have.length(Object.keys(historical.assetHashes).length);
    } finally { browser.dispose(); node.dispose(); }
    await rejects(() => createBrowserSurveyTrial({ scenario: controlled, sourceManifest: historical, artifactPolicy: 'saved-assets-only',
      fetchFile: async () => new globalThis.Response('changed physical asset') }), 'differs from the saved trial');
    let requests = 0;
    await rejects(() => createBrowserSurveyTrial({ scenario: controlled, sourceManifest: historical, mode: 'exact', artifactPolicy: 'saved-assets-only',
      fetchFile: async () => { requests++; } }), 'complete saved source and asset inventory');
    expect(requests).to.equal(0);
  });
  it('verifies the declared stretch WASM and rejects other asset code paths before fetching', async () => {
    const manifest = copy(sourceManifest), name = 'assets/audio/signalsmith-stretch-core.wasm';
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    manifest.codeHashes[name] = await hexSha256(bytes);
    manifest.codeDigest = await hexSha256(new TextEncoder().encode(JSON.stringify(manifest.codeHashes)));
    let wasmReads = 0;
    const verified = await verifiedBrowserFiles(manifest, url => {
      if (url.pathname.endsWith('/' + name)) { wasmReads++; return new globalThis.Response(bytes); }
      return fileFetch(url);
    });
    try { expect(wasmReads).to.equal(1); expect(verified.verification.codeFiles).to.equal(Object.keys(manifest.codeHashes).length); }
    finally { await verified.release().completion; }
    for (const invalid of ['assets/audio/other.wasm', 'assets/audio/../signalsmith-stretch-core.wasm', 'assets/audio//signalsmith-stretch-core.wasm']) {
      const rejected = copy(manifest); delete rejected.codeHashes[name]; rejected.codeHashes[invalid] = manifest.codeHashes[name];
      rejected.codeDigest = await hexSha256(new TextEncoder().encode(JSON.stringify(rejected.codeHashes)));
      let reads = 0;
      await rejects(() => verifiedBrowserFiles(rejected, () => { reads++; throw new Error('Unexpected fetch'); }), 'Unsupported replay source path');
      expect(reads).to.equal(0);
    }
  });
  it('rejects exact qualification before execution when active modules have no trusted build identity', async () => {
    let requests = 0;
    await rejects(() => createBrowserSurveyTrial({ scenario: controlled, sourceManifest, mode: 'exact',
      fetchFile: async () => { requests++; return fileFetch(); } }), 'Active execution identity is unbound');
    expect(requests).to.equal(0);
    let workers = 0;
    await rejects(() => createBrowserSurveyReplaySession({ scenario: controlled, sourceManifest, Worker: class { constructor() { workers++; } } }), 'recorded immutable browser build');
    expect(workers).to.equal(0);
  });
  it('admits preparation before fetching and retains source reservations through disposal', async () => {
    const denied = createResourceBudget({ limitBytes: 4096 }); let requests = 0;
    await rejects(() => verifiedBrowserFiles(sourceManifest, async () => { requests++; }, null, { resourceBudget: denied }), 'accounted bytes');
    expect(requests).to.equal(0); expect(denied.diagnostics().accountedBytes).to.equal(0);
    const budget = createResourceBudget({ limitBytes: 256 * 1048576 });
    const trial = await createBrowserSurveyTrial({ scenario: controlled, sourceManifest, fetchFile: fileFetch, resourceBudget: budget });
    expect(budget.diagnostics().categories.asset.pinned).to.equal(2);
    expect(budget.diagnostics().categories.candidate.pinned).to.equal(1);
    trial.dispose(); trial.dispose(); expect(trial.world).to.equal(null); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects oversized declared source responses before reading or allocating them', async () => {
    const budget = createResourceBudget({ limitBytes: 256 * 1048576 }); let reads = 0;
    await rejects(() => verifiedBrowserFiles(sourceManifest, async () => ({ ok: true, headers: { get: () => String(17 * 1048576) },
      body: { getReader() { reads++; throw new Error('Must not read.'); } } }), null, { resourceBudget: budget }), 'exceeds its bound');
    expect(reads).to.equal(0); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('requires a complete relative module closure and refuses external or traversing source paths', async () => {
    const incomplete = copy(sourceManifest); delete incomplete.codeHashes['js/app/procgen/ProcgenLanePolicy.js'];
    incomplete.codeDigest = await hexSha256(new TextEncoder().encode(JSON.stringify(incomplete.codeHashes)));
    await rejects(() => verifiedBrowserFiles(incomplete, fileFetch), 'dependency is missing');
    for (const name of ['../secret.js', 'https://example.com/code.js', 'js/../../secret.js']) {
      const unsafe = copy(sourceManifest); unsafe.codeHashes[name] = 'a'.repeat(64);
      await rejects(() => verifiedBrowserFiles(unsafe, fileFetch), 'Unsupported replay source path');
    }
    const missing = copy(sourceManifest); delete missing.codeHashes['js/app/procgen/survey/ProcgenSurveyBrowserAssets.js'];
    await rejects(() => verifiedBrowserFiles(missing, fileFetch), 'missing from provenance');
    const corrupt = copy(sourceManifest); corrupt.codeDigest = '0'.repeat(64);
    await rejects(() => verifiedBrowserFiles(corrupt, fileFetch), 'digest mismatch');
  });
  it('aborts obsolete verification before issuing requests or creating a replay', async () => {
    const aborted = new AbortController(); aborted.abort(); let requests = 0;
    await rejects(() => createBrowserSurveyTrial({ scenario: controlled, sourceManifest, signal: aborted.signal, fetchFile: async () => { requests++; } }), 'aborted');
    expect(requests).to.equal(0);
    const during = new AbortController();
    await rejects(() => verifiedBrowserFiles(sourceManifest, async (url, options) => {
      expect(options.signal.aborted).to.equal(false); requests++; during.abort(); expect(options.signal.aborted).to.equal(true); return fileFetch(url);
    }, during.signal), 'aborted');
    expect(requests).to.equal(1);
  });

});

describe('stream aggregate and decoder expansion ownership', () => {
  const manifest = async (assetHashes = {}) => {
    const hash = await hexSha256(new Uint8Array()), codeHashes = Object.fromEntries(['js/app/procgen/survey/ProcgenSurveyBrowserAssets.js', 'js/app/procgen/survey/ProcgenSurveyCore.js', 'js/steelSpritesData.js'].map(path => [path, hash]));
    return { schemaVersion: 2, engineCommit: 'a'.repeat(64), codeHashes, assetHashes, codeDigest: await hexSha256(new TextEncoder().encode(JSON.stringify(codeHashes))) };
  };
  it('retains source storage until late aborted stream producers actually settle', async () => {
    const source = await manifest({ 'lemmings_ohNo/MAIN.DAT': 'a'.repeat(64) }), budget = createResourceBudget({ limitBytes: 256 * 1048576 }), abort = new AbortController(), pending = [];
    let ready; const started = new Promise(resolve => { ready = resolve; });
    const fetchFile = async () => ({ ok: true, headers: { get: () => null }, body: { getReader(options) {
      if (options) throw new Error('No BYOB');
      return { read: () => new Promise(resolve => { pending.push(resolve); if (pending.length === 4) ready(); }), cancel() {}, releaseLock() {} };
    } } });
    let failure; const reading = verifiedBrowserFiles(source, fetchFile, abort.signal, { resourceBudget: budget }).catch(error => { failure = error; });
    await started; abort.abort(new Error('obsolete')); await reading;
    expect(failure.message).to.equal('obsolete'); expect(failure.retirement.outcome).to.equal('pending');
    expect(budget.diagnostics().accountedBytes).to.be.greaterThan(MAX_SOURCE_BYTES);
    for (const resolve of pending) resolve({ done: true });
    await failure.retirement.completion; expect(failure.retirement.outcome).to.equal('complete'); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects aggregate bytes before a fifth legal-size file can materialize', async () => {
    const data = new Uint8Array(16 * 1048576), hash = await hexSha256(data), hashes = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`pack/GROUND${i}O.DAT`, hash]));
    const source = await manifest(hashes), budget = createResourceBudget({ limitBytes: 256 * 1048576 }); let requested = 0;
    await rejects(() => verifiedBrowserFiles(source, async url => {
      if (url.pathname.endsWith('.js')) return new globalThis.Response(new Uint8Array());
      requested++; let at = 0;
      return new globalThis.Response(new globalThis.ReadableStream({ pull(controller) {
        if (at === data.length) controller.close(); else { controller.enqueue(data.subarray(at, at + 1048576)); at += 1048576; }
      } }), { headers: { 'content-length': '1' } });
    }, null, { resourceBudget: budget }), 'aggregate stream byte budget');
    expect(requested).to.equal(5); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('rejects four oversized streams despite absent or lying Content-Length', async () => {
    const source = await manifest({ 'pack/MAIN.DAT': 'a'.repeat(64) }), budget = createResourceBudget({ limitBytes: 256 * 1048576 }); let requested = 0;
    await rejects(() => verifiedBrowserFiles(source, async () => {
      requested++; return { ok: true, headers: { get: () => requested % 2 ? null : '1' }, body: { getReader(options) {
        if (options) throw new Error('No BYOB');
        return { read: async () => ({ done: false, value: new Uint8Array(17 * 1048576) }), cancel() {}, releaseLock() {} };
      } } };
    }, null, { resourceBudget: budget }), 'exceeds its bound');
    expect(requested).to.equal(4); expect(budget.diagnostics().accountedBytes).to.equal(0);
  });
  it('admits pixel and container expansion before invoking decoders', () => {
    const files = new Map([['lemmings_ohNo/MAIN.DAT', new Uint8Array(0)], ['pack/VGAGR0.DAT', new Uint8Array(0)], ['pack/GROUND0O.DAT', new Uint8Array(1056)]]);
    const scenario = { mode: 'generated', pack: 'pack', groundSet: 0 };
    expect(surveyDecodeBytes(scenario, files)).to.equal(1048576);
    const ground = files.get('pack/GROUND0O.DAT'); ground[3] = 255; ground[4] = 255; ground[5] = 255;
    expect(() => surveyDecodeBytes(scenario, files)).to.throw('decoder expansion');
    ground.fill(0); const tinyParts = new Uint8Array(651); for (let at = 0; at < 650; at += 10) tinyParts[at + 9] = 10; files.set('pack/VGAGR0.DAT', tinyParts);
    expect(() => surveyDecodeBytes(scenario, files)).to.throw('part metadata');
  });
});
