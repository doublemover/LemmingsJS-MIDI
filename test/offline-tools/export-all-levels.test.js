import { expect } from 'chai';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exportAllLevels } from '../../tools/exportAllLevels.js';

describe('all base-pack level JSON export', () => {
  it('exports all valid configured identities and refuses to overwrite output', async function() {
    this.timeout(15000);
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-level-export-'));
    const destination = path.join(parent, 'levels');
    try {
      const manifest = await exportAllLevels(destination);
      expect(manifest.packs.map(pack => pack.count)).to.deep.equal([120, 100, 4, 4, 32, 64]);
      expect(manifest.levels).to.have.lengthOf(324);
      expect(new Set(manifest.levels.map(level => level.id)).size).to.equal(324);
      const first = JSON.parse(await fs.readFile(path.join(destination, manifest.levels[0].filename), 'utf8'));
      expect(first.level.levelProperties.levelName.trim()).to.equal('Just dig!');
      let error;
      try { await exportAllLevels(destination); } catch (caught) { error = caught; }
      expect(error?.code).to.equal('EEXIST');
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
});
