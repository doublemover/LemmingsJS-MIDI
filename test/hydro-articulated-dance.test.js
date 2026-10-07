import assert from 'node:assert/strict';
import { createHydroRevue } from '../js/decorations/HydroRevue.js';
import { HYDRO_REVUE_PIXELS } from '../js/decorations/HydroRevuePixels.js';
function decode(encoded) {
  const bytes = Buffer.from(encoded, 'base64'), values = [];
  for (let i = 0; i < bytes.length; i += 2) for (let j = 0; j < bytes[i]; j++) values.push(bytes[i + 1]);
  return Uint8Array.from(values);
}
describe('authored articulated hydro dances', () => {
  it('plays the 24 imported pose frames directly, with no runtime image deformation', () => {
    const pieces = createHydroRevue();
    assert.equal(HYDRO_REVUE_PIXELS.format, 'hydro-articulated-loops-v2');
    assert.equal(HYDRO_REVUE_PIXELS.encoding, 'rle8');
    assert.equal(pieces.length, 3); assert.equal(HYDRO_REVUE_PIXELS.holdTicks, 2);
    for (const [i, piece] of pieces.entries()) {
      assert.equal(piece.animationMode, 'articulated-keyframes'); assert.equal(piece.keyframeCount, 8);
      assert.equal(new Set(piece.image.frames).size, 8); assert.equal(piece.image.frames.length, 16);
      for (let phase = 0; phase < 8; phase++) {
        const frame = piece.image.frames[phase * 2];
        assert.strictEqual(frame, piece.image.frames[phase * 2 + 1]);
        assert.deepEqual(frame, decode(HYDRO_REVUE_PIXELS.loops[i].keyframes[phase]));
      }
    }
  });
  it('has distinct articulated limb silhouettes, stable floor registration and clear blue bodies', () => {
    for (const piece of createHydroRevue()) {
      const masks = new Set();
      for (let phase = 0; phase < 16; phase += 2) {
        const frame = piece.image.frames[phase]; let bottom = 0, body = 0, blue = 0;
        const lowerBody = [];
        for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
          const index = frame[y * 192 + x];
          if (y >= 100) lowerBody.push(index === 128 ? 0 : 1);
          if (index === 128) continue;
          bottom = Math.max(bottom, y); assert.ok(x > 0 && x < 191);
          if (y >= 50 && y < 170) {
            body++; const color = piece.image.palette.getColor(index), r = color & 255, g = color >>> 8 & 255, b = color >>> 16 & 255;
            if (b > r * 1.35 && b > g * 1.08 && b > 60) blue++;
          }
        }
        assert.ok(bottom >= 185 && bottom <= 188, `${piece.id} bottom ${bottom}`);
        assert.ok(blue / body > 0.2, `${piece.id} blue coverage`);
        masks.add(Buffer.from(lowerBody).toString('base64'));
      }
      assert.equal(masks.size, 8, `${piece.id} must use eight different leg poses`);
    }
  });
  it('shares held frames and keeps decoded artwork below one MiB', () => {
    const unique = new Set(createHydroRevue().flatMap(p => p.image.frames));
    assert.equal(unique.size, 24);
    assert.ok([...unique].reduce((n, frame) => n + frame.byteLength, 0) < 1048576);
    assert.strictEqual(createHydroRevue(), createHydroRevue());
  });
});
