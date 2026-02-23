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
  it('detects undefined function calls', function () {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, 'js'));
      const html = '<html><body><script>missingCall();</script></body></html>';
      fs.writeFileSync(path.join(dir, 'index.html'), html);
      const result = runCheck([], { cwd: dir });
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/missingCall|require is not defined/);
    });
  });

  it('detects global leaks assigned without var/let', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'leak.js');
      fs.writeFileSync(file, 'leakFn = function(){}; leakFn();');
      const result = runCheck(file);
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/leakFn is not defined/);
    });
  });

  it('returns success when all calls are defined', function () {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, 'js'));
      fs.writeFileSync(
        path.join(dir, 'js', 'main.js'),
        'function foo(){}; foo();\n'
      );
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
      expect(result.stderr || result.stdout).to.match(/missingFromEntry is not defined/);
    });
  });

  it('handles built-in methods and code fragments', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'frag.js');
      fs.writeFileSync(file, 'foo.appendChild(); return 5;');
      const result = runCheck('frag.js', { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });

  it('skips node_modules, .git, and jquery.js when scanning the tree', function () {
    withTempDir((dir) => {
      const jsDir = path.join(dir, 'js');
      fs.mkdirSync(jsDir);
      fs.mkdirSync(path.join(jsDir, 'sub'));

      fs.writeFileSync(path.join(jsDir, 'main.js'), 'function ok(){};');
      fs.writeFileSync(
        path.join(jsDir, 'sub', 'helper.js'),
        [
          'class Foo {',
          '  jump() {}',
          '  bar = () => {};',
          '}',
          'const arrow = () => {};',
          'const named = function named() {};',
          'const arr = [,];',
          'with (Math) { }'
        ].join('\n')
      );
      fs.writeFileSync(path.join(jsDir, 'jquery.js'), 'missingFromJquery();');

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
        '<html><body><script>ok(); this.jump(); console.log("ok"); setTimeout(function(){},0);</script></body></html>'
      );
      fs.writeFileSync(
        path.join(dir, 'bad.html'),
        '<html><body><script>const = 1;</script></body></html>'
      );

      const result = runCheck([], { cwd: dir });
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });

  it('returns success when JS cannot be parsed', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'bad.js');
      fs.writeFileSync(file, 'const = 1;');

      const result = runCheck(file);
      expect(result.status).to.equal(0);
      expect(result.stdout).to.match(/No undefined calls/);
    });
  });

  it('reports undefined methods on non-builtin objects', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'missing-method.js');
      fs.writeFileSync(file, 'const obj = {}; obj.missing(); ({}).alsoMissing();');

      const result = runCheck(file, { cwd: dir });
      expect(result.status).to.not.equal(0);
      expect(result.stderr || result.stdout).to.match(/missing|alsoMissing/);
    });
  });
});
