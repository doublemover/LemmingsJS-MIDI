import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const script = path.resolve('tools/build_index.js');
const loader = path.resolve('test/helpers/transformers-loader.mjs');

describe('tools/build_index.js', function () {
  before(function () {
    if (!process.env.RUN_INDEX_TEST) this.skip();
  });

  this.timeout(120000);

  it('builds indexes with stubbed embeddings', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-'));
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.writeFileSync(path.join(dir, 'tools', 'words_alpha.txt'), 'alpha\nbeta\n');
    fs.writeFileSync(path.join(dir, 'sample.js'), 'export const n = 1;');
    fs.writeFileSync(path.join(dir, 'doc.md'), '# hi');

    const res = spawnSync(process.execPath, ['--loader', loader, script, '--mode=all', '--threads=1'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60000
    });

    expect(res.status).to.equal(0);
    for (const mode of ['prose', 'code']) {
      const out = path.join(dir, `index-${mode}`);
      for (const f of [
        'chunk_meta.json',
        'dense_vectors_uint8.json',
        'phrase_ngrams.json',
        'chargram_postings.json',
        'minhash_signatures.json'
      ]) {
        expect(fs.existsSync(path.join(out, f)), `${mode}/${f} missing`).to.be.true;
      }
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
