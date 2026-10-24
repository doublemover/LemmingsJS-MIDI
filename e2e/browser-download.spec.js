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

test('prepared bytes stream through the browser Blob API and close one selected writable', async ({ page }) => {
  await page.goto('/?e2e=1');
  const result = await page.evaluate(async () => {
    const { prepareExportArtifact, deliverArtifactToFileHandle } = await import('/js/app/export/ExportArtifact.js');
    const artifact = prepareExportArtifact({ bytes: Uint8Array.of(1, 2, 3), immutableSourceRef: 'browser-fixture',
      formatVersion: 'test/v1', suggestedFilename: 'take.bin' });
    const chunks = []; let closed = false;
    const handle = { async createWritable() { return { async write(chunk) { chunks.push(...chunk); }, async close() { closed = true; }, async abort() {} }; } };
    const receipt = await deliverArtifactToFileHandle(artifact, handle);
    await artifact.digest();
    return { receipt, chunks, closed, digest: artifact.metadata().sha256 };
  });
  expect(result.receipt).toMatchObject({ state: 'close-acknowledged', bytesWritten: 3, evidence: 'writable-close-resolved' });
  expect(result.chunks).toEqual([1, 2, 3]);
  expect(result.closed).toBe(true);
  expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
});
