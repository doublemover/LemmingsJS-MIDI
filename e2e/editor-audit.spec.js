import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { installExternalAssetStubs } from './helpers/externalAssets.js';
const state = page => page.evaluate(() => window.__E2E__.getState().editor);
const apply = (page, ops) => page.evaluate(ops => window.__E2E__.editorApply(ops, { preview: { refresh: true }, returnState: 'editor' }), ops);
const field = async (page, id, value) => {
  const input = page.locator(`#${id}`);
  await expect(input).toBeEnabled();
  await input.fill(String(value));
  await input.dispatchEvent('change');
};
test.beforeEach(async ({ page }) => {
  await installExternalAssetStubs(page);
  await page.goto('/editor.html?e2e=1');
  await page.waitForFunction(() => window.__E2E__?.getState().editor?.assets?.terrain?.length);
  await apply(page, [{ type: 'level.loadText', args: { text: await fs.readFile('examples/editor-audit/orchard-gate.nxlv', 'utf8'), resetHistory: true } }]);
});
test('Every tool shortcut, brush fields, metadata, palette filter and responsive viewport', async ({ page }, testInfo) => {
  for (const [key, tool] of Object.entries({ s:'select', t:'terrain', g:'gadget', r:'trigger', m:'midi-flag', e:'entrance', x:'exit', f:'steel', b:'brush', d:'eraser' })) {
    await page.keyboard.press(`Key${key.toUpperCase()}`);
    expect((await state(page)).controller.tool).toBe(tool);
  }
  await field(page, 'editorGridSize', 8);
  await field(page, 'editorBrushSize', 3);
  await page.locator('#editorSnapToggle').uncheck();
  await page.locator('#editorEraseGadgets').check();
  let editor = await state(page);
  expect(editor.controller.gridSize).toBe(8);
  expect(editor.controller.brushSize).toBe(3);
  expect(editor.controller.snapEnabled).toBe(false);
  expect(editor.controller.eraseGadgets).toBe(true);
  for (const [id, value] of Object.entries({ editorHeaderTitle:'Metadata test', editorHeaderWidth:800, editorHeaderHeight:192, editorHeaderLemmings:12, editorHeaderSaveRequirement:8, editorHeaderTimeLimit:6, editorHeaderSpawnInterval:25, editorHeaderStartX:80, editorHeaderStartY:4 })) await field(page,id,value);
  editor = await state(page);
  expect(editor.session.level.header).toMatchObject({ TITLE:'Metadata test', WIDTH:800, HEIGHT:192, LEMMINGS:12, SAVE_REQUIREMENT:8, TIME_LIMIT:6, MAX_SPAWN_INTERVAL:25, START_X:80, START_Y:4 });
  await page.locator('#editorPaletteSearch').fill('terrain_9');
  await expect(page.locator('#editorPaletteSearch')).toHaveValue('terrain_9');
  for (const viewport of [{width:1280,height:800},{width:768,height:1024},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path:testInfo.outputPath(`editor-responsive-${viewport.width}.png`), fullPage:true });
    await expect(page.locator('#editorNewLevel')).toBeVisible();
  }
});
test('Alignment distribution replacement randomization scaling and transform flags', async ({ page }) => {
  const ops = [{type:'level.new', args:{header:{WIDTH:640,HEIGHT:160}}}];
  for (const [x,y] of [[40,60],[120,80],[240,100]]) ops.push({type:'entry.add',args:{kind:'terrain',props:{PIECE:11,X:x,Y:y}}});
  ops.push({type:'selection.set',args:{selection:[0,1,2].map(index=>({kind:'terrain',index}))}});
  expect((await apply(page,ops)).ok).toBe(true);
  for (const id of ['AlignLeft','AlignCenter','AlignRight','AlignTop','AlignMiddle','AlignBottom','DistributeX','DistributeY','BringFront','MoveForward','MoveBackward','SendBack']) {
    await page.locator(`#editorSelection${id}`).click();
    expect((await state(page)).controller.selection.length).toBe(3);
  }
  await field(page,'editorSelectionReplacePiece',9);
  await page.locator('#editorSelectionReplaceApply').click();
  expect((await state(page)).session.level.terrains.every(t=>t.props.PIECE===9)).toBe(true);
  await field(page,'editorSelectionRandomPieces','9,11');
  await field(page,'editorSelectionRandomSeed',42);
  await page.locator('#editorSelectionRandomApply').click();
  expect((await state(page)).session.level.terrains.every(t=>[9,11].includes(t.props.PIECE))).toBe(true);
  await field(page,'editorSelectionScaleX',1.5);
  await field(page,'editorSelectionScaleY',1.5);
  await page.locator('#editorSelectionTransformApply').click();
  await page.locator('summary').filter({hasText:'Placement Flags'}).click();
  for (const id of ['editorSelFlipH','editorSelFlipV','editorSelNoOverwrite','editorSelErase']) await page.locator(`#${id}`).click();
  await expect(page.locator('#editorSelOneWay')).toBeDisabled();
  await expect(page.locator('#editorSelRotate')).toBeDisabled();
  expect((await state(page)).session.level.terrains[0].props).toMatchObject({ FLIP_HORIZONTAL:true, FLIP_VERTICAL:true, NO_OVERWRITE:true, ERASE:true });
  expect((await state(page)).session.level.terrains[0].props.ONE_WAY).toBeUndefined();
  expect((await state(page)).session.level.terrains[0].props.ROTATE).toBeUndefined();
});
test('Project archive download install and malformed archive recovery', async ({ page }, testInfo) => {
  await page.evaluate(() => { window.prompt=()=> 'Audit Two Levels'; window.confirm=()=>true; window.alert=()=>{}; });
  await page.locator('.editor-project-menu summary').click();
  await page.locator('#editorProjectNew').click();
  await apply(page,[{type:'level.loadText',args:{text:await fs.readFile('examples/editor-audit/hydro-triangle.nxlv','utf8')}}]);
  await page.locator('#editorProjectAddLevel').click();
  const promise=page.waitForEvent('download');
  await page.locator('#editorProjectExportArchive').click();
  const download=await promise;
  const archivePath = testInfo.outputPath('audit-level-pack.json');
  await download.saveAs(archivePath);
  const before=(await state(page)).ui.project;
  expect(before.levelCount).toBe(2);
  await page.locator('#editorProjectInstallPackInput').setInputFiles(archivePath);
  await expect.poll(async()=> (await state(page)).ui.project.levelCount).toBe(2);
  const imported=(await state(page)).ui.project;
  expect(imported.levels.map(l=>l.title)).toEqual(['The Orchard Gate','HYDRO CHECK: TRIANGLE APPROVED']);
  await page.locator('#editorProjectInstallPackInput').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await expect.poll(async()=> (await state(page)).ui.project.levelCount).toBe(2);
  const report=page.waitForEvent('download');
  await page.locator('#editorValidationReportExport').click();
  await (await report).saveAs(testInfo.outputPath('validation-report.json'));
});

