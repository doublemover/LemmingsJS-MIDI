import { HYDRO_REVUE_PIXELS } from './HydroRevuePixels.js';
const rgba = hex => { const n = parseInt(hex.slice(1), 16); return (0xff000000 | (n & 255) << 16 | (n & 65280) | n >>> 16) >>> 0; };
const palette = { getColor: i => rgba(HYDRO_REVUE_PIXELS.palette[i] || '#120b12') };
let cached;
function createHydroRevue() {
  if (cached) return cached;
  const { width, height } = HYDRO_REVUE_PIXELS;
  cached = HYDRO_REVUE_PIXELS.poses.map((encoded, pose) => {
    const source = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const frames = Array.from({ length: 16 }, (_, phase) => {
      const frame = new Uint8Array(width * height).fill(128), a = phase * Math.PI / 8;
      for (let y = 0; y < height; y++) {
        const hipWeight = Math.exp(-(((y - 98) / 29) ** 2)), torsoWeight = Math.exp(-(((y - 64) / 24) ** 2)), headWeight = Math.exp(-(((y - 27) / 26) ** 2));
        const sway = Math.sin(a) * (pose === 1 ? 5 : 3) * hipWeight - Math.sin(a - 0.55) * 2 * torsoWeight + Math.sin(a - 0.9) * headWeight;
        const bounce = Math.cos(a * 2) * 2 * Math.min(1, (height - y) / 60);
        const sy = Math.round(y - bounce);
        if (sy < 0 || sy >= height) continue;
        for (let x = 0; x < width; x++) { const sx = Math.round(x - sway); if (sx >= 0 && sx < width) frame[y * width + x] = source[sy * width + sx]; }
      }
      return frame;
    });
    return { id: ['hydro-showgirl', 'hydro-showgirl-charleston', 'hydro-showgirl-kickline'][pose], name: ['hydro grand revue · hip shimmy', 'hydro grand revue · Charleston', 'hydro grand revue · kickline'][pose], width, height, placement: 'stage', interactive: false, paletteColors: HYDRO_REVUE_PIXELS.palette, image: { width, height, frames, palette } };
  });
  return cached;
}
export { createHydroRevue };
