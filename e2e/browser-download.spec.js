import { expect, test } from '@playwright/test';

test('browser download helper requests a file without claiming a saved receipt', async ({ page }) => {
  await page.goto('/?e2e=1');
  const pending = page.waitForEvent('download');
  const receipt = await page.evaluate(async () => {
    const { requestBrowserDownload } = await import('/js/app/export/BrowserDownload.js');
    return requestBrowserDownload({ document, windowRef: window, bytes: 'owned artifact',
      filename: 'browser-download-smoke.txt', mediaType: 'text/plain' });
  });
  const download = await pending;
  expect(download.suggestedFilename()).toBe('browser-download-smoke.txt');
  expect(receipt).toMatchObject({ state: 'delivery-requested', evidence: 'anchor-click-returned', byteLength: 14 });
});
