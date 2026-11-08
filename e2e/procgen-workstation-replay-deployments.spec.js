import { expect, test } from '@playwright/test';
import { MIN_DESKTOP_VIEWPORT } from './helpers/desktopViewports.js';
import { browserGenerationServer } from './helpers/browserGenerationServer.js';
import { createReplayDeploymentFixture, updateReplayDeployment } from './helpers/replayDeploymentFixture.js';
import { installReplayDeploymentObservers, captureReplayDeployment, inspectReplayDeployment, verifyReplayDeploymentUnchanged, qualifyReplayMigrationFrontiers } from './helpers/replayDeploymentJourney.js';

test('actual changed code and terrain deployments preserve recorded takes and refuse tampered installations', { tag: ['@boundary', '@workstation-physical-music'] }, async ({ browser }, info) => {
  test.setTimeout(480000);
  const fixture = await createReplayDeploymentFixture(), context = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, permissions: [] });
  const rows = [], tampered = [], requests = new Map(); let server, source, migration;
  const open = async build => {
    const page = await context.newPage(); await installReplayDeploymentObservers(page);
    await page.goto(server.url + 'procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
    await page.waitForURL(server.url + build.buildId + '/procgen.html?**', { timeout: 180000 });
    await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 90000 });
    await page.evaluate(() => { window.__PROCGEN_STUDIO__.transport.pause(); window.__PROCGEN_LANES__.pause(); }); return page;
  };
  const unchanged = async page => {
    const result = await page.evaluate(verifyReplayDeploymentUnchanged);
    expect(result).toMatchObject({ sameWorld: true, sameProject: true, sameDocument: true, sameContinuation: true, sameTake: true, sameChunks: true, audioContexts: 0, midiRequests: 0 }); return result;
  };
  try {
    const a = await fixture.build();
    server = await browserGenerationServer({ directory: fixture.output, unavailable: file => { requests.set(file, (requests.get(file) || 0) + 1); return false; } });
    const pageA = await open(a); source = await pageA.evaluate(captureReplayDeployment, { buildId: a.buildId });
    expect(source.recorded.buildId).toBe(a.buildId); expect(source.audioContexts).toBe(0); expect(source.midiRequests).toBe(0);
    const b = await fixture.build('code');
    expect(fixture.mutations.at(-1).afterBytes - fixture.mutations.at(-1).beforeBytes).toBe(1);
    expect(b.buildId).not.toBe(a.buildId); expect(b.manifest.codeDigest).not.toBe(a.manifest.codeDigest);
    expect(await updateReplayDeployment(pageA)).toBe('activated');
    const pageB = await open(b), changedCode = await pageB.evaluate(inspectReplayDeployment, { buildId: b.buildId, takeId: source.takeId, kind: 'actual-changed-code' });
    expect(changedCode.preflight.executionBinding.mismatches).toContain('codeDigest'); expect(changedCode.recorded.buildId).toBe(a.buildId);
    expect(changedCode.compared.compatibilityMatch).toBe(true); expect(changedCode.compared.ticksExecuted).toBe(32); rows.push(changedCode);
    await unchanged(pageA); await unchanged(pageB);
    const c = await fixture.build('asset');
    expect(fixture.mutations.at(-1).afterBytes - fixture.mutations.at(-1).beforeBytes).toBe(1);
    expect(c.buildId).not.toBe(b.buildId); expect(c.manifest.codeDigest).toBe(b.manifest.codeDigest); expect(c.manifest.assetDigest).not.toBe(b.manifest.assetDigest);
    expect(await updateReplayDeployment(pageB)).toBe('activated');
    const pageC = await open(c), changedAsset = await pageC.evaluate(inspectReplayDeployment, { buildId: c.buildId, takeId: source.takeId, kind: 'actual-changed-terrain-bytes' });
    expect(changedAsset.preflight.executionBinding.mismatches).toContain('assetDigest'); expect(changedAsset.recorded.buildId).toBe(a.buildId); rows.push(changedAsset);
    migration = await pageC.evaluate(qualifyReplayMigrationFrontiers, { takeId: source.takeId });
    expect(migration.originalLegacyUnchanged).toBe(true); expect(migration.migratedHash).toBe(migration.originalHash); expect(migration.allocations).toBe(0);
    expect(migration.unsupported.reasons).toContain('unsupported-component-codec'); expect(migration.files).toHaveLength(2);
    for (const [kind, relative, suffix] of [
      ['code', 'js/app/procgen/ProcgenLaneWorld.js', '\nglobalThis.__replayTamperProbe = true;\n'],
      ['terrain-asset', 'assets/procgen/terrain-recipes.json', '\n\n']
    ]) {
      const corruption = await fixture.corruptPublished(c, relative, suffix), target = c.buildId + '/' + relative, beforeRequests = requests.get(target) || 0;
      const fresh = await browser.newContext({ viewport: MIN_DESKTOP_VIEWPORT, permissions: [] }), page = await fresh.newPage();
      try {
        await installReplayDeploymentObservers(page); await page.goto(server.url + 'procgen.html?e2e=1&workstation=1&seed=42&lanes=2');
        await expect(page.locator('#generation-status')).toContainText('Application installation failed', { timeout: 180000 });
        const refused = await page.evaluate(() => ({ applicationStarted: !!window.__PROCGEN_STUDIO__, worldCreated: !!window.__PROCGEN_LANES__?.world,
          tamperedCodeRan: window.__replayTamperProbe === true, status: document.querySelector('#generation-status')?.textContent,
          audioContexts: window.__deploymentAudioOpens, midiRequests: window.__deploymentMidiRequests }));
        expect(refused).toMatchObject({ applicationStarted: false, worldCreated: false, tamperedCodeRan: false, audioContexts: 0, midiRequests: 0 });
        const servedCorruptedBytes = (requests.get(target) || 0) > beforeRequests; expect(servedCorruptedBytes).toBe(true);
        tampered.push({ kind, path: relative, buildId: c.buildId, beforeSha256: corruption.beforeSha256, afterSha256: corruption.afterSha256, servedCorruptedBytes, refused,
          existingA: await unchanged(pageA), existingB: await unchanged(pageB), existingC: await unchanged(pageC) });
      } finally { await fresh.close(); await corruption.restore(); }
    }
    for (const row of rows) { expect(row.allocations).toBe(0); expect(row.exact.exactQualified).toBe(false); expect(row.unchanged).toBe(true); expect(row.audioContexts).toBe(0); expect(row.midiRequests).toBe(0); }
  } finally {
    await info.attach('actual-cross-deployment-replay', { body: JSON.stringify({ source: source || null, rows, migration: migration || null, tampered,
      mutations: fixture.mutations, builds: fixture.builds.map(build => ({ buildId: build.buildId, manifest: build.manifest })),
      originalSource: fixture.source,
      scope: 'Actual immutable first-party applications with changed owned JavaScript and terrain JSON bytes, native durable source and current-runtime comparison; corrupted published code/assets fail fresh installation. Exact archived execution, listening and hardware remain unqualified.' }), contentType: 'application/json' });
    await context.close(); if (server) await server.close(); await fixture.close();
  }
});
