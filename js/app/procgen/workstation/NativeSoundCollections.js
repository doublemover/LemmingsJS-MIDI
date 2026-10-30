import { PROCGEN_SOUND_COLLECTIONS, resolveProcgenSound } from './ProcgenSoundCollections.js';

const collection = (id, name, source, patchIds) => Object.freeze({ id, name, source, patchIds: Object.freeze(patchIds) });
export const NATIVE_SOUND_COLLECTIONS = Object.freeze([
  collection('native', 'Oscillator foundation', new URL('../../../../content/sounds/native.json', import.meta.url), ['foundation.soft-triangle', 'foundation.short-sine', 'foundation.held-sine', 'foundation.short-square']),
  collection('fm-forge', 'FM Forge', new URL('../../../../content/sounds/fm-forge.json', import.meta.url), ['forge.glass-rivet', 'forge.copper-tine', 'forge.alarm-bloom', 'forge.rubber-bolt']),
  collection('struck-materials', 'Struck materials', new URL('../../../../content/sounds/struck-materials.json', import.meta.url), ['material.timber', 'material.slate', 'material.glass', 'material.sheet-metal', 'material.unclassified']),
  collection('plucked-garden', 'Plucked garden', new URL('../../../../content/sounds/plucked-garden.json', import.meta.url), ['pluck.burrow-thumb', 'pluck.wire-ladder', 'pluck.moss-nylon', 'pluck.suspended-zither']),
  collection('artificial-choir', 'Artificial choir', new URL('../../../../content/sounds/artificial-choir.json', import.meta.url), ['choir.hollow-ooh', 'choir.paper-aah', 'choir.tiny-ee', 'choir.robot-choir']),
  collection('liquid-drawbars', 'Liquid tables / drawbars', new URL('../../../../content/sounds/liquid-drawbars.json', import.meta.url), ['spectrum.bubble-reed', 'spectrum.prism-pad', 'spectrum.acid-current-dry', 'spectrum.pipe-crew', 'spectrum.glass-drawbars', 'spectrum.falling-stars']),
  collection('circular-travel', 'Circular travel spectra', new URL('../../../../content/sounds/circular-travel.json', import.meta.url), ['circular.endless-stair', 'circular.counter-walk', 'circular.action-stair', 'circular.stepping-stones', 'circular.route-stair'])
]);
const byPatch = new Map(NATIVE_SOUND_COLLECTIONS.flatMap(entry => entry.patchIds.map(id => [id, entry])));
const lead = { rock: 'material.slate', 'holiday-snow': 'forge.copper-tine', brick: 'forge.alarm-bloom', snow: 'choir.hollow-ooh', bubble: 'spectrum.bubble-reed', dirt: 'pluck.burrow-thumb', fire: 'forge.rubber-bolt', squasher: 'foundation.short-square', pillar: 'spectrum.pipe-crew', crystal: 'forge.glass-rivet' };
const roles = { arp: 'pluck.wire-ladder', bass: 'pluck.burrow-thumb', percussion: 'material.timber', drums: 'material.sheet-metal', chords: 'choir.paper-aah', melody: 'choir.tiny-ee', texture: 'spectrum.prism-pad' };
export function resolveLegacySoundAlias({ family = 'crystal', role = 'lead', patch = null } = {}) {
  const collection = PROCGEN_SOUND_COLLECTIONS.find(entry => entry.id === family), voice = collection?.roles.find(entry => entry.id === role);
  if (!voice || patch != null && !voice.patches.some(entry => entry.id === patch)) throw new Error('Unknown legacy sound alias.');
  const sound = resolveProcgenSound(family, role, patch), soft = sound.id.endsWith('-soft');
  const patchId = soft ? ['chords', 'texture'].includes(role) ? 'choir.hollow-ooh' : ['percussion', 'drums'].includes(role) ? 'material.unclassified' : 'foundation.soft-triangle' : role === 'lead' ? lead[family] : roles[role];
  return Object.freeze({ version: 1, aliasId: sound.id, collectionId: byPatch.get(patchId).id, patchId,
    lanePatch: Object.freeze({ family, role, patch: sound.id, performanceRecipeId: sound.id, linkedThemePresetId: family }),
    externalProgramChanged: false, physicalWorldChanged: false, equivalence: 'declared-native-alias-not-bit-identical-GM-emulation' });
}
export function nativeSoundCollection(patchId) { const result = byPatch.get(patchId); if (!result) throw new Error('Unknown native sound collection patch.'); return result; }
