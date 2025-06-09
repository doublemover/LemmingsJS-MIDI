import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const script = path.resolve('tools/check-undefined.js');

describe('tools/check-undefined.js', function () {
  it('detects undefined function calls', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undef-'));
    fs.mkdirSync(path.join(dir, 'js'));
    const html = '<html><body><script>missingCall();</script></body></html>';
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    const result = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
    expect(result.status).to.not.equal(0);
    expect(result.stderr || result.stdout).to.match(/missingCall|require is not defined/);
  });

  it('detects global leaks assigned without var/let', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undef-'));
    const file = path.join(dir, 'leak.js');
    fs.writeFileSync(file, 'leakFn = function(){}; leakFn();');
    const result = spawnSync('node', [script, file], { encoding: 'utf8' });
    expect(result.status).to.not.equal(0);
    expect(result.stderr || result.stdout).to.match(/leakFn is not defined/);
  });

  it('returns success when all calls are defined', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undef-'));
    fs.mkdirSync(path.join(dir, 'js'));
    fs.writeFileSync(
      path.join(dir, 'js', 'main.js'),
      'function foo(){}; foo();\n'
    );
    const html = '<html><body><script>function bar(){}</script>\n' +
      '<script>bar();</script></body></html>';
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    const result = spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
    expect(result.status).to.equal(0);
    expect(result.stdout).to.match(/No undefined calls/);
  });

  it('respects CLI arguments for JS and HTML files', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undef-'));
    fs.mkdirSync(path.join(dir, 'js'));
    fs.writeFileSync(path.join(dir, 'js', 'ignored.js'), 'missingFn();');
    fs.writeFileSync(path.join(dir, 'main.js'), 'function foo(){} foo();');
    const html = '<html><body><script>document.appendChild(document.createElement("div"));</script></body></html>';
    fs.writeFileSync(path.join(dir, 'page.html'), html);
    const result = spawnSync('node', [script, 'main.js', 'page.html'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(result.status).to.equal(0);
    expect(result.stdout).to.match(/No undefined calls/);
  });

  it('handles built-in methods and code fragments', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undef-'));
    const file = path.join(dir, 'frag.js');
    fs.writeFileSync(file, 'foo.appendChild(); return 5;');
    const result = spawnSync('node', [script, 'frag.js'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(result.status).to.equal(0);
    expect(result.stdout).to.match(/No undefined calls/);
  });
});
