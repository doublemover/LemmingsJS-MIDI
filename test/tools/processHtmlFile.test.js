import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { processHtmlFile } from '../../tools/processHtmlFile.js';

describe('tools/processHtmlFile', function () {
  it('rewrites relative asset links to file URLs', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
    fs.mkdirSync(path.join(dir, 'js'));
    fs.mkdirSync(path.join(dir, 'css'));
    fs.mkdirSync(path.join(dir, 'img'));
    fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'console.log("hi");');
    fs.writeFileSync(path.join(dir, 'css', 'style.css'), 'body{color:red;}');
    fs.writeFileSync(path.join(dir, 'img', 'pic.png'), Buffer.from([0]));

    const html = `<!DOCTYPE html><html><head>
      <link rel="stylesheet" href="css/style.css">
      <script src="js/app.js"></script>
    </head><body><img src="img/pic.png"></body></html>`;
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, html);

    const result = processHtmlFile(file, { rewritePaths: true });
    expect(result.snippets).to.be.an('array');
    const processed = result.html;
    expect(processed).to.include(pathToFileURL(path.join(dir, 'css', 'style.css')).href);
    expect(processed).to.include(pathToFileURL(path.join(dir, 'js', 'app.js')).href);
    expect(processed).to.include(pathToFileURL(path.join(dir, 'img', 'pic.png')).href);
  });
});
