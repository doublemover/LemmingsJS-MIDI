import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  reporter: [['list']],
  use: {
    baseURL: 'https://localhost:8080',
    browserName: 'chromium',
    ignoreHTTPSErrors: true,
    permissions: ['midi'],
    launchOptions: {
      args: ['--allow-insecure-localhost', '--ignore-certificate-errors']
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run start-https',
    port: 8080,
    reuseExistingServer: !process.env.CI
  }
});
