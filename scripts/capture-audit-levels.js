import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.AUDIT_CHROMIUM, headless:true });
const page = await browser.newPage({viewport:{width:1600,height:1000}});
await page.route(/https:\/\//,route=>route.abort());
await page.goto('http://127.0.0.1:8096/editor.html?e2e=1');
await page.waitForFunction(()=>window.__E2E__?.getState()?.editor?.assets?.terrain?.length);
for (const slug of ['orchard-gate','hydro-triangle']) {
  const text = await fs.readFile(`evidence/levels/${slug}.nxlv`,'utf8');
  await page.evaluate(()=>{window.confirm=()=>true;});
  await page.locator('#editorSavedImportInput').setInputFiles(`evidence/levels/${slug}.nxlv`);
  await page.waitForFunction(title=>document.querySelector('#editorHeaderTitle').value===title,text.match(/TITLE (.*)/)[1]);
  const canvas=page.locator('#editorCanvas');
  const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/3);
  for(let i=0;i<8;i++) {
    if ((await page.evaluate(()=>window.__E2E__.getState().stage.viewRect.w)) >= 640) break;
    await page.mouse.wheel(0,150);
    await page.waitForTimeout(100);
  }
  await page.evaluate(()=>window.__E2E__.centerStageOn({x:320,y:80}));
  await page.screenshot({path:`evidence/${slug}-overview.png`,fullPage:true});
  await canvas.screenshot({path:`evidence/${slug}-canvas.png`});
  console.log(slug,await page.evaluate(()=>window.__E2E__.getState().stage));
}
await browser.close();
