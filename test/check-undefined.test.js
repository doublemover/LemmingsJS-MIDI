import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';


describe('tools/check-undefined.js', function () {
  it('reports an error for undefined functions', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'undef-'));
    const file = path.join(dir, 'snippet.js');
    fs.writeFileSync(file, 'nonexistentFunc();\n');

    const result = spawnSync('node', ['tools/check-undefined.js', file], {
      encoding: 'utf8'
    });

    expect(result.status).to.not.equal(0);
    expect(result.stderr).to.match(/nonexistentFunc is not defined/);
  });
});
