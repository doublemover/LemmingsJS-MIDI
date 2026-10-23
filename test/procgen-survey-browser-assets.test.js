import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createBrowserSurveyTrial, verifiedBrowserFiles, hexSha256 } from '../js/app/procgen/survey/ProcgenSurveyBrowserAssets.js';
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
    expect(budget.diagnostics().categories.asset.pinned).to.equal(1);
    trial.dispose(); trial.dispose(); expect(budget.diagnostics().accountedBytes).to.equal(0);
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
