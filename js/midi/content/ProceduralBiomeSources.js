export const BIOME_GENERATOR_REVISION = 'integer-biome-textures-v1';
export const BIOME_SOURCE_SPECS = Object.freeze([
  Object.freeze({ id: 'rain-glass', seed: 0x123ab17, channels: 1, sampleRate: 32000, frames: 64000 }),
  Object.freeze({ id: 'gravel-choir', seed: 0x9c83d21, channels: 1, sampleRate: 32000, frames: 64000 }),
  Object.freeze({ id: 'water-lens', seed: 0x4e761ab, channels: 2, sampleRate: 32000, frames: 64000 }),
  Object.freeze({ id: 'rust-breath', seed: 0x6a724c1, channels: 1, sampleRate: 32000, frames: 64000 })
]);
const clamp = value => Math.max(-20000, Math.min(20000, value | 0));

// Original integer arithmetic textures, with no recordings or platform trig.
export function generateProceduralBiomeSource(id) {
  const spec = BIOME_SOURCE_SPECS.find(entry => entry.id === id);
  if (!spec) throw new TypeError('Unknown fixed procedural biome source.');
  const bytes = new Uint8Array(44 + spec.frames * spec.channels * 2), view = new DataView(bytes.buffer);
  const four = (at, text) => { for (let index = 0; index < 4; index++) bytes[at + index] = text.charCodeAt(index); };
  four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, spec.channels, true); view.setUint32(24, spec.sampleRate, true);
  view.setUint32(28, spec.sampleRate * spec.channels * 2, true); view.setUint16(32, spec.channels * 2, true); view.setUint16(34, 16, true);
  four(36, 'data'); view.setUint32(40, spec.frames * spec.channels * 2, true);
  for (let channel = 0; channel < spec.channels; channel++) {
    let random = (spec.seed ^ Math.imul(channel + 1, 0x45d9f3b)) >>> 0, slow = 0, smooth = 0, ring = 0, phase = 0;
    for (let frame = 0; frame < spec.frames; frame++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5; random >>>= 0;
      const noise = (random & 32767) - 16384; slow += (noise - slow) >> 6; smooth += (slow - smooth) >> 5;
      let sample;
      if (id === 'rain-glass') {
        const impulse = (random & 1023) < 5 ? noise >> 1 : 0;
        ring = clamp((ring * 4020 >> 12) + impulse); sample = clamp(ring + (noise >> 5));
      } else if (id === 'gravel-choir') {
        const roughness = Math.abs(slow) + 512;
        sample = clamp((noise - slow) * roughness >> 12);
      } else if (id === 'water-lens') {
        phase = (phase + 97 + (Math.abs(smooth) >> 4) + channel * 13) & 65535;
        const triangle = (phase < 32768 ? phase : 65535 - phase) - 16384;
        ring = clamp((ring * 4080 >> 12) + (noise >> 5)); sample = clamp((smooth * 2) + (triangle * (Math.abs(slow) + 128) >> 12) + (ring >> 2));
      } else {
        const friction = noise > 4096 ? (noise - 4096) >> 1 : noise < -4096 ? (noise + 4096) >> 1 : 0;
        ring = clamp((ring * 3950 >> 12) + friction); sample = clamp((ring >> 1) + slow * 2 - smooth);
      }
      const fade = Math.min(256, frame, spec.frames - 1 - frame); sample = sample * fade >> 8;
      view.setInt16(44 + (frame * spec.channels + channel) * 2, sample, true);
    }
  }
  return bytes;
}
