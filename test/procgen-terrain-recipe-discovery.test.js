import { expect } from 'chai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mineTerrainRecipes } from '../tools/mineTerrainRecipes.js';

describe('terrain source discovery and generated validation artifacts', () => {
  let directory;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lemmings-terrain-discovery-')); });
  afterEach(async () => {
    const target = path.resolve(directory), parent = path.resolve(os.tmpdir());
    if (!target.startsWith(parent + path.sep) || !path.basename(target).startsWith('lemmings-terrain-discovery-')) throw new Error('Unsafe discovery fixture cleanup');
    await fs.rm(target, { recursive: true, force: true });
  });
  it('keeps ignored browser traces and downloaded CI archives out of the source corpus while reporting real source archives', async () => {
    await fs.writeFile(path.join(directory, 'config.json'), '[]'); await fs.mkdir(path.join(directory, '.tmp', 'nested'), { recursive: true });
    for (const name of ['trace.zip', 'ci.zip', 'invalid.nxlv', 'LEVEL001.DAT']) await fs.writeFile(path.join(directory, '.tmp', 'nested', name), 'validation artifact');
    await fs.writeFile(path.join(directory, 'source-pack.zip'), 'unpacked source required');
    const book = await mineTerrainRecipes({ root: directory });
    expect(book.inventory.sourceFilesScanned).to.equal(1); expect(book.inventory.archiveFiles).to.deep.equal(['source-pack.zip']);
    expect(book.inventory.failures).to.have.length(1); expect(book.inventory.failures[0].source).to.equal('source-pack.zip');
  });
  it('scans an explicitly selected source root even when its own directory is named .tmp', async () => {
    const root = path.join(directory, '.tmp'); await fs.mkdir(root); await fs.writeFile(path.join(root, 'config.json'), '[]');
    await fs.writeFile(path.join(root, 'explicit-source.zip'), 'unpacked source required');
    const book = await mineTerrainRecipes({ root });
    expect(book.inventory.archiveFiles).to.deep.equal(['explicit-source.zip']); expect(book.inventory.failures[0].source).to.equal('explicit-source.zip');
  });
});
