import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.AUDIT_CHROMIUM,headless:true});
const page=await browser.newPage();
await page.route(/https:\/\//,route=>route.abort());
await page.goto('http://127.0.0.1:8096/editor.html?e2e=1');
await page.waitForFunction(()=>window.__E2E__?.getState().editor?.assets?.terrain?.length);
const results=[];
for(const width of [1280,768,390]) {
  await page.setViewportSize({width,height:844});
  for(const [name,selector] of [['canvas','#editorCanvas'],['settings','#editorHeaderTitle']]) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box=await page.locator(selector).boundingBox();
    const intersects=box && box.x<width && box.y<844 && box.x+box.width>0 && box.y+box.height>0;
    results.push({width,name,box,intersectsViewport:intersects});
    await page.screenshot({path:`evidence/responsive-${width}-${name}.png`});
  }
}
await fs.writeFile('evidence/responsive-checks.json',JSON.stringify(results,null,2));
console.log(results);
await browser.close();
