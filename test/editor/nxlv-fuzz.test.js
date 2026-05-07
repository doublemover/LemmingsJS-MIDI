import { expect } from 'chai';
import { EditorLevel } from '../../js/editor/EditorLevel.js';
import { NxlvParser } from '../../js/editor/NxlvParser.js';
import { NxlvWriter } from '../../js/editor/NxlvWriter.js';
import { createGadgetEntry, createSteelEntry, createTerrainEntry } from '../../js/editor/EditorEntryFactory.js';

const createRng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

const randomWord = (rng, len = 5) => {
  let out = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < len; i += 1) {
    out += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return out;
};

const randomLevel = (seed) => {
  const rng = createRng(seed);
  const level = new EditorLevel();
  level.setHeader('TITLE', `Fuzz_${seed}`);
  level.setHeader('STYLE', pick(rng, ['dirt', 'crystal', 'marble']));
  level.setHeader('WIDTH', 320 + Math.floor(rng() * 640));
  level.setHeader('HEIGHT', 160 + Math.floor(rng() * 320));
  level.setHeader('SPAWN_INTERVAL_LOCKED', rng() > 0.5);

  level.unknownLines.push(`# top_${randomWord(rng, 6)}`);

  if (rng() > 0.3) {
    level.skillset.set('CLIMBER', Math.floor(rng() * 50));
    level.skillset.set('BOMBER', rng() > 0.5 ? 'INFINITE' : Math.floor(rng() * 20));
    level.skillsetUnknownLines = [`# skill_${randomWord(rng, 4)}`];
  }

  const terrainCount = 1 + Math.floor(rng() * 4);
  for (let i = 0; i < terrainCount; i += 1) {
    const terrain = createTerrainEntry({
      styleName: level.getHeader('STYLE'),
      piece: 1 + Math.floor(rng() * 6),
      x: Math.floor(rng() * 300),
      y: Math.floor(rng() * 150),
      oneWay: rng() > 0.7
    });
    if (rng() > 0.5) terrain.unknownLines.push(`# terrain_${randomWord(rng, 4)}`);
    level.terrains.push(terrain);
  }

  const gadgetCount = Math.floor(rng() * 3);
  for (let i = 0; i < gadgetCount; i += 1) {
    const gadget = createGadgetEntry({
      styleName: level.getHeader('STYLE'),
      piece: 1 + Math.floor(rng() * 5),
      x: Math.floor(rng() * 300),
      y: Math.floor(rng() * 150),
      rotate: Math.floor(rng() * 4)
    });
    if (rng() > 0.5) gadget.unknownLines.push(`# gadget_${randomWord(rng, 4)}`);
    level.gadgets.push(gadget);
  }

  if (rng() > 0.4) {
    level.steel.push(createSteelEntry({
      x: Math.floor(rng() * 200),
      y: Math.floor(rng() * 100),
      width: 1 + Math.floor(rng() * 10),
      height: 1 + Math.floor(rng() * 10)
    }));
  }

  if (rng() > 0.4) {
    level.unknownSections.push({
      name: `UNKNOWN_${randomWord(rng, 3).toUpperCase()}`,
      lines: [`# comment_${randomWord(rng, 3)}`, `FOO ${randomWord(rng, 4)}`]
    });
  }

  return level;
};

describe('NXLV fuzz and recovery', function () {
  it('round-trips comments and unknown sections with stable writer output', function () {
    for (let seed = 1; seed <= 50; seed += 1) {
      const level = randomLevel(seed);
      const firstWrite = NxlvWriter.write(level);
      const parsed = NxlvParser.parse(firstWrite);
      const secondWrite = NxlvWriter.write(parsed);
      const thirdWrite = NxlvWriter.write(NxlvParser.parse(secondWrite));

      expect(thirdWrite).to.equal(secondWrite);
      expect(secondWrite).to.contain('TITLE');
      expect(parsed.unknownLines.length).to.be.greaterThan(0);
    }
  });

  it('recovers from malformed payloads without throwing and rewrites safely', function () {
    const malformedSamples = [
      '$END\n$END\nTITLE MissingStart',
      '$TERRAIN\nX nope\nY nope',
      '$SKILLSET\nSKILL BUILDER nope\n$END',
      '$FOO\nBAR baz\n# comment only',
      '# just comments\n# and blank lines',
      '$TERRAINGROUP\n$TERRAIN\nX 10\n$END',
      '$GADGET\nPIECE xzz\nX --\nY ++\n$END'
    ];

    for (const text of malformedSamples) {
      const parsed = NxlvParser.parse(text);
      const rewritten = NxlvWriter.write(parsed);
      expect(parsed).to.be.an('object');
      expect(rewritten).to.be.a('string');
      expect(() => NxlvParser.parse(rewritten)).to.not.throw();
    }
  });
});
