import { expect } from 'chai';
import fs from 'node:fs/promises';
import { createBrowserSurveyTrial, verifiedBrowserFiles, hexSha256 } from '../js/app/procgen/survey/ProcgenSurveyBrowserAssets.js';
import { normalizeSurveyScenario } from '../js/app/procgen/survey/ProcgenSurveyCore.js';
import { createSurveySourceManifest, createNodeSurveyTrial } from '../scripts/procgen-survey/SurveyNodeWorld.js';

const fileFetch = async url => {
  const data = await fs.readFile(url);
  return { ok: true, status: 200, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
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
    [controlled, generated] = scenes.map(scene => normalizeSurveyScenario({ ...scene, engineCommit: sourceManifest.engineCommit, assetHashes: sourceManifest.assetHashes }));
  });
  it('decodes real masks and preserves headless controlled physical and logical hashes', async () => {
    const browser = await createBrowserSurveyTrial({ scenario: controlled, sourceManifest, fetchFile: fileFetch });
    const node = await createNodeSurveyTrial({ scenario: controlled });
    browser.step(64); node.step(64);
    expect(browser.result()).to.deep.equal(node.result()); expect(browser.sourceVerification.codeDigest).to.equal(sourceManifest.codeDigest);
    expect(browser.sourceVerification.codeFiles).to.equal(Object.keys(sourceManifest.codeHashes).length);
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
      if (url.pathname.endsWith('/ProcgenSurveyCore.js')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('stale code').buffer };
      return fileFetch(url);
    } }), 'differs from the saved trial');
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
});
