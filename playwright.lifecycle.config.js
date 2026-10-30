import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({ ...base, testDir: './e2e-portable', workers: 1, timeout: 60000,
  metadata: { audioBackend: process.env.LEMMINGS_LIFECYCLE_AUDIO_BACKEND || 'system-default-unqualified' },
  projects: [
    { name: 'chromium-semantic', testMatch: /(?:semantic|capabilities|native-permission)\.spec\.js$/, use: { browserName: 'chromium' } },
    { name: 'firefox-lifecycle', testIgnore: 'native-permission.spec.js', use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: { 'layers.acceleration.disabled': true, 'gfx.webrender.software': true } } } },
    { name: 'webkit-lifecycle', testIgnore: 'native-permission.spec.js', use: { browserName: 'webkit' } }
  ],
  use: { ...base.use, permissions: [], launchOptions: {} }
});
