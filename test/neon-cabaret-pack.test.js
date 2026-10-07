import assert from 'node:assert/strict';
import { createNeonCabaretPack } from '../js/decorations/NeonCabaretPack.js';
import { createNeonCabaretTheme } from '../js/decorations/NeonCabaretTheme.js';
import { TriggerTypes } from '../js/level/TriggerTypes.js';
describe('Neon Cabaret indexed asset contract', () => {
  it('has deterministic, bounded, visible animation frames with valid palette indices', () => {
    const a = createNeonCabaretPack(), b = createNeonCabaretPack();
    assert.equal(a.id, 'neon-cabaret'); assert.equal(new Set(a.pieces.map(p => p.id)).size, 6);
    for (const [i, p] of a.pieces.entries()) {
      assert.equal(p.image.frames.length, 16); assert.deepEqual(p.image.frames, b.pieces[i].image.frames);
      const limits = { ceiling: [120, 28], stage: [112, 64], trim: [128, 16] }[p.placement];
      assert.ok(p.width <= limits[0] && p.height <= limits[1]);
      for (const f of p.image.frames) { assert.equal(f.length, p.width * p.height); assert.ok(f.some(c => c !== 128)); assert.ok(f.every(c => c === 128 || c < 20)); }
      assert.equal(p.image.palette.getColor(10) >>> 24, 255);
    }
  });
  it('keeps hazards out of the decoration catalog and provides in-bounds fixed trigger contracts', () => {
    const theme = createNeonCabaretTheme();
    assert.equal(theme.hazards.length, 3);
    assert.deepEqual(theme.hazards.map(h => h.triggerEffectId), [TriggerTypes.FRYING, TriggerTypes.TRAP, TriggerTypes.DROWN]);
    for (const h of theme.hazards) { const r = h.trigger; assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0); assert.ok(r.x + r.width <= h.width && r.y + r.height <= h.height); assert.ok(!theme.pieces.some(p => p.id === h.id)); }
    assert.ok(theme.pieces.every(p => p.triggerEffectId === undefined));
  });
  it('includes six original terrain pieces, one steel piece and masked arch geometry', () => {
    const theme = createNeonCabaretTheme(); assert.equal(theme.terrainPieces.length, 6);
    assert.equal(theme.terrainPieces.filter(p => p.isSteel).length, 1);
    const arch = theme.terrainPieces[5]; assert.equal(arch.image.frames[0][18 * arch.width + 28], 128);
    for (const p of theme.terrainPieces) assert.equal(p.image.frames[0].length, p.width * p.height);
  });
  it('bounds raw indexed storage below 512 KiB', () => {
    const t = createNeonCabaretTheme(); const bytes = [...t.pieces, ...t.terrainPieces, ...t.hazards].reduce((n, p) => n + p.image.frames.reduce((s, f) => s + f.byteLength, 0), 0); assert.ok(bytes < 512 * 1024, `${bytes} bytes`);
  });
});
