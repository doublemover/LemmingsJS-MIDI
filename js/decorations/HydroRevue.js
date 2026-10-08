import { HYDRO_REVUE_PIXELS } from './HydroRevuePixels.js';
const rgba = hex => { const n = parseInt(hex.slice(1), 16); return (0xff000000 | (n & 255) << 16 | (n & 65280) | n >>> 16) >>> 0; };
const palette = { getColor: i => rgba(HYDRO_REVUE_PIXELS.palette[i] || '#120b12') };
function decodePose(encoded, length) {
  const runs = atob(encoded), pixels = new Uint8Array(length); let cursor = 0;
  if (runs.length % 2) throw new Error('Invalid articulated pose runs');
  for (let i = 0; i < runs.length; i += 2) {
    const count = runs.charCodeAt(i), value = runs.charCodeAt(i + 1);
    if (!count || value > 128 || cursor + count > length) throw new Error('Invalid articulated pose bounds');
    pixels.fill(value, cursor, cursor + count); cursor += count;
  }
  if (cursor !== length) throw new Error('Incomplete articulated pose');
  return pixels;
}
let cached;
function createHydroRevue() {
  if (cached) return cached;
  const { width, height, holdTicks } = HYDRO_REVUE_PIXELS;
  cached = HYDRO_REVUE_PIXELS.loops.map((loop, pose) => {
    const keyframes = loop.keyframes.map(encoded => decodePose(encoded, width * height));
    const frames = keyframes.flatMap(frame => Array(holdTicks).fill(frame));
    return { id: ['hydro-showgirl', 'hydro-showgirl-charleston', 'hydro-showgirl-kickline'][pose], name: ['hydro grand revue · hip shimmy', 'hydro grand revue · Charleston', 'hydro grand revue · kickline'][pose],
      width, height, placement: 'stage', interactive: false, animationMode: 'articulated-keyframes', keyframeCount: keyframes.length,
      paletteColors: HYDRO_REVUE_PIXELS.palette, image: { width, height, frames, palette } };
  });
  return cached;
}
export { createHydroRevue };
