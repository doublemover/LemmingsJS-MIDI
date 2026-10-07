// Audited GROUND/VGAGR objects; sounds and palette colors do not identify hazards.
const ORIGINAL = Object.freeze({
  0: { 5: 'water', 6: 'bite', 8: 'crush', 10: 'crush' },
  1: { 5: 'lava', 7: 'fire', 8: 'fire', 10: 'fire' },
  2: { 5: 'acid', 8: 'crush', 9: 'slice' },
  3: { 5: 'water', 8: 'slice', 9: 'spikes', 10: 'spikes' },
  4: { 6: 'water', 7: 'slice', 9: 'electric', 10: 'electric' }
});
const OHNO = Object.freeze({
  0: { 5: 'water', 6: 'crush', 7: 'crush' },
  1: { 5: 'water', 6: 'tentacle', 8: 'bite', 10: 'bite' },
  2: { 5: 'water', 8: 'spikes', 9: 'ice' },
  3: { 5: 'water', 8: 'electric', 9: 'suction' }
});
const PACKS = Object.freeze({ lemmings: ORIGINAL, lemmings_ohno: OHNO,
  xmas91: { 0: OHNO[0] }, xmas92: {}, holiday93: { 1: OHNO[1] }, holiday94: { 1: OHNO[1] } });
const CHARACTER_HAZARD_KINDS = Object.freeze(['water', 'acid', 'lava', 'fire', 'crush', 'slice', 'spikes', 'bite', 'tentacle', 'suction', 'electric', 'ice']);

function classifyClassicHazard(folder, filename, objectId) {
  const pack = String(folder).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  const match = /^GROUND(\d+)O\.DAT$/i.exec(String(filename));
  return match ? PACKS[pack]?.[Number(match[1])]?.[objectId] || null : null;
}

export { classifyClassicHazard, CHARACTER_HAZARD_KINDS };
