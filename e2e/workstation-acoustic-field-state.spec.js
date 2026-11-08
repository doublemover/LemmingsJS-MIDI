import { expect, test } from '@playwright/test';

const mountEditor = async page => {
  await page.route('**/__state-audit-acoustics__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/css/procgen-workstation.css"></head><body><button id="return-focus">Acoustic fields</button></body></html>' }));
  await page.goto('/__state-audit-acoustics__');
  await page.evaluate(async () => {
    const [{ createAcousticFieldEditor }, { createOriginalAcousticMap, createOriginalAcousticZone }, { validateAcousticMap }] = await Promise.all([
      import('/js/app/procgen/workstation/AcousticFieldEditor.js'), import('/js/midi/content/OriginalAcousticMap.js'), import('/js/midi/content/AcousticMap.js')]);
    const initial = createOriginalAcousticMap({ zones: [createOriginalAcousticZone({ zoneId: 'initial-field', materialResponseId: 'felt', worldRegion: { kind: 'rectangle', bounds: { x1: 40, y1: 40, x2: 160, y2: 160 } } })] });
    let revision = 1, graph = { version: 1, revision: 1, instruments: [], acousticMap: initial }; const commits = [];
    const world = { worldId: 'acoustic-state-audit', generation: 1, tickIndex: 0, terrainRevision: 0, actors: [], leftEdgeX: 0, width: 512, height: 288, laneCount: 3, laneHeight: 96,
      baseGroundAt: () => 0, editChunks: new Map(), terrainTileRevisions: new Map(), _editKey: () => 0 };
    const editor = createAcousticFieldEditor({ document, window, getGraph: () => graph, getWorld: () => world, getIdentity: () => ({ documentId: 'audit', revision }),
      commit: async edit => { graph = { ...graph, revision: ++revision, acousticMap: validateAcousticMap({ ...edit.map, revision }) }; commits.push(graph.acousticMap); } });
    window.__ACOUSTIC_STATE_AUDIT__ = { editor, initial, commits, graph: () => graph };
    document.getElementById('return-focus').focus(); editor.open();
  });
  return page.getByRole('dialog', { name: 'Acoustic fields and world listener', exact: true });
};

test('acoustic draft stays editable through publication, reload and repeated typed edits', { tag: ['@boundary', '@workstation-typed-controls'] }, async ({ page }) => {
  const dialog = await mountEditor(page);
  await dialog.getByLabel('Priority', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Apply selected field', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Acoustic field saved.');
  await dialog.getByLabel('Priority', { exact: true }).fill('4');
  await dialog.getByRole('button', { name: 'Apply selected field', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__ACOUSTIC_STATE_AUDIT__.commits.length)).toBe(2);
  await dialog.getByRole('button', { name: 'Reload fields from score', exact: true }).click();
  await dialog.getByLabel('Priority', { exact: true }).fill('5');
  await dialog.getByRole('button', { name: 'Apply selected field', exact: true }).click();
  expect(await page.evaluate(() => { const state = window.__ACOUSTIC_STATE_AUDIT__; return { priorities: state.commits.map(map => map.zones[0].priority), original: state.initial.zones[0].priority, frozen: Object.isFrozen(state.commits[0].zones[0]) }; })).toEqual({ priorities: [3, 4, 5], original: 0, frozen: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#return-focus')).toBeFocused();
});

test('canceling a preview gesture leaves a mutable retry draft and newly drawn fields remain editable', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const dialog = await mountEditor(page);
  const preview = dialog.locator('canvas').first();
  await dialog.getByLabel('Preview tool', { exact: true }).selectOption('pan');
  await preview.scrollIntoViewIfNeeded(); let box = await preview.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4); await preview.evaluate(element => element.releasePointerCapture(1)); await page.mouse.up();
  await dialog.getByLabel('Priority', { exact: true }).fill('2'); await dialog.getByRole('button', { name: 'Apply selected field', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__ACOUSTIC_STATE_AUDIT__.commits.length)).toBe(1);
  await dialog.getByLabel('Preview tool', { exact: true }).selectOption('rectangle'); await preview.scrollIntoViewIfNeeded(); box = await preview.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.3); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 4 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__ACOUSTIC_STATE_AUDIT__.commits.length)).toBe(2);
  await dialog.getByLabel('Priority', { exact: true }).fill('6'); await dialog.getByRole('button', { name: 'Apply selected field', exact: true }).click();
  expect(await page.evaluate(() => window.__ACOUSTIC_STATE_AUDIT__.graph().acousticMap.zones.map(zone => zone.priority))).toEqual([2, 6]);
  expect(errors).toEqual([]); await dialog.getByRole('button', { name: 'Close', exact: true }).click();
});
