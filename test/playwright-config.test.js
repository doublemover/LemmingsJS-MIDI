import { expect } from 'chai';
import {
  DEFAULT_PLAYWRIGHT_BASE_URL,
  resolvePlaywrightBaseUrl,
  resolvePlaywrightWebServerPort,
  resolvePlaywrightWebServer
} from '../playwright.config.js';

describe('playwright.config', function () {
  it('defaults to the localhost origin when no override is provided', function () {
    expect(resolvePlaywrightBaseUrl('')).to.equal(DEFAULT_PLAYWRIGHT_BASE_URL);
  });

  it('normalizes env overrides to an origin-only base URL', function () {
    expect(resolvePlaywrightBaseUrl(' https://10.0.0.126:8080/editor.html?e2e=1 ')).to.equal('https://10.0.0.126:8080');
  });

  it('derives the web server port from the configured base URL', function () {
    expect(resolvePlaywrightWebServerPort('https://10.0.0.126:8080')).to.equal(8080);
    expect(resolvePlaywrightWebServerPort('https://localhost')).to.equal(443);
    expect(resolvePlaywrightWebServerPort('http://127.0.0.1')).to.equal(80);
  });

  it('starts its own server with the configured loopback port and protocol without implicit reuse', () => {
    const plain = resolvePlaywrightWebServer('http://127.0.0.1:43821');
    expect(plain.url).to.equal('http://127.0.0.1:43821'); expect(plain.command).to.include('-p 43821');
    expect(plain.command).not.to.include(' -S'); expect(plain.reuseExistingServer).to.equal(false);
    const secure = resolvePlaywrightWebServer('https://localhost:43822');
    expect(secure.url).to.equal('https://localhost:43822'); expect(secure.command).to.include('-p 43822'); expect(secure.command).to.include(' -S');
    expect(secure.ignoreHTTPSErrors).to.equal(true); expect(secure.reuseExistingServer).to.equal(false);
  });

  it('uses an explicitly managed server only when requested and rejects remote auto-start', () => {
    expect(resolvePlaywrightWebServer('http://127.0.0.1:43821', { externalServer: true })).to.equal(undefined);
    expect(() => resolvePlaywrightWebServer('https://example.com')).to.throw('EXTERNAL_SERVER=1');
    expect(resolvePlaywrightWebServer('https://example.com', { externalServer: true })).to.equal(undefined);
  });

  it('rejects invalid base URLs', function () {
    expect(() => resolvePlaywrightBaseUrl('not-a-url')).to.throw('Invalid LEMMINGS_E2E_BASE_URL');
    expect(() => resolvePlaywrightBaseUrl('file:///tmp/app')).to.throw('must use http or https');
  });
});
