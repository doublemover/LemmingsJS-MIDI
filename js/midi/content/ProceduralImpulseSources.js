export const IMPULSE_GENERATOR_REVISION = 'integer-reflection-bodies-v1';
export const IMPULSE_SOURCE_SPECS = Object.freeze([
  { id: 'quarry-hollow-spring', name: 'Hollow Spring', channels: 1, frames: 38400, seed: 0x743da12b, spacing: 619, damping: 4, predelaySeconds: 0.018, referenceGain01: 0.05 },
  { id: 'quarry-stone-courtyard', name: 'Stone Courtyard', channels: 2, frames: 25600, seed: 0x4b187235, spacing: 953, damping: 5, predelaySeconds: 0.012, referenceGain01: 0.05 },
  { id: 'quarry-crossed-gallery', name: 'Crossed Gallery', channels: 4, frames: 51200, seed: 0x3927ac51, spacing: 1373, damping: 6, predelaySeconds: 0.026, referenceGain01: 0.025 }
].map(spec => Object.freeze({ ...spec, sampleRate: 32000, kind: 'impulse-response' })));
const triangle = phase => { const value = phase >>> 16; return (value < 32768 ? value : 65535 - value) - 16384; };
const multiply = (a, b) => Math.imul(a, b) >> 15;

// Original synthetic reflection/body data; no recording or hardware response.
// Integer arithmetic makes the encoded identity independent of platform trig.
export function generateProceduralImpulseSource(id) {
  const spec = IMPULSE_SOURCE_SPECS.find(entry => entry.id === id);
  if (!spec) throw new TypeError('Unknown original impulse body.');
  const bytes = new Uint8Array(44 + spec.frames * spec.channels * 2), view = new DataView(bytes.buffer);
  const four = (at, value) => { for (let i = 0; i < 4; i++) bytes[at + i] = value.charCodeAt(i); };
  four(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); four(8, 'WAVE'); four(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, spec.channels, true); view.setUint32(24, spec.sampleRate, true);
  view.setUint32(28, spec.sampleRate * spec.channels * 2, true); view.setUint16(32, spec.channels * 2, true); view.setUint16(34, 16, true);
  four(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  for (let channel = 0; channel < spec.channels; channel++) {
    let random = (spec.seed ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0, phase = random, overtone = random >>> 1, smooth = 0;
    const offset = channel * 73, spacing = spec.spacing + channel * 58;
    for (let frame = 0; frame < spec.frames; frame++) {
      random ^= random << 13; random ^= random >>> 17; random ^= random << 5; random >>>= 0;
      smooth += (((random & 32767) - 16384) - smooth) >> spec.damping;
      phase = (phase + 31234567 + channel * 174321 + Math.floor(frame * 1297 / spec.frames)) >>> 0;
      overtone = (overtone + 78945613 + channel * 917231) >>> 0;
      const remaining = Math.floor((spec.frames - 1 - frame) * 32767 / (spec.frames - 1));
      const decay = multiply(multiply(remaining, remaining), remaining);
      const local = frame - offset, reflection = local >= 0 && local % spacing < 32 ? ((random & 8191) - 4096) : 0;
      const resonant = spec.channels === 1 ? (triangle(phase) >> 4) + (triangle(overtone) >> 5) : (triangle(phase) >> 6);
      const fade = Math.min(256, Math.max(0, frame - 8), spec.frames - 1 - frame);
      // Cross paths in the four-channel native matrix are independently authored.
      const crossGain = spec.channels === 4 && channel >= 2 ? 16384 : 32767;
      const value = multiply(multiply((smooth >> 1) + resonant + reflection, decay), crossGain) * fade >> 8;
      view.setInt16(44 + (frame * spec.channels + channel) * 2, Math.max(-16000, Math.min(16000, value)), true);
    }
  }
  return bytes;
}
