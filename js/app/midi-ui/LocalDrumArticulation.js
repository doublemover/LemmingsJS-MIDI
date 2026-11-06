import { validateDrumKitBinding, resolveDrumKitStrike } from '../../midi/content/DrumKitDefinition.js';
const kits = new WeakMap();
export function resolveLocalDrumArticulation(reference, { note, velocity01, instanceId } = {}) {
  if (!reference?.drumKit) return null;
  let kit = kits.get(reference); if (!kit) { kit = validateDrumKitBinding(reference.drumKit.definition, reference.definition); kits.set(reference, kit); }
  return resolveDrumKitStrike(kit, { gmNote: note, intensity01: velocity01, instanceId });
}
