import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const script = path.resolve('scripts/check-undefined.js');

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undef-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const runCheck = (args = [], options = {}) => {
  const argList = Array.isArray(args) ? args : [args];
  return spawnSync('node', [script, ...argList], {
    encoding: 'utf8',
    ...options
  });
};

describe('scripts/check-undefined.js', function () {
  it('detects undefined inline HTML references', function () {
    withTempDir((dir) => {
      const html = '<html><body><script>missingCall();</script></body></html>';
      fs.writeFileSync(path.join(dir, 'index.html'), html);
      const result = runCheck([], { cwd: dir });
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/'missingCall' is not defined/);
    });
  });

  it('detects undefined JS references when JS files are passed explicitly', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'leak.js');
      fs.writeFileSync(file, 'leakFn = function(){}; leakFn();');
      const result = runCheck(file);
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/'leakFn' is not defined/);
    });
  });

  it('returns success when all calls are defined', function () {
    withTempDir((dir) => {
      const html = '<html><body><script>function bar(){}</script>\n' +
        '<script>bar();</script></body></html>';
      fs.writeFileSync(path.join(dir, 'index.html'), html);
      const result = runCheck([], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });

  it('respects CLI arguments for JS and HTML files', function () {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, 'js'));
      fs.writeFileSync(path.join(dir, 'js', 'ignored.js'), 'missingFn();');
      fs.writeFileSync(path.join(dir, 'main.js'), 'function foo(){} foo();');
      const html = '<html><body><script>document.appendChild(document.createElement("div"));</script></body></html>';
      fs.writeFileSync(path.join(dir, 'page.html'), html);
      const result = runCheck(['main.js', 'page.html'], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });

  it('follows relative entrypoint scripts from HTML inputs', function () {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, 'entry.js'), 'missingFromEntry();');
      fs.writeFileSync(
        path.join(dir, 'page.html'),
        '<html><body><script src="./entry.js"></script></body></html>'
      );

      const result = runCheck(['page.html'], { cwd: dir });
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/'missingFromEntry' is not defined/);
    });
  });

  it('allows inline event-handler fragments', function () {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'page.html'),
        '<html><body><button onclick="return false;"></button></body></html>'
      );
      const result = runCheck('page.html', { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });

  it('skips node_modules, .git, and vendor scripts when scanning entrypoints', function () {
    withTempDir((dir) => {
      const jsDir = path.join(dir, 'js');
      const vendorDir = path.join(jsDir, 'vendor');
      fs.mkdirSync(jsDir);
      fs.mkdirSync(vendorDir);

      fs.writeFileSync(path.join(vendorDir, 'webmidi.js'), 'missingFromVendor();');
      fs.writeFileSync(path.join(jsDir, 'main.js'), 'function ok(){} ok();');

      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.mkdirSync(path.join(dir, '.git'));
      fs.writeFileSync(
        path.join(dir, 'node_modules', 'evil.html'),
        '<script>missingCall()</script>'
      );
      fs.writeFileSync(
        path.join(dir, '.git', 'evil.html'),
        '<script>missingCall()</script>'
      );
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        '<html><head><script src="js/vendor/webmidi.js"></script><script src="js/main.js"></script></head><body><script>console.log("ok"); setTimeout(function(){},0);</script></body></html>'
      );

      const result = runCheck([], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });

  it('reports parse errors for explicit JS files', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'bad.js');
      fs.writeFileSync(file, 'const = 1;');

      const result = runCheck(file);
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/Parsing error|Unexpected token/);
    });
  });

  it('discovers additional root html entrypoints in default mode', function () {
    withTempDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'custom.html'),
        '<html><body><script>missingCustomEntry();</script></body></html>'
      );

      const result = runCheck([], { cwd: dir });
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/'missingCustomEntry' is not defined/);
    });
  });

  it('treats common Mocha hook globals as built-ins', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'mocha-hooks.js');
      fs.writeFileSync(file, [
        'describe("suite", function () {',
        '  beforeEach(function () {});',
        '  afterEach(function () {});',
        '  context("nested", function () {',
        '    test("ok", function () {});',
        '  });',
        '});'
      ].join('\n'));

      const result = runCheck(file, { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });
});
