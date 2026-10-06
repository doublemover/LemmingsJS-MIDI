import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'evidence/editor-e2e.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:8095',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.AUDIT_CHROMIUM },
    screenshot: 'only-on-failure', trace: 'retain-on-failure'
  },
  webServer: { command: 'node node_modules/http-server/bin/http-server -a 127.0.0.1 -p 8095 -c-1', port: 8095, reuseExistingServer: false }
});
