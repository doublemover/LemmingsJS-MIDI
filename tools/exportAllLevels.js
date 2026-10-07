import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NodeFileProvider } from './NodeFileProvider.js';
import { FileContainer } from '../js/data/FileContainer.js';
import { BinaryReader } from '../js/data/BinaryReader.js';
import { OddTableReader } from '../js/data/OddTableReader.js';
import { LevelReader } from '../js/level/LevelReader.js';
import { LevelWriter } from '../js/level/LevelWriter.js';
import { LevelIndexResolve } from '../js/level/LevelIndexResolve.js';
import { __test__ } from '../js/level/LevelLoader.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const fields = ['levelWidth', 'levelHeight', 'levelProperties', 'screenPositionX',
  'graphicSet1', 'graphicSet2', 'isSuperLemming', 'objects', 'terrains', 'steel'];
const snapshot = reader => JSON.parse(JSON.stringify(Object.fromEntries(fields.map(key => [key, reader[key]]))));

// A fresh destination is required: never replace an earlier export or pack.
export async function exportAllLevels(destination) {
  const out = path.resolve(destination);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.mkdir(out, { recursive: false });
  const configs = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
  const provider = new NodeFileProvider(root);
  const manifest = { schemaVersion: 1, format: 'lemmings-classic-json', packs: [], levels: [] };
  for (const config of configs) {
    const level = Object.fromEntries(Object.entries(config).filter(([key]) => key.startsWith('level.')).map(([key, value]) => [key.slice(6), value]));
    const resolver = new LevelIndexResolve({ ...config, level });
    const odd = level.useOddTable ? new OddTableReader(await provider.loadBinary(config.path, 'ODDTABLE.DAT')) : null;
    let count = 0;
    for (let rank = 0; rank < level.order.length; rank++) {
      for (let index = 0; index < level.order[rank].length; index++) {
        const source = resolver.resolve(rank, index);
        const archive = `${level.filePrefix}${String(source.fileId).padStart(3, '0')}.DAT`;
        const container = new FileContainer(await provider.loadBinary(config.path, archive));
        assert.ok(source.partIndex < container.count(), `${config.path}/${archive}: missing part ${source.partIndex}`);
        const reader = new LevelReader(container.getPart(source.partIndex));
        reader.levelProperties = __test__.mergeLevelProperties(reader.levelProperties,
          source.useOddTable && odd ? odd.getLevelProperties(source.levelNumber) : null);
        const data = snapshot(reader);
        const bytes = new LevelWriter().write(data);
        assert.deepEqual(snapshot(new LevelReader(new BinaryReader(bytes))), data);
        const id = `${config.path}/${rank + 1}/${index + 1}`;
        const filename = `${config.path}-${rank + 1}-${String(index + 1).padStart(2, '0')}.json`;
        const record = { schemaVersion: 1, id, pack: config.name, rank: level.groups[rank], index: index + 1,
          source: { archive, ...source }, level: data };
        const json = JSON.stringify(record, null, 2) + '\n';
        await fs.writeFile(path.join(out, filename), json, { flag: 'wx' });
        assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, filename), 'utf8')), record);
        manifest.levels.push({ id, filename, title: data.levelProperties.levelName,
          sha256: createHash('sha256').update(json).digest('hex'), classicRoundtrip: true });
        count++;
      }
    }
    manifest.packs.push({ path: config.path, count });
    console.log(`${config.path}: ${count} levels exported and roundtrip verified`);
  }
  assert.equal(new Set(manifest.levels.map(entry => entry.id)).size, manifest.levels.length);
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(`Complete: ${manifest.levels.length} unique levels`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await exportAllLevels(process.argv[2] || path.join(root, 'exports', 'all-levels'));
}
