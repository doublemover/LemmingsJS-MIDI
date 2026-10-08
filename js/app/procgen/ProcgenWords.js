const PROCGEN_WORD_POOL = Object.freeze(['WOW', 'FUN', 'GO', 'HI', 'YES', 'HELL', 'DAMN', 'FUCK', 'SHIT', 'BASH', 'LEMM', 'ZOOM', 'NOPE', 'YEP', 'HA']);
const BLOCKED_RUNS = new Set(['NIGGER', 'NIGGA', 'FAG', 'FAGGOT', 'KIKE', 'SPIC', 'CHINK', 'TRANNY']);
const GLYPH_SPACING = 5;
const GLYPH_SOURCE_REVISION = '49df39b5aefcef219376f06a24ed3fe12c5efb21ad641ebe6549e46909e60839';
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

const hasBlockedReadableRun = glyphs => {
  const lines = [];
  for (const glyph of glyphs) {
    let line = lines.find(candidate => Math.abs(candidate.baseline - glyph.baseline) <= 3);
    if (!line) { line = { baseline: glyph.baseline, glyphs: [] }; lines.push(line); }
    line.glyphs.push(glyph);
  }
  for (const line of lines) {
    line.glyphs.sort((a, b) => a.x - b.x);
    let text = '', previous = null;
    for (const glyph of line.glyphs) {
      const gap = previous ? glyph.x - previous.right : 0;
      if (previous && (gap > GLYPH_SPACING + 2 || gap < -2)) {
        if (BLOCKED_RUNS.has(text)) return true;
        text = '';
      }
      text += glyph.letter.toUpperCase(); previous = glyph;
    }
    if (BLOCKED_RUNS.has(text)) return true;
  }
  return false;
};

const createProcgenWordPlanner = (recipe, pieces) => {
  if (recipe.assetSha256 !== GLYPH_SOURCE_REVISION) return null;
  if (!recipe.sources?.some(source => source.pack === 'lemmings' && source.groundSet === 1)) return null;
  const glyphs = new Map();
  for (let index = 0; index < 26; index++) {
    const piece = pieces.find(p => p.id === 31 + index);
    if (!piece || piece.height !== 38 || piece.width !== (index === 12 || index === 16 || index === 22 ? 64 : 32)) continue;
    let left = piece.width, top = piece.height, right = 0, bottom = 0;
    for (let y = 0; y < piece.height; y++) for (let x = 0; x < piece.width; x++) if (!(piece.frame[y * piece.width + x] & 128)) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    if (right > left) glyphs.set(String.fromCharCode(65 + index), { piece, left, top, right, bottom, width: right - left, height: bottom - top });
  }
  const choices = PROCGEN_WORD_POOL.map(text => ({ text, letters: [...text].map(letter => glyphs.get(letter)) }))
    .filter(word => word.letters.every(Boolean)).map(word => ({ ...word,
      width: word.letters.reduce((total, glyph) => total + glyph.width, 0) + (word.letters.length - 1) * GLYPH_SPACING,
      height: Math.max(...word.letters.map(glyph => glyph.height)) })).filter(word => word.width <= 108);
  if (!choices.length) return null;
  const ids = new Set(Array.from({ length: 27 }, (_, index) => 31 + index));
  return { sourceRevision: recipe.assetSha256, glyphs, ids, choices,
    plan(seed, chunk, width, surfaceAt) {
      const phase = Math.floor(chunk / 4), code = mix(seed ^ Math.imul(phase + 1, 0x85ebca6b));
      if ((chunk % 4) !== (code % 4)) return null;
      for (let attempt = 0; attempt < choices.length; attempt++) {
        const word = choices[(code + attempt) % choices.length], x = 8 + (code >>> 8) % Math.max(1, width - word.width - 16);
        let baseline = 48;
        for (let dx = -2; dx < word.width + 2; dx++) baseline = Math.min(baseline, surfaceAt(x + dx) - 4);
        if (baseline < word.height + 2) continue;
        const placements = [], readable = []; let at = x;
        for (let index = 0; index < word.letters.length; index++) {
          const glyph = word.letters[index], letter = word.text[index];
          placements.push({ piece: glyph.piece, x: at - glyph.left, y: baseline - glyph.bottom, decor: true, flip: false, letter });
          readable.push({ letter, x: at, right: at + glyph.width, baseline }); at += glyph.width + GLYPH_SPACING;
        }
        if (hasBlockedReadableRun(readable)) continue;
        return { text: word.text, x, y: baseline - word.height, width: word.width, height: word.height, baseline, placements, readable };
      }
      return null;
    } };
};
export { PROCGEN_WORD_POOL, GLYPH_SPACING, GLYPH_SOURCE_REVISION, createProcgenWordPlanner, hasBlockedReadableRun };
