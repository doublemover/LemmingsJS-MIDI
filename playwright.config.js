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

const resolvePlaywrightWebServer = (baseUrl, { externalServer = false } = {}) => {
  if (externalServer) return undefined;
  const url = new URL(baseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote E2E origins require LEMMINGS_E2E_EXTERNAL_SERVER=1 for an explicitly managed server.');
  const address = url.hostname === '[::1]' ? '::1' : '127.0.0.1';
  const secure = url.protocol === 'https:' ? ' -S -C certs/localhost.pem -K certs/localhost-key.pem' : '';
  return { command: 'node node_modules/http-server/bin/http-server -a ' + address + ' -p ' + resolvePlaywrightWebServerPort(baseUrl) + ' -c-1 --silent' + secure,
    url: baseUrl, ignoreHTTPSErrors: true, reuseExistingServer: false, timeout: 30000 };
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
      executablePath: process.env.LEMMINGS_E2E_EXECUTABLE || undefined,
      args: ['--allow-insecure-localhost', '--ignore-certificate-errors']
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: resolvePlaywrightWebServer(baseURL, { externalServer: process.env.LEMMINGS_E2E_EXTERNAL_SERVER === '1' })
});

export {
  DEFAULT_PLAYWRIGHT_BASE_URL,
  resolvePlaywrightBaseUrl,
  resolvePlaywrightWebServerPort,
  resolvePlaywrightWebServer
};
