import { defineConfig } from '@playwright/test';

const DEFAULT_PLAYWRIGHT_BASE_URL = 'https://localhost:8080';

const resolvePlaywrightBaseUrl = (value = process.env.LEMMINGS_E2E_BASE_URL) => {
  const candidate = String(value || '').trim() || DEFAULT_PLAYWRIGHT_BASE_URL;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid LEMMINGS_E2E_BASE_URL: ${candidate}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`LEMMINGS_E2E_BASE_URL must use http or https: ${candidate}`);
  }
  return url.origin;
};

const resolvePlaywrightWebServerPort = (baseUrl) => {
  const url = new URL(baseUrl);
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
};

const baseURL = resolvePlaywrightBaseUrl();

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  reporter: [['list']],
  use: {
    baseURL,
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
    port: resolvePlaywrightWebServerPort(baseURL),
    reuseExistingServer: !process.env.CI
  }
});

export {
  DEFAULT_PLAYWRIGHT_BASE_URL,
  resolvePlaywrightBaseUrl,
  resolvePlaywrightWebServerPort
};
