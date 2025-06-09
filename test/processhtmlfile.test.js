import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { processHtmlFile } from '../tools/processHtmlFile.js';

describe('processHtmlFile options', function () {
  it('rewrites relative asset links to file URLs', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
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
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('inlines scripts and styles when requested', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
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
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('extracts inline event handlers', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
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
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
