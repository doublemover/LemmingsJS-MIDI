export const TACTILE_GENERATOR_REVISION = 'integer-tactile-regions-v1';
export const TACTILE_REGION_FRAMES = 8000;
export const TACTILE_SOURCE_SPECS = Object.freeze(['open', 'muted'].flatMap((gesture, g) => ['soft', 'firm'].flatMap((intensity, v) =>
  ['a', 'b'].map((alternate, a) => Object.freeze({ id: 'tactile-' + gesture + '-' + intensity + '-' + alternate, gesture, intensity, alternateIndex: a,
    seed: (0x73248151 ^ Math.imul(g + 1, 0x45d9f3b) ^ Math.imul(v + 1, 0x27d4eb2d) ^ Math.imul(a + 1, 0x165667b1)) >>> 0,
    channels: 1, sampleRate: 32000, frames: TACTILE_REGION_FRAMES * 3 })))));
const triangle = phase => { const value = phase >>> 16; return (value < 32768 ? value : 65535 - value) - 16384; };
const scale = (a, b) => Math.imul(a, b) >> 15;

// Eight original sources, each with independent center, edge and brush regions.
// Integer DDS/noise and polynomial decay avoid recordings and platform trig.
export function generateProceduralTactileSource(id) {
  const spec = TACTILE_SOURCE_SPECS.find(entry => entry.id === id);
  if (!spec) throw new TypeError('Unknown original tactile source.');
  const bytes = new Uint8Array(44 + spec.frames * 2), view = new DataView(bytes.buffer);
  const four = (at, text) => { for (let i = 0; i < 4; i++) bytes[at + i] = text.charCodeAt(i); };
  four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, spec.sampleRate, true);
  view.setUint32(28, spec.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  four(36, 'data'); view.setUint32(40, spec.frames * 2, true);
  for (let region = 0; region < 3; region++) {
    let random = (spec.seed ^ Math.imul(region + 1, 0x9e3779b1)) >>> 0, phase = random, overtone = random >>> 1, smooth = 0;
    for (let frame = 0; frame < TACTILE_REGION_FRAMES; frame++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5; random >>>= 0;
      const noise = (random & 32767) - 16384;
      smooth += (noise - smooth) >> (spec.intensity === 'soft' ? 3 : 1);
      phase = (phase + 35114742) >>> 0; overtone = (overtone + (region === 1 ? 95676000 : 70229484)) >>> 0;
      const remaining = Math.floor((TACTILE_REGION_FRAMES - 1 - frame) * 32767 / (TACTILE_REGION_FRAMES - 1));
      let envelope = scale(remaining, remaining);
      if (spec.gesture === 'muted') envelope = scale(scale(envelope, envelope), remaining);
      const transient = Math.max(0, 32767 - frame * (spec.intensity === 'soft' ? 90 : 140));
      let body = region === 2 ? (triangle(phase) >> 2) + (smooth >> 1) :
        (triangle(phase) * (region === 1 ? 3 : 5) >> 3) + (triangle(overtone) >> (region === 1 ? 2 : 3));
      body += scale(noise, transient) >> (spec.intensity === 'soft' ? 3 : 2);
      const fade = Math.min(256, Math.max(0, frame - 16), TACTILE_REGION_FRAMES - 1 - frame);
      const sample = (scale(body, envelope) * fade >> 8) * (spec.intensity === 'soft' ? 3 : 4) >> 2;
      view.setInt16(44 + (region * TACTILE_REGION_FRAMES + frame) * 2, Math.max(-20000, Math.min(20000, sample)), true);
    }
  }
  return bytes;
}
