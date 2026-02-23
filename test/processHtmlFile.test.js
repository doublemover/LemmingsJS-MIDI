import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { processHtmlFile } from '../scripts/processHtmlFile.js';

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('processHtmlFile options', function () {
  it('extracts empty inline scripts', function () {
    withTempDir((dir) => {
      const html = '<!DOCTYPE html><html><head><script></script></head></html>';
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html);

      const snippets = processHtmlFile(file);
      assert.strictEqual(snippets.length, 1);
      assert.strictEqual(snippets[0].type, 'script');
      assert.strictEqual(snippets[0].code, '');
    });
  });

  it('ignores absolute asset links when rewriting', function () {
    withTempDir((dir) => {
      const html = `<!DOCTYPE html><html><head>
        <link rel="stylesheet" href="https://example.com/style.css">
        <script src="https://example.com/app.js"></script>
      </head><body></body></html>`;
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html);

      const result = processHtmlFile(file, { rewritePaths: true });
      assert.ok(result.html.includes('https://example.com/style.css'));
      assert.ok(result.html.includes('https://example.com/app.js'));
    });
  });

  it('rewrites relative asset links to file URLs', function () {
    withTempDir((dir) => {
      const jsPath = path.join(dir, 'app.js');
      const cssPath = path.join(dir, 'style.css');
      fs.writeFileSync(jsPath, 'console.log("hi");');
      fs.writeFileSync(cssPath, 'body{color:red;}');
      const html = `<!DOCTYPE html><html><head>
        <link rel="stylesheet" href="style.css">
        <script src="app.js"></script>
      </head><body></body></html>`;
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html);

      const result = processHtmlFile(file, { rewritePaths: true });
      assert.ok(result.html.includes(pathToFileURL(cssPath).href));
      assert.ok(result.html.includes(pathToFileURL(jsPath).href));
    });
  });

  it('inlines scripts and styles when requested', function () {
    withTempDir((dir) => {
      const jsPath = path.join(dir, 'app.js');
      const cssPath = path.join(dir, 'style.css');
      fs.writeFileSync(jsPath, 'console.log("hi");');
      fs.writeFileSync(cssPath, 'body{color:red;}');
      const html = `<!DOCTYPE html><html><head>
        <link rel="stylesheet" href="style.css">
        <script src="app.js"></script>
      </head><body></body></html>`;
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html);

      const result = processHtmlFile(file, { inline: true });
      assert.ok(/<style>body\{color:red;\}<\/style>/.test(result.html));
      assert.ok(/<script>console.log\("hi"\);<\/script>/.test(result.html));
      assert.ok(!/href="style.css"/.test(result.html));
      assert.ok(!/src="app.js"/.test(result.html));
    });
  });
  it('extracts inline event handlers', function () {
    withTempDir((dir) => {
      const html = '<!DOCTYPE html><html><body><button onclick="doThing()">go</button></body></html>';
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(file, html);

      const snippets = processHtmlFile(file);
      assert.strictEqual(snippets.length, 1);
      const handler = snippets[0];
      assert.strictEqual(handler.type, 'handler');
      assert.strictEqual(handler.attr, 'onclick');
      assert.ok(typeof handler.loc.start === 'number');
      assert.ok(typeof handler.loc.end === 'number');
    });
  });

  it('collects relative entry scripts when requested', function () {
    withTempDir((dir) => {
      const file = path.join(dir, 'index.html');
      fs.writeFileSync(
        file,
        '<html><body><script src="./app.js?x=1"></script><script src="https://example.com/ext.js"></script></body></html>'
      );
      fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("ok");');

      const result = processHtmlFile(file, { includeExternalScripts: true });
      assert.ok(Array.isArray(result.entryScripts));
      assert.strictEqual(result.entryScripts.length, 1);
      assert.strictEqual(result.entryScripts[0], path.resolve(dir, 'app.js'));
    });
  });
});
