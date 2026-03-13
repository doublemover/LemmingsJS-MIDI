import { expect } from 'chai';
import {
  DEFAULT_PLAYWRIGHT_BASE_URL,
  resolvePlaywrightBaseUrl,
  resolvePlaywrightWebServerPort
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

  it('rejects invalid base URLs', function () {
    expect(() => resolvePlaywrightBaseUrl('not-a-url')).to.throw('Invalid LEMMINGS_E2E_BASE_URL');
    expect(() => resolvePlaywrightBaseUrl('file:///tmp/app')).to.throw('must use http or https');
  });
});
