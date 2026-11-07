import { test as base, expect } from '@playwright/test';

// Native audio/context destruction must not share a browser process with the next journey.
const test = base.extend({
  nativeBrowser: async ({ playwright, browserName, launchOptions, headless, channel }, use) => {
    const browser = await playwright[browserName].launch({ ...launchOptions, headless, ...(channel ? { channel } : {}) });
    try { await use(browser); } finally { await browser.close(); }
  },
  context: async ({ nativeBrowser, contextOptions, baseURL, viewport, permissions, ignoreHTTPSErrors }, use, testInfo) => {
    const context = await nativeBrowser.newContext({ ...contextOptions, baseURL, viewport, screen: testInfo.project.use.screen || viewport, permissions, ignoreHTTPSErrors });
    const events = []; let omitted = 0;
    const record = value => { if (events.length < 128) events.push(value); else omitted++; };
    context.on('console', message => {
      if (['error', 'warning'].includes(message.type())) record({ kind: 'console', type: message.type(), message: message.text().slice(0, 1024), url: message.location().url?.slice(0, 512) });
    });
    context.on('page', page => {
      page.on('pageerror', error => record({ kind: 'pageerror', message: error.message.slice(0, 1024), url: page.url().slice(0, 512) }));
      page.on('requestfailed', request => record({ kind: 'requestfailed', url: request.url().slice(0, 512), error: request.failure()?.errorText?.slice(0, 512) }));
      page.on('crash', () => record({ kind: 'page-crash', url: page.url().slice(0, 512) }));
    });
    try { await use(context); } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('native-browser-startup-diagnostics.json', {
          body: JSON.stringify({ events, omitted, configuredViewport: viewport, scope: 'Bounded native console, page errors, failed requests and crash events; no inferred crash cause or rendered-frame measurement.' }), contentType: 'application/json'
        });
      } finally { await context.close(); }
    }
  }
});

export { expect, test };
