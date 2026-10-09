const PROCGEN_WORD_POOL = Object.freeze(['WOW', 'FUN', 'GO', 'HI', 'YES', 'HELL', 'DAMN', 'FUCK', 'SHIT', 'BASH', 'LEMM', 'ZOOM', 'NOPE', 'YEP', 'HA', 'BOP', 'JAM', 'BASS', 'MIDI', 'DUET', 'RIFF', 'BEAT', 'POP', 'WET', 'DRIP', 'FLOW', 'SPLASH', 'HUSH', 'SNEAK', 'SHH', 'HOT', 'TEASE', 'MOAN', 'OH', 'GO HI', 'HI YA', 'OH YES', 'I GO', 'I DO']);
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
    if (right > left) {
      const cells = [], feet = [], visited = new Uint8Array(piece.frame.length), components = [];
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) if (!(piece.frame[y * piece.width + x] & 128)) cells.push([x, y]);
      for (const [x, y] of cells) if (y + 1 === piece.height || piece.frame[(y + 1) * piece.width + x] & 128) feet.push([x, y + 1]);
      for (const [x, y] of cells) if (!visited[y * piece.width + x]) {
        const queue = [[x, y]], supportFeet = []; visited[y * piece.width + x] = 1;
        for (let at = 0; at < queue.length; at++) {
          const [px, py] = queue[at];
          if (py + 1 === piece.height || piece.frame[(py + 1) * piece.width + px] & 128) supportFeet.push([px, py + 1]);
          for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) if (nx >= 0 && nx < piece.width && ny >= 0 && ny < piece.height && !(piece.frame[ny * piece.width + nx] & 128) && !visited[ny * piece.width + nx]) {
            visited[ny * piece.width + nx] = 1; queue.push([nx, ny]);
          }
        }
        components.push(supportFeet);
      }
      glyphs.set(String.fromCharCode(65 + index), { piece, left, top, right, bottom, width: right - left, height: bottom - top, cells, feet, components });
    }
  }
  const choices = PROCGEN_WORD_POOL.map(text => ({ text, letters: [...text].filter(letter => letter !== ' ').map(letter => glyphs.get(letter)) }))
    .filter(word => word.letters.every(Boolean)).map(word => ({ ...word,
      width: word.letters.reduce((total, glyph) => total + glyph.width, 0) + (word.letters.length - 1) * GLYPH_SPACING + (word.text.split(' ').length - 1) * 10,
      height: Math.max(...word.letters.map(glyph => glyph.height)) })).filter(word => word.width <= 108);
  if (!choices.length) return null;
  const ids = new Set(Array.from({ length: 27 }, (_, index) => 31 + index));
  return { sourceRevision: recipe.assetSha256, glyphs, ids, choices,
    plan(seed, chunk, width, surfaceAt, solidAt = null) {
      const phase = Math.floor(chunk / 4), code = mix(seed ^ Math.imul(phase + 1, 0x85ebca6b));
      if ((chunk % 4) !== (code % 4) || !solidAt) return null;
      // At most eight cold attempts; glyph components/feet are source-cached.
      for (let attempt = 0; attempt < Math.min(8, choices.length); attempt++) {
        const word = choices[(code + attempt) % choices.length], position = mix(code ^ Math.imul(attempt + 1, 0x9e3779b1));
        const x = 8 + (position >>> 8) % Math.max(1, width - word.width - 16);
        let baseline = Infinity;
        for (let dx = 0; dx < word.width; dx++) baseline = Math.min(baseline, surfaceAt(x + dx));
        if (baseline < word.height + 2 || !Number.isFinite(baseline)) continue;
        const placements = [], readable = []; let at = x, valid = true;
        for (const letter of word.text) {
          if (letter === ' ') { at += 10; continue; }
          const glyph = glyphs.get(letter), px = at - glyph.left, py = baseline - glyph.bottom;
          if (px < 0 || px + glyph.piece.width > width || py < 0 ||
              glyph.cells.some(([dx, dy]) => solidAt(px + dx, py + dy)) ||
              glyph.components.some(feet => !feet.some(([dx, dy]) => solidAt(px + dx, py + dy)))) { valid = false; break; }
          placements.push({ piece: glyph.piece, x: px, y: py, decor: false, flip: false, letter });
          readable.push({ letter, x: at, right: at + glyph.width, baseline }); at += glyph.width + GLYPH_SPACING;
        }
        if (!valid || hasBlockedReadableRun(readable)) continue;
        return { text: word.text, x, y: baseline - word.height, width: word.width, height: word.height, baseline, placements, readable, physical: true };
      }
      return null;
    } };
};
export { PROCGEN_WORD_POOL, GLYPH_SPACING, GLYPH_SOURCE_REVISION, createProcgenWordPlanner, hasBlockedReadableRun };
