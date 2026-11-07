import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const extension = fileURLToPath(new URL('../../test/support/workstation-zoom', import.meta.url));
const minimum = { width: 1920, height: 1080 };

export const withNativeDesktopZoom = async (baseURL, run) => {
  const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: null, ignoreHTTPSErrors: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension, '--window-size=4000,2400', '--force-device-scale-factor=1', '--allow-insecure-localhost'] });
  try {
    const page = context.pages()[0], worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    await page.goto(baseURL + '/test/support/workstation-zoom/blank.html');
    const owner = await worker.evaluate(async () => {
      const tabs = await globalThis.chrome.tabs.query({});
      if (tabs.length !== 1 || !Number.isSafeInteger(tabs[0].id)) throw new Error('Native zoom requires exactly one owned tab.');
      return { tabId: tabs[0].id, windowId: tabs[0].windowId };
    });
    const read = async () => ({ ...await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, cssZoom: window.getComputedStyle(document.documentElement).zoom,
      visualScale: window.visualViewport.scale, outerWidth: window.outerWidth, outerHeight: window.outerHeight })), ...await worker.evaluate(async ({ tabId, windowId }) => ({ zoom: await globalThis.chrome.tabs.getZoom(tabId),
      settings: await globalThis.chrome.tabs.getZoomSettings(tabId), window: await globalThis.chrome.windows.get(windowId) }), owner) });
    let dimensions = await read();
    for (let attempt = 0; attempt < 3 && (dimensions.width < minimum.width * 2 || dimensions.height < minimum.height * 2); attempt++) {
      await worker.evaluate(async ({ windowId, width, height }) => globalThis.chrome.windows.update(windowId, { state: 'normal', width, height }),
        { windowId: owner.windowId, width: Math.ceil(dimensions.outerWidth + Math.max(0, minimum.width * 2 - dimensions.width) + 32), height: Math.ceil(dimensions.outerHeight + Math.max(0, minimum.height * 2 - dimensions.height) + 32) });
      dimensions = await read();
    }
    if (dimensions.width < minimum.width * 2 || dimensions.height < minimum.height * 2) throw new Error('Owned native window cannot preserve the desktop minimum at 200% zoom.');
    const setZoom = async factor => {
      if (![1, 2].includes(factor)) throw new Error('Native desktop qualification supports 100% and 200% zoom.');
      await worker.evaluate(async ({ tabId, factor }) => { await globalThis.chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-origin' }); await globalThis.chrome.tabs.setZoom(tabId, factor); }, { tabId: owner.tabId, factor });
      await page.waitForFunction(({ factor, minimum }) => Math.abs(window.devicePixelRatio - factor) < 0.01 && window.innerWidth >= minimum.width && window.innerHeight >= minimum.height, { factor, minimum });
      const state = await read();
      if (state.zoom !== factor || state.settings.mode !== 'automatic' || state.visualScale !== 1 || !['1', 'normal'].includes(state.cssZoom)) throw new Error('Native browser zoom did not apply independently of CSS/pinch scaling.');
      return state;
    };
    const screenshot = async path => {
      const session = await context.newCDPSession(page);
      try {
        const result = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        const png = Buffer.from(result.data, 'base64'), width = png.readUInt32BE(16), height = png.readUInt32BE(20), viewport = await read();
        if (width < Math.floor(viewport.width * viewport.dpr) || height < Math.floor(viewport.height * viewport.dpr)) throw new Error('Native zoom screenshot crops the physical viewport.');
        await writeFile(path, png); return { path, width, height };
      } finally { await session.detach(); }
    };
    return await run({ context, page, setZoom, read, screenshot, browserVersion: context.browser().version() });
  } finally {
    await context.close();
  }
};
