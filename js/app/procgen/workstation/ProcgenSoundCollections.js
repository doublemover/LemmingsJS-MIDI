const PROCGEN_ROLES = Object.freeze(['lead', 'arp', 'bass', 'percussion', 'drums', 'chords', 'melody', 'texture']);
// Retained family aliases and performance recipes; zero-based GM programs are migration defaults only.
// Native definitions live in NativeSoundCollections and never imply a physical world rebuild.
const families = [
  ['rock', 'Rock', [29, 12, 34, 115, 0, 61, 26, 95], 0, 1.12, 0.64],
  ['holiday-snow', 'Holiday Snow', [9, 10, 32, 112, 0, 48, 8, 89], 12, 0.9, 1.2],
  ['brick', 'Brick', [56, 11, 33, 113, 0, 62, 57, 90], 0, 1.05, 0.82],
  ['snow', 'Snow', [73, 14, 43, 9, 0, 49, 72, 88], 12, 0.76, 1.55],
  ['bubble', 'Bubble', [80, 81, 38, 114, 0, 5, 82, 99], 12, 0.94, 0.45],
  ['dirt', 'Dirt', [24, 25, 32, 116, 0, 0, 22, 91], -12, 0.98, 0.92],
  ['fire', 'Fire', [30, 87, 39, 117, 0, 63, 81, 97], 0, 1.18, 0.56],
  ['squasher', 'Squasher', [84, 15, 35, 118, 0, 18, 85, 101], -12, 1.08, 0.34],
  ['pillar', 'Pillar', [68, 46, 42, 47, 0, 52, 71, 92], 0, 0.82, 1.85],
  ['crystal', 'Crystal', [10, 98, 36, 14, 0, 89, 8, 100], 12, 0.9, 1.05]
];
const roleProfiles = {
  lead: { octave: 5, velocity: 93, duration: 0.28, rhythm: [0, 3, 6, 8, 11, 14], degrees: [0, 2, 4, 6, 4, 1], action: 'build' },
  arp: { octave: 5, velocity: 76, duration: 0.16, rhythm: [0, 2, 4, 6, 8, 10, 12, 14], degrees: [0, 2, 4, 6, 7, 4, 2, 1], action: 'climb' },
  bass: { octave: 2, velocity: 102, duration: 0.42, rhythm: [0, 4, 7, 8, 12], degrees: [0, 0, 4, 3, 4], action: 'dig' },
  percussion: { octave: 4, velocity: 80, duration: 0.1, rhythm: [2, 5, 6, 10, 13, 15], degrees: [0, 4, 2, 0, 5, 2], action: 'bash' },
  drums: { octave: 2, velocity: 110, duration: 0.12, rhythm: [0, 2, 4, 6, 8, 10, 12, 14], degrees: [36, 42, 38, 42, 36, 46, 38, 42], action: 'explode' },
  chords: { octave: 4, velocity: 70, duration: 1.6, rhythm: [0, 8], degrees: [0, 3], action: 'block' },
  melody: { octave: 5, velocity: 84, duration: 0.65, rhythm: [0, 4, 6, 10, 12], degrees: [4, 2, 0, 1, 3], action: 'float' },
  texture: { octave: 4, velocity: 53, duration: 3.6, rhythm: [0], degrees: [0], action: 'fall' }
};
const PROCGEN_SOUND_COLLECTIONS = Object.freeze(families.map(([id, name, programs, transpose, dynamics, articulation], familyIndex) => ({
  id, name,
  roles: PROCGEN_ROLES.map((role, roleIndex) => {
    const base = roleProfiles[role];
    const patches = [0, 1].map(variant => ({
      id: `${id}-${role}${variant ? '-soft' : ''}`, name: `${name} ${role}${variant ? ' soft' : ''}`,
      program: programs[roleIndex], percussion: role === 'drums', octave: base.octave + (role === 'bass' ? 0 : transpose / 12),
      velocity: Math.min(127, Math.round(base.velocity * dynamics * (variant ? 0.72 : 1))),
      duration: base.duration * articulation * (variant ? 1.3 : 1),
      playbackGain: variant ? 0.72 : 1, playbackDuration: variant ? 1.3 : 1,
      envelope: { attack: role === 'texture' ? 0.7 : role === 'chords' ? 0.15 : 0, decay: 0.15 + familyIndex * 0.025, sustain: role === 'texture' ? 0.8 : 0.5, release: Math.min(2, articulation * 0.3) },
      timbre: Math.round(42 + familyIndex * 6 + roleIndex * 2),
      rhythm: base.rhythm.map(step => (step + (role === 'drums' ? 0 : familyIndex % 3)) % 16),
      degrees: base.degrees.map((degree, index) => role === 'drums' ? degree : degree + (index % 3 === 1 ? familyIndex % 3 - 1 : 0)),
      eventResponse: { action: base.action, degree: familyIndex % 5, velocity: 1 + familyIndex * 0.025, duration: articulation }
    }));
    return { id: role, name: role[0].toUpperCase() + role.slice(1), patches };
  })
})));
const resolveProcgenSound = (family = 'crystal', role = 'lead', patch) => {
  const collection = PROCGEN_SOUND_COLLECTIONS.find(item => item.id === family) || PROCGEN_SOUND_COLLECTIONS[9];
  const voice = collection.roles.find(item => item.id === role) || collection.roles[0];
  return voice.patches.find(item => item.id === patch) || voice.patches[0];
};
const PROCGEN_DEFAULT_PAIRS = Object.freeze([
  ['crystal', 'lead'], ['bubble', 'arp'], ['dirt', 'bass'], ['rock', 'percussion'],
  ['fire', 'drums'], ['brick', 'chords'], ['snow', 'melody'], ['pillar', 'texture']
]);
export { PROCGEN_ROLES, PROCGEN_SOUND_COLLECTIONS, PROCGEN_DEFAULT_PAIRS, resolveProcgenSound };
