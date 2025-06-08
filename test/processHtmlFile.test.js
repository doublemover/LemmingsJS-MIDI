import assert from 'assert';
import { processHtmlFile } from '../tools/processHtmlFile.js';

describe('processHtmlFile', function () {
  it('extracts inline scripts and event handlers', function () {
    const snippets = processHtmlFile('index.html');
    assert.ok(snippets.length >= 4);
    const inline = snippets.find(s => s.type === 'script');
    assert.ok(inline.code.includes('function onEnabled'));
    assert.ok(inline.loc.start < inline.loc.end);
  });

  it('extracts inline event handler attributes', function () {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-'));
    const file = path.join(dir, 't.html');
    fs.writeFileSync(file, '<div onclick="doIt()" onmouseover="hover()"></div>');
    const snippets = processHtmlFile(file);
    fs.rmSync(dir, { recursive: true, force: true });
    const codes = snippets.filter(s=>s.type==='handler').map(s=>s.code.trim());
    assert.deepStrictEqual(codes.sort(), ['doIt()', 'hover()']);
  });
});
