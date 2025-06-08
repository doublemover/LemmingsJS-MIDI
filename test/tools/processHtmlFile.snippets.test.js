import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { processHtmlFile } from '../../tools/processHtmlFile.js';

// Tests for snippet extraction and event handler parsing

describe('tools/processHtmlFile snippet extraction', function () {
  it('collects inline scripts and handler attributes', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
    const html = `<!DOCTYPE html><html><body>
      <script>console.log('inline');</script>
      <script src="ext.js"></script>
      <button onclick="alert('hi')">Click</button>
    </body></html>`;
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, html);

    const snippets = processHtmlFile(file);
    expect(snippets).to.have.length(2);
    const [scriptSnippet, handlerSnippet] = snippets;
    expect(scriptSnippet.type).to.equal('script');
    expect(scriptSnippet.code.trim()).to.equal('console.log(\'inline\');');
    expect(scriptSnippet.loc.start).to.be.a('number');
    expect(scriptSnippet.loc.end).to.be.a('number');

    expect(handlerSnippet.type).to.equal('handler');
    expect(handlerSnippet.attr).to.equal('onclick');
    expect(handlerSnippet.code).to.equal('alert(\'hi\')');
    expect(handlerSnippet.loc.start).to.be.a('number');
    expect(handlerSnippet.loc.end).to.be.a('number');
  });

  it('skips non-relative paths when rewriting', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
    const html = `<!DOCTYPE html><html><head>
      <script src="http://example.com/app.js"></script>
    </head><body></body></html>`;
    const file = path.join(dir, 'index.html');
    fs.writeFileSync(file, html);

    const result = processHtmlFile(file, { rewritePaths: true });
    expect(result.html).to.include('src="http://example.com/app.js"');
  });
});
