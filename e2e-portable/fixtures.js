import { test as base, expect } from '@playwright/test';

// Native audio/context destruction must not share a browser process with the next journey.
const test = base.extend({
  nativeBrowser: async ({ playwright, browserName, launchOptions, headless, channel }, use) => {
    const browser = await playwright[browserName].launch({ ...launchOptions, headless, ...(channel ? { channel } : {}) });
    try { await use(browser); } finally { await browser.close(); }
  },
  context: async ({ nativeBrowser, contextOptions, baseURL, viewport, permissions, ignoreHTTPSErrors }, use, testInfo) => {
    const context = await nativeBrowser.newContext({ ...contextOptions, baseURL, viewport, screen: testInfo.project.use.screen || viewport, permissions, ignoreHTTPSErrors });
    try { await use(context); } finally { await context.close(); }
  }
});

export { expect, test };
