import assert from 'assert';
import { processHtmlFile } from '../tools/processHtmlFile.js';

describe('processHtmlFile', function () {
  it('extracts inline scripts and event handlers', function () {
    const snippets = processHtmlFile('index.html');
    assert.ok(snippets.length >= 4);
    const inline = snippets.find(s => s.type === 'script');
    assert.ok(inline.code.includes('function onEnabled'));
  });
});
