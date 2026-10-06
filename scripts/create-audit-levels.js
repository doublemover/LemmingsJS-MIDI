import fs from 'node:fs/promises';
import { EditorLevel } from '../js/editor/EditorLevel.js';
import { NxlvWriter } from '../js/editor/NxlvWriter.js';
import { createEntry } from '../js/editor/EditorEntryFactory.js';

await fs.mkdir('evidence/levels', { recursive: true });
for (const meme of [false, true]) {
  const level = new EditorLevel();
  for (const [key, value] of Object.entries({ TITLE: meme ? 'HYDRO CHECK: TRIANGLE APPROVED' : 'The Orchard Gate', AUTHOR: 'Editor audit',
    STYLE: 'dirt', WIDTH: 640, HEIGHT: 160, LEMMINGS: 10, SAVE_REQUIREMENT: 10,
    TIME_LIMIT: 5, MAX_SPAWN_INTERVAL: 10, START_X: 0, START_Y: 0 })) level.setHeader(key, value);
  for (const skill of ['CLIMBER','FLOATER','BOMBER','BLOCKER','BUILDER','BASHER','MINER','DIGGER']) level.setSkill(skill, skill === 'BASHER' && !meme ? 2 : 0);
  const terrain = (piece, x, y) => level.terrains.push(createEntry({ STYLE: 'dirt', PIECE: piece, X: x, Y: y }));
  const gadget = (piece, x, y) => level.gadgets.push(createEntry({ STYLE: 'dirt', PIECE: piece, X: x, Y: y }));
  for (let x = 0; x < 640; x += 24) terrain(9, x, 112);
  gadget(1, 24, 52);
  gadget(0, 560, 95);
  if (meme) {
    // A walkable triangle over a water reservoir: hydration, geometrically certified.
    for (let x = 176; x <= 320; x += 8) terrain(9, x, 112 - Math.round((x - 176) / 4));
    for (let x = 328; x <= 464; x += 8) terrain(9, x, 76 + Math.round((x - 320) / 4));
    for (let x = 0; x < 640; x += 64) gadget(5, x, 144);
  } else {
    for (let y = 80; y < 112; y += 8) terrain(11, 256, y);
    terrain(4, 136, 122);
    terrain(4, 400, 122);
    gadget(2, 208, 96);
    gadget(2, 320, 96);
  }
  const slug = meme ? 'hydro-triangle' : 'orchard-gate';
  await fs.writeFile(`evidence/levels/${slug}.nxlv`, NxlvWriter.write(level));
  console.log(`Created ${slug}: ${level.terrains.length} terrain, ${level.gadgets.length} objects`);
}
