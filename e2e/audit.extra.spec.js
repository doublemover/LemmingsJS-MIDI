import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const state = page => page.evaluate(() => window.__E2E__.getState().editor);
const apply = (page, ops) => page.evaluate(ops => window.__E2E__.editorApply(ops, { preview: { refresh: true }, returnState: 'editor' }), ops);
const field = (page, id, value) => page.locator(`#${id}`).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }, String(value));
test.beforeEach(async ({ page }) => {
  await page.route(/https:\/\//, route => route.abort());
  await page.goto('/editor.html?e2e=1');
  await page.waitForFunction(() => window.__E2E__?.getState().editor?.assets?.terrain?.length);
  await apply(page, [{ type: 'level.loadText', args: { text: await fs.readFile('evidence/levels/orchard-gate.nxlv', 'utf8'), resetHistory: true } }]);
});
test('Every tool shortcut, brush fields, metadata, palette filter and responsive viewport', async ({ page }) => {
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
    await page.screenshot({ path:`evidence/editor-responsive-${viewport.width}.png`, fullPage:true });
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
  for (const id of ['editorSelFlipH','editorSelFlipV','editorSelNoOverwrite','editorSelErase','editorSelOneWay']) await page.locator(`#${id}`).click();
  await field(page,'editorSelRotate',90);
  expect((await state(page)).session.level.terrains[0].props).toMatchObject({ FLIP_HORIZONTAL:true, FLIP_VERTICAL:true, NO_OVERWRITE:true, ERASE:true, ONE_WAY:true, ROTATE:90 });
});
test('Project archive download install and malformed archive recovery', async ({ page }) => {
  await page.evaluate(() => { window.prompt=()=> 'Audit Two Levels'; window.confirm=()=>true; window.alert=()=>{}; });
  await page.locator('.editor-project-menu summary').click();
  await page.locator('#editorProjectNew').click();
  await apply(page,[{type:'level.loadText',args:{text:await fs.readFile('evidence/levels/hydro-triangle.nxlv','utf8')}}]);
  await page.locator('#editorProjectAddLevel').click();
  const promise=page.waitForEvent('download');
  await page.locator('#editorProjectExportArchive').click();
  const download=await promise;
  await download.saveAs('evidence/levels/audit-level-pack.json');
  const before=(await state(page)).ui.project;
  expect(before.levelCount).toBe(2);
  await page.locator('#editorProjectInstallPackInput').setInputFiles('evidence/levels/audit-level-pack.json');
  await expect.poll(async()=> (await state(page)).ui.project.levelCount).toBe(2);
  const imported=(await state(page)).ui.project;
  expect(imported.levels.map(l=>l.title)).toEqual(['The Orchard Gate','HYDRO CHECK: TRIANGLE APPROVED']);
  await page.locator('#editorProjectInstallPackInput').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await expect.poll(async()=> (await state(page)).ui.project.levelCount).toBe(2);
  const report=page.waitForEvent('download');
  await page.locator('#editorValidationReportExport').click();
  await (await report).saveAs('evidence/validation-report.json');
});
