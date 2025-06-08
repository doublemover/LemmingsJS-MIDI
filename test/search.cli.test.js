import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

describe('search CLI', function () {
  function makeIndex(base) {
    const chunk = [{
      id: 0,
      file: 'foo.txt',
      start: 0,
      end: 1,
      kind: 'snippet',
      headline: 'term',
      ngrams: ['term'],
      tokens: ['term']
    }];
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, 'chunk_meta.json'), JSON.stringify(chunk));
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
      JSON.stringify({ vocab: ['term'], postings: { term: [0] } })
    );
    fs.writeFileSync(
      path.join(base, 'chargram_postings.json'),
      JSON.stringify({ vocab: ['ter'], postings: { ter: [0] } })
    );
  }

  it('records results and no-result queries', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scli-'));
    makeIndex(path.join(dir, 'index-prose'));
    makeIndex(path.join(dir, 'index-code'));
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.copyFileSync(
      path.join('tools', 'words_alpha.txt'),
      path.join(dir, 'tools', 'words_alpha.txt')
    );

    const script = path.resolve('tools/search.js');
    let res = spawnSync(process.execPath, [script, 'term', '--json'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    const out = JSON.parse(res.stdout);
    expect(out.prose).to.have.lengthOf(1);
    expect(out.code).to.have.lengthOf(1);

    const metricsPath = path.join(dir, '.repoMetrics', 'metrics.json');
    const histPath = path.join(dir, '.repoMetrics', 'searchHistory');
    expect(fs.existsSync(metricsPath)).to.be.true;
    expect(fs.existsSync(histPath)).to.be.true;
    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    expect(metrics['foo.txt']).to.deep.equal({ md: 1, code: 1, terms: ['term'] });
    let lines = fs.readFileSync(histPath, 'utf8').trim().split(/\n/);
    expect(lines).to.have.lengthOf(1);
    const rec1 = JSON.parse(lines[0]);
    expect(rec1.query).to.equal('term');
    expect(rec1.mdFiles).to.equal(1);
    expect(rec1.codeFiles).to.equal(1);

    res = spawnSync(process.execPath, [script, 'none', '--json'], {
      cwd: dir,
      encoding: 'utf8'
    });
    expect(res.status).to.equal(0);
    const out2 = JSON.parse(res.stdout);
    expect(out2.prose).to.have.lengthOf(0);
    expect(out2.code).to.have.lengthOf(0);

    const noRes = path.join(dir, '.repoMetrics', 'noResultQueries');
    expect(fs.existsSync(noRes)).to.be.true;
    const metrics2 = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    expect(metrics2['foo.txt'].md).to.equal(1);
    lines = fs.readFileSync(histPath, 'utf8').trim().split(/\n/);
    expect(lines).to.have.lengthOf(2);
    const rec2 = JSON.parse(lines[1]);
    expect(rec2.query).to.equal('none');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
