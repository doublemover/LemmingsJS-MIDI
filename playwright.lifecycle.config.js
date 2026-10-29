import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({ ...base, testDir: './e2e-portable', workers: 1, timeout: 60000,
  projects: [
    { name: 'firefox-lifecycle', use: { browserName: 'firefox' } },
    { name: 'webkit-lifecycle', use: { browserName: 'webkit' } }
  ],
  use: { ...base.use, permissions: [], launchOptions: {} }
});
