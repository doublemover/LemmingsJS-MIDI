import { expect, test } from './helpers/workstationValidation.js';

test.use({ permissions: [] });
const ready = async page => {
  test.setTimeout(Math.max(test.info().timeout, 90000));
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=2');
  await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.terrain, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const studio = window.__PROCGEN_STUDIO__, probe = window.nameProbe = { puts: 0, plays: 0, fail: false };
    studio.transport.pause();
    const play = studio.transport.play.bind(studio.transport); studio.transport.play = (...args) => { probe.plays++; return play(...args); };
    const put = window.IDBObjectStore.prototype.put;
    window.IDBObjectStore.prototype.put = function(value, ...args) {
      if (this.name === 'sessions' && value?.kind === 'document') {
        probe.puts++; if (probe.fail) throw new window.DOMException('Injected document quota refusal', 'QuotaExceededError');
      }
      return put.call(this, value, ...args);
    };
    const { createProcgenSessionStorage } = await import('/js/app/procgen/workstation/ProcgenSessionStorage.js');
    probe.storage = createProcgenSessionStorage(window.indexedDB);
    probe.pending = studio.handlers.save();
  });
  const dialog = page.getByRole('dialog', { name: 'Project name', exact: true });
  await dialog.getByRole('textbox').fill('Preserved project'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => window.nameProbe.pending)).toBe(true);
};
const beginCopy = async (page, playing) => {
  await page.evaluate(async playing => {
    const studio = window.__PROCGEN_STUDIO__, probe = window.nameProbe;
    if (playing) studio.transport.play(); else studio.transport.pause();
    probe.before = studio.getDocumentState(); probe.project = studio.getProject();
    probe.stored = JSON.stringify(await probe.storage.loadDocument(probe.before.id));
    probe.plays = 0; probe.puts = 0; probe.pending = studio.handlers.saveAs();
  }, playing);
  return page.getByRole('dialog', { name: 'Save project copy', exact: true });
};

test('production project naming cancels every dismissal without writing or changing identity and restores playback once @boundary', { tag: ['@boundary', '@workstation-save-cancel'] }, async ({ page }) => {
  test.setTimeout(120000); await ready(page);
  for (const playing of [false, true]) for (const dismissal of ['cancel', 'escape', 'close', 'backdrop', 'empty', 'repeated']) {
    const dialog = await beginCopy(page, playing); await expect(dialog).toBeVisible();
    if (dismissal === 'repeated') {
      expect(await page.evaluate(async () => Promise.all(Array.from({ length: 4 }, () => window.__PROCGEN_STUDIO__.handlers.saveAs())))).toEqual([false, false, false, false]);
      await expect(page.locator('.studio-name-dialog')).toHaveCount(1);
    }
    if (dismissal === 'empty') {
      await dialog.getByRole('textbox').fill(''); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeVisible(); await expect(dialog.locator('output')).toContainText('Enter a project name');
      await expect(dialog.getByRole('textbox')).toHaveValue('');
    }
    if (dismissal === 'escape') await page.keyboard.press('Escape');
    else if (dismissal === 'close') await dialog.evaluate(element => element.close());
    else if (dismissal === 'backdrop') await page.mouse.click(4, 4);
    else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const result = await page.evaluate(async () => {
      const probe = window.nameProbe, studio = window.__PROCGEN_STUDIO__, result = await probe.pending;
      return { result, puts: probe.puts, plays: probe.plays, playing: studio.transport.getState().playing,
        sameIdentity: JSON.stringify(studio.getDocumentState()) === JSON.stringify(probe.before), sameProject: studio.getProject() === probe.project,
        sameBytes: JSON.stringify(await probe.storage.loadDocument(probe.before.id)) === probe.stored };
    });
    expect(result, `${dismissal}; playing=${playing}`).toEqual({ result: false, puts: 0, plays: playing ? 1 : 0, playing, sameIdentity: true, sameProject: true, sameBytes: true });
  }
  await page.evaluate(() => window.nameProbe.storage.close());
});

test('production project naming commits success and preserves stored identity after quota refusal in paused and playing sessions @boundary', async ({ page }) => {
  test.setTimeout(120000); await ready(page);
  for (const playing of [false, true]) {
    let dialog = await beginCopy(page, playing);
    await dialog.getByRole('textbox').fill(`Saved ${playing ? 'playing' : 'paused'} copy`); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await page.evaluate(async () => {
      const probe = window.nameProbe, studio = window.__PROCGEN_STUDIO__, result = await probe.pending;
      return { result, puts: probe.puts, plays: probe.plays, playing: studio.transport.getState().playing, changedIdentity: studio.getDocumentState().id !== probe.before.id,
        priorBytesKept: JSON.stringify(await probe.storage.loadDocument(probe.before.id)) === probe.stored };
    });
    expect(saved).toEqual({ result: true, puts: 1, plays: playing ? 1 : 0, playing, changedIdentity: true, priorBytesKept: true });
    dialog = await beginCopy(page, playing); await dialog.getByRole('textbox').fill('Refused copy');
    await page.evaluate(() => { window.nameProbe.fail = true; }); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const failed = await page.evaluate(async () => {
      const probe = window.nameProbe, studio = window.__PROCGEN_STUDIO__, result = await probe.pending; probe.fail = false;
      return { result, puts: probe.puts, plays: probe.plays, playing: studio.transport.getState().playing,
        sameIdentity: JSON.stringify(studio.getDocumentState()) === JSON.stringify(probe.before), sameProject: studio.getProject() === probe.project,
        sameBytes: JSON.stringify(await probe.storage.loadDocument(probe.before.id)) === probe.stored };
    });
    expect(failed).toEqual({ result: false, puts: 1, plays: playing ? 1 : 0, playing, sameIdentity: true, sameProject: true, sameBytes: true });
    await expect(page.locator('.studio-status')).toContainText(/storage|quota|space/i);
  }
  await page.evaluate(() => window.nameProbe.storage.close());
});
