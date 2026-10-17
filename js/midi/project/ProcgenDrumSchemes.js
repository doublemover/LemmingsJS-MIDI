import { SoundEffectIds } from '../../game/SoundEvents.js';

const definitions = [
  ['procgen-drum-pocket', 'Pocket kit', 'Kick, snare and closed hats; clear accents with sparse fills.', [36, 38, 42, 46, 49, 37]],
  ['procgen-drum-breakbeat', 'Breakbeat crew', 'Punchy kicks, claps and alternating hats answer construction and turns.', [35, 39, 42, 46, 57, 38]],
  ['procgen-drum-toms', 'Tom procession', 'Low-to-high tom replies with kick anchors and short cymbal arrivals.', [36, 41, 43, 47, 49, 50]],
  ['procgen-drum-hand', 'Hand percussion', 'Congas, bongos and claves make a light interlocking ensemble.', [64, 63, 60, 61, 75, 62]],
  ['procgen-drum-soft', 'Soft ticks', 'Side-stick, shaker and tambourine; quiet detailed movement.', [37, 54, 69, 70, 42, 76]],
  ['procgen-drum-metal', 'Metal workshop', 'Cowbell, ride bell and triangles articulate the building work.', [56, 53, 80, 81, 51, 59]]
];
const PROCGEN_DRUM_SCHEMES = Object.freeze(definitions.map(([id, label, description, kit]) => Object.freeze({ id, label, description,
  family: 'Percussion', percussion: true, scale: { name: 'chromatic', root: 0, degrees: Array.from({ length: 12 }, (_, index) => index) }, kit: Object.freeze(kit) })));
const createProcgenDrumMappings = preset => {
  const [kick, snare, hat, open, crash, fill] = preset.kit;
  const voices = {
    SPAWN: [hat], LAND: [kick], BUILDER_STEP: [hat, hat, open, hat], BASH: [snare, hat, snare, fill],
    DIG: [kick, hat], MINE: [kick, fill, hat], BLOCKER_TURN: [hat, fill], BLOCKER_CONTACT: [hat, snare],
    BUILDER_WARNING: [fill, snare], STEEL_HIT: [crash], EXIT: [crash, snare], ENTRANCE_OPEN: [kick],
    PROCGEN_ROUTE_COMPLETE: [crash], OHNO: [fill], COUNTDOWN: [hat, fill], EXPLOSION: [kick, crash], SPLAT: [kick], DROWN: [open], FELL_OFF: [fill],
    TRAP_ZAP: [crash], TRAP_SQUISH: [kick], TRAP_SLICER: [snare], TRAP_FIRE: [open, fill], TRAP_TEN_TON: [kick], TRAP_BEAR: [snare]
  };
  const mappings = new Map();
  for (const [action, notes] of Object.entries(voices)) {
    const id = SoundEffectIds[action]; if (!Number.isInteger(id)) continue;
    mappings.set(id, { name: `${action.toLowerCase().replaceAll('_', ' ')} - ${preset.label}`, note: notes[0],
      ...(notes.length > 1 ? { notes: [...notes], arp: { enabled: true, mode: 'up', length: notes.length } } : {}),
      percussion: true, velocity: action === 'SPAWN' ? 24 : action === 'LAND' ? 36 : action === 'PROCGEN_ROUTE_COMPLETE' ? 64 : 52,
      durationTicks: 1, timbre: null, pitchBend: null });
  }
  return mappings;
};
export { PROCGEN_DRUM_SCHEMES, createProcgenDrumMappings };