for (const slug of ['orchard-gate', 'hydro-triangle']) {
  test(`${slug} rescues all ten lemmings and survives save/reload/export`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const text = await fs.readFile(`examples/editor-audit/${slug}.nxlv`, 'utf8');
    const title = text.match(/TITLE (.*)/)[1];
    const loaded = await apply(page, [
      { type: 'level.loadText', args: { text, resetHistory: true } },
      { type: 'level.save', args: { name: title } },
      { type: 'validate.run' },
      { type: 'level.export', args: { format: 'nxlv' } }
    ]);
    expect(loaded.ok).toBe(true);
    expect(loaded.state.validation.hasErrors).toBe(false);
    const savedId = loaded.state.savedLevels.find(item => item.name === title).id;
    const exported = loaded.resources.find(resource => resource.meta?.format === 'nxlv').data;
    await page.evaluate(() => window.__E2E__.setEditorPlaytest(true));
    await page.waitForFunction(() => window.__E2E__.getState().game?.timer?.running);
    await page.evaluate(() => window.__E2E__.pause());
    let bashed = false;
    let final;
    for (let tick = 0; tick < 2400; tick += 5) {
      final = await page.evaluate(() => {
        window.__E2E__.step(5);
        return window.__E2E__.getState().game;
      });
      if (!bashed && slug === 'orchard-gate') {
        const lemming = final.lemmings.find(item => !item.removed && item.lookRight && item.x >= 250 && item.x <= 255);
        if (lemming) {
          expect(await page.evaluate(id => window.__E2E__.selectLemmingById(id), lemming.id)).toBe(true);
          await page.keyboard.press('KeyW');
          await page.keyboard.press('KeyK');
          bashed = true;
        }
      }
      if (final.victory.survivorCount === 10) break;
    }
    expect(final.victory.survivorCount).toBe(10);
    if (slug === 'orchard-gate') {
      expect(bashed).toBe(true);
      expect(final.skills.skills[6]).toBe(1);
    }
    await page.screenshot({ path: testInfo.outputPath(`${slug}-playtest.png`), fullPage: true });
    await page.evaluate(() => window.__E2E__.setEditorPlaytest(false));
    await page.waitForFunction(() => !window.__E2E__.getState().editor.playtest);
    await page.reload();
    await page.waitForFunction(() => window.__E2E__?.getState().editor?.assets?.terrain?.length);
    const reloaded = await apply(page, [
      { type: 'level.loadSaved', args: { savedId } },
      { type: 'level.export', args: { format: 'nxlv' } }
    ]);
    expect(reloaded.ok).toBe(true);
    expect(reloaded.resources.find(resource => resource.meta?.format === 'nxlv').data).toBe(exported);
    await expect(page.locator('#editorHeaderTitle')).toHaveValue(title);
    expect(errors).toEqual([]);
  });
}
