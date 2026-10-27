import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { buildBrowserRuntime } from '../scripts/BrowserRuntimeBuild.js';
import { browserGenerationFixture } from '../test/helpers/browserGenerationFixture.js';
import { browserGenerationServer } from './helpers/browserGenerationServer.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
const applicationIdentity = page => page.evaluate(async () => (await import(new URL('./js/runtime/ActiveExecutionIdentity.js', location.href))).getActiveExecutionIdentity());
async function updateGeneration(page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration(); await registration.update();
    const worker = registration.installing; if (!worker) return registration.active?.state;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('Worker update did not reach a terminal state.')); }, 60000);
      const changed = () => { if (worker.state === 'activated' || worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(worker.state); } };
      worker.addEventListener('statechange', changed); changed();
    });
  });
}

test('a fresh real application install supports every offline entry without another online reload', { tag: '@boundary' }, async ({ browser }) => {
  test.setTimeout(240000);
  const output = path.join(repository, 'dist', 'browser-offline-e2e-' + randomUUID()), build = await buildBrowserRuntime({ rootDir: repository, outputDir: output });
  const server = await browserGenerationServer({ directory: output }), context = await browser.newContext(), page = await context.newPage();
  try {
    await page.goto(server.url); await page.waitForURL(server.url + build.buildId + '/index.html', { timeout: 180000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    expect((await applicationIdentity(page)).buildId).toBe(build.buildId);
    await context.setOffline(true);
    for (const route of build.manifest.routes) {
      const response = await page.goto(server.url + route);
      expect(response.status()).toBe(200); expect(response.fromServiceWorker()).toBe(true);
      expect(page.url()).toBe(server.url + build.buildId + '/' + route);
      expect((await applicationIdentity(page)).activeExecution).toBe('bound');
    }
    const resources = await page.evaluate(async () => Promise.all(['css/game.css', 'js/app/boot.js', 'js/steelSpritesData.js'].map(async file => {
      const response = await fetch(new URL(file, location.href)); return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    })));
    expect(resources.every(value => value.status === 200 && value.bytes > 0)).toBe(true);
    await page.reload(); expect((await applicationIdentity(page)).buildId).toBe(build.buildId);
    const replay = await page.evaluate(async () => {
      const base = new URL('./js/app/procgen/survey/', location.href);
      const { createActiveBrowserSurveySourceManifest } = await import(new URL('ProcgenSurveyExecution.js', base));
      const { normalizeSurveyScenario } = await import(new URL('ProcgenSurveyScenario.js', base));
      const { createBrowserSurveyReplaySession } = await import(new URL('ProcgenSurveyReplaySession.js', base));
      const { compareSurveyBoundReplay } = await import(new URL('ProcgenSurveyReplay.js', base));
      const raw = { id: 'browser-build-identity', horizonTicks: 32, checkpointEvery: 16 }, sourceManifest = await createActiveBrowserSurveySourceManifest({ scenarios: [raw] });
      const scenario = normalizeSurveyScenario({ ...raw, engineCommit: sourceManifest.engineCommit, assetHashes: sourceManifest.assetHashes });
      const run = async () => {
        const session = await createBrowserSurveyReplaySession({ scenario, sourceManifest });
        try { while (!session.done) await session.step(16); return { result: await session.result(), verification: session.sourceVerification }; }
        finally { session.dispose(); }
      };
      const original = await run(), repeated = await run();
      const receipt = compareSurveyBoundReplay(original.result, repeated.result, repeated.verification, sourceManifest.executionIdentity);
      const forged = structuredClone(sourceManifest);
      forged.codeHashes = Object.fromEntries(Object.entries(forged.codeHashes).slice(0, 3));
      const bytes = new TextEncoder().encode(JSON.stringify(forged.codeHashes));
      forged.codeDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
      let rejected = false; try { const unexpected = await createBrowserSurveyReplaySession({ scenario, sourceManifest: forged }); unexpected.dispose(); } catch { rejected = true; }
      const cancel = new AbortController(), abandoned = createBrowserSurveyReplaySession({ scenario, sourceManifest, signal: cancel.signal }); cancel.abort();
      let canceled = false; try { await abandoned; } catch { canceled = true; }
      return { matched: receipt.matched, execution: receipt.executionIdentity.status, originalRealm: original.verification.executionIdentity.realmId,
        repeatedRealm: repeated.verification.executionIdentity.realmId, forgedRejected: rejected, canceled };
    });
    expect(replay).toMatchObject({ matched: true, execution: 'bound', forgedRejected: true, canceled: true });
    expect(replay.repeatedRealm).not.toBe(replay.originalRealm);
  } finally {
    await context.close(); await server.close();
    const resolved = path.resolve(output);
    if (path.dirname(resolved) !== path.join(repository, 'dist') || !path.basename(resolved).startsWith('browser-offline-e2e-')) throw new Error('Unexpected offline fixture cleanup path.');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('a failed B stays unavailable and a complete B retains the live A generation', async ({ browser }) => {
  test.setTimeout(180000);
  const fixture = await browserGenerationFixture(); let missing = null;
  const a = await fixture.build(), server = await browserGenerationServer({ directory: path.join(fixture.root, 'dist/browser'), unavailable: file => file === missing });
  const context = await browser.newContext(), oldPage = await context.newPage();
  try {
    await oldPage.goto(server.url); await oldPage.waitForURL(server.url + a.buildId + '/index.html');
    await oldPage.waitForFunction(() => !!globalThis.fixtureIdentity); const identityA = await applicationIdentity(oldPage);
    await oldPage.evaluate(() => { globalThis.performanceMarker = 123; });
    await fs.writeFile(path.join(fixture.root, 'classic/MAIN.DAT'), 'generation B'); const b = await fixture.build();
    missing = b.buildId + '/js/entry.js'; expect(await updateGeneration(oldPage)).toBe('redundant');
    expect((await applicationIdentity(oldPage)).buildId).toBe(a.buildId);
    missing = null; expect(await updateGeneration(oldPage)).toBe('activated');
    expect(await oldPage.evaluate(() => globalThis.performanceMarker)).toBe(123);
    expect((await applicationIdentity(oldPage)).realmId).toBe(identityA.realmId);
    const nextPage = await context.newPage(); await nextPage.goto(server.url); await nextPage.waitForURL(server.url + b.buildId + '/index.html');
    expect((await applicationIdentity(nextPage)).buildId).toBe(b.buildId);
    expect(await nextPage.evaluate(async identity => (await import(new URL('./js/runtime/ActiveExecutionIdentity.js', location.href))).compareActiveExecutionIdentity(identity).matched, identityA)).toBe(false);
    await context.setOffline(true); await oldPage.reload(); expect((await applicationIdentity(oldPage)).buildId).toBe(a.buildId);
    expect(await oldPage.evaluate(async () => (await fetch(new URL('./js/entry.js?rev=wrong', location.href))).status)).toBe(503);
  } finally { await context.close(); await server.close(); await fixture.close(); }
});
