import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

function makeIndex(base, chunk) {
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'chunk_meta.json'), JSON.stringify([chunk]));
  fs.writeFileSync(
    path.join(base, 'dense_vectors_uint8.json'),
    JSON.stringify({ dims: 1, scale: 1, vectors: [[0]] })
  );
  fs.writeFileSync(
    path.join(base, 'minhash_signatures.json'),
    JSON.stringify({ signatures: [[0]] })
  );
  fs.writeFileSync(
    path.join(base, 'phrase_ngrams.json'),
    JSON.stringify({ vocab: chunk.tokens, postings: { [chunk.tokens[0]]: [0] } })
  );
  fs.writeFileSync(
    path.join(base, 'chargram_postings.json'),
    JSON.stringify({ vocab: [chunk.tokens[0].slice(0,3)], postings: { [chunk.tokens[0].slice(0,3)]: [0] } })
  );
}

describe('search CLI options', function () {
  it('applies filters and ANN search', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sopt-'));
    const proseChunk = {
      id: 0,
      file: 'doc.md',
      start: 0,
      end: 1,
      kind: 'Doc',
      headline: 'term',
      ngrams: ['term'],
      tokens: ['term'],
      last_author: 'nick',
      codeRelations: { calls: [['a','b']], imports: ['libA'] },
      lint: [{ message: 'warn' }],
      churn: 5
    };
    const codeChunk = {
      id: 0,
      file: 'code.js',
      start: 0,
      end: 1,
      kind: 'Function',
      headline: 'term',
      ngrams: ['term'],
      tokens: ['term'],
      last_author: 'alice',
      codeRelations: { calls: [['c','d']], imports: ['libB'] }
    };
    makeIndex(path.join(dir, 'index-prose'), proseChunk);
    makeIndex(path.join(dir, 'index-code'), codeChunk);
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.copyFileSync(path.join('tools', 'words_alpha.txt'), path.join(dir, 'tools', 'words_alpha.txt'));

    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'term', '--json', '--ann', '--type', 'Doc', '--author', 'nick', '--call', 'b', '--import', 'libA'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    const out = JSON.parse(res.stdout);
    expect(out.prose).to.have.lengthOf(1);
    expect(out.code).to.have.lengthOf(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes metrics and shows stats for human output', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sstat-'));
    const chunk = {
      id: 0,
      file: 'file.md',
      start: 0,
      end: 1,
      kind: 'Doc',
      headline: 'term',
      ngrams: ['term'],
      tokens: ['term'],
      last_author: 'nick',
      codeRelations: { calls: [['a','b']], imports: ['libA'] },
      lint: [{ message: 'warn' }],
      churn: 5
    };
    makeIndex(path.join(dir, 'index-prose'), chunk);
    makeIndex(path.join(dir, 'index-code'), chunk);
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.copyFileSync(path.join('tools', 'words_alpha.txt'), path.join(dir, 'tools', 'words_alpha.txt'));

    const script = path.resolve('tools/search.js');
    const res = spawnSync(process.execPath, [script, 'term', '--human', '--stats', '--matched'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    expect(res.stdout).to.include('===== 📖 Markdown Results =====');
    expect(res.stdout).to.include('Stats:');
    expect(res.stdout).to.include('Matched');

    const metrics = path.join(dir, '.repoMetrics', 'metrics.json');
    const hist = path.join(dir, '.repoMetrics', 'searchHistory');
    expect(fs.existsSync(metrics)).to.be.true;
    expect(fs.existsSync(hist)).to.be.true;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
