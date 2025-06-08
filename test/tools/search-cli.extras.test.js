import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

describe('tools/search.js extra internals', function () {
  it('filters and formats chunks', async function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
    // index dirs
    const proseDir = path.join(tmp, 'index-prose');
    const codeDir = path.join(tmp, 'index-code');
    fs.mkdirSync(proseDir); fs.mkdirSync(codeDir);
    const docsDir = path.join(tmp, 'docs');
    fs.mkdirSync(docsDir);

    // files referenced by chunks
    const docFile = path.join('docs', 'file1.md');
    const docPath = path.join(tmp, docFile);
    fs.writeFileSync(docPath, 'hello world\nmore text');
    const codeFile = path.join('docs', 'file2.md');
    const codePath = path.join(tmp, codeFile);
    fs.writeFileSync(codePath, 'function test() {}');

    // minimal metadata
    const chunkMeta = [
      {
        id: 0,
        file: docFile,
        start: 0,
        end: 11,
        kind: 'Doc',
        headline: 'hello world',
        last_author: 'nick',
        tokens: ['hello', 'world'],
        preContext: [' line a '],
        postContext: [' line b '],
        codeRelations: {
          calls: [['a','b']],
          imports: ['libA'],
          usages: ['foo', 'foo'],
        },
        lint: [{ message: 'warn' }],
        churn: 5
      },
      {
        id: 1,
        file: codeFile,
        start: 0,
        end: 18,
        kind: 'Function',
        last_author: 'alice',
        codeRelations: { calls: [['c','d']], imports: ['libB'], usages: ['bar'] },
        churn: 1
      }
    ];

    const idx = {
      chunkMeta,
      denseVec: { dims: 2, scale: 1, vectors: [[0,0],[1,1]] },
      minhash: { signatures: [[0,0],[1,1]] },
      phraseNgrams: {},
      chargrams: {}
    };

    const cwd = process.cwd();
    const argv = process.argv;
    process.chdir(tmp);
    process.argv = ['node','x','hello'];
    const mod = await import('../../tools/search.js');
    process.chdir(cwd);
    process.argv = argv;
    global.tokens = mod.queryTokens;

    const filtered = mod.filterChunks(chunkMeta, { type: 'Doc', author: 'nick', call: 'b', import: 'libA', lint: true, churn: 3 });
    expect(filtered).to.have.lengthOf(1);

    const bm = mod.rankBM25(idx, mod.queryTokens, 2);
    const mh = mod.rankMinhash(idx, mod.queryTokens, 2);
    expect(bm[0].idx).to.equal(0);
    expect(mh[0].idx).to.equal(0);

    const context = mod.cleanContext(['',' a ','```','b']);
    expect(context).to.deep.equal(['a','b']);

    const summary = mod.getBodySummary(chunkMeta[0], 2);
    expect(summary).to.include('hello world');

    const full = mod.printFullChunk(chunkMeta[0], 0, 'prose', 1.2);
    expect(full).to.include('Tokens: hello, world');
    expect(full).to.include('Usages: foo (2)');
    expect(full).to.include('preContext: a');
    expect(full).to.include('postContext: b');

    const short = mod.printShortChunk(chunkMeta[0], 0, 'prose', 1.2);
    expect(short).to.include('hello world');
    expect(short).to.include('[1.20]');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
