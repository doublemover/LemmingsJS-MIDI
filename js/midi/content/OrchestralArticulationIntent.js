const rows = [
  ['sustain', 'normal-secondary', 'legato', 'molto-legato', 'glissando', 'detache', 'marcato', 'martele', 'senza-vibrato', 'con-vibrato', 'synchronized-vibrato'],
  ['staccato', 'staccato-on-string', 'slurred-staccato', 'accented-staccato', 'staccatissimo', 'spiccato', 'sautille', 'martellato', 'long-staccato', 'portato', 'pizzicato', 'bartok-pizzicato', 'col-legno-battuto', 'col-legno-gestrichen', 'string-hand-tap', 'jete'],
  ['tremolo', 'growl', 'coloristic-tremolo', 'one-note-trill', 'two-repeats', 'three-repeats', 'four-repeats', 'five-repeats', 'six-repeats', 'faster-repeats'],
  ['half-step-classical-trill', 'half-step-baroque-trill', 'whole-step-classical-trill', 'whole-step-baroque-trill', 'minor-third-trill', 'major-third-trill', 'fourth-trill', 'tritone-trill', 'fifth-trill', 'minor-sixth-trill', 'major-sixth-trill', 'minor-seventh-trill', 'major-seventh-trill', 'octave-trill'],
  ['natural-harmonics', 'artificial-harmonics', 'col-legno-tratto', 'flautando', 'octave-polyphony', 'interval-polyphony', 'cuivre', 'singing-into-instrument'],
  ['pitch-fall-end', 'pitch-fall-start', 'pitch-rise-end', 'pitch-rise-start', 'blue-note-down', 'blue-note-up', 'grace-notes-below', 'grace-notes-above', 'shakes', 'crescendo', 'decrescendo', 'crescendo-decrescendo', 'decrescendo-crescendo', 'sforzando-crescendo'],
  ['playable-runs', 'playable-tremolos', 'playable-glissando', 'major-runs', 'minor-runs', 'dominant-seventh-runs', 'whole-half-diminished-runs', 'half-whole-diminished-runs', 'whole-tone-c-runs', 'whole-tone-csharp-runs', 'major-pentatonic-runs', 'minor-pentatonic-runs', 'lydian-runs', 'lydian-flat-seven-runs', 'chromatic-runs', 'other-runs'],
  ['sustained-air-noise', 'behind-bridge', 'random-pizzicato', 'harmonic-glissando', 'random-glissando', 'short-air-noise', 'sustained-mechanical', 'short-mechanical', 'finger-glide', 'fret-noise', 'thump', 'knock', 'slap', 'pop', 'tap', 'click']
];
export const ORCHESTRAL_ARTICULATIONS = Object.freeze(rows.flatMap((names, classification) => names.map((semanticId, subclass) => Object.freeze({ semanticId, attributeType: 16 + classification, subclass, label: semanticId.replaceAll('-', ' ') }))));
const byId = new Map(ORCHESTRAL_ARTICULATIONS.map(row => [row.semanticId, row]));
export const ORCHESTRAL_CATEGORIES = Object.freeze(['strings', 'woodwinds', 'brass', 'unpitched-percussion', 'tuned-percussion', 'guitar-plucked', 'harp', 'keyboard-organ', 'choir-vocals']);
const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
export function validateOrchestralArticulationPolicy(value) {
  if (!value || value.schema !== 'lemmings-orchestral-articulation-policy/v1' || !ORCHESTRAL_CATEGORIES.includes(value.category) || !byId.has(value.semanticId) ||
      !integer(value.variation, 15) || !integer(value.direction, 2) || !integer(value.stringAssignment, 7) || typeof value.resetRoundRobin !== 'boolean' ||
      !Array.isArray(value.actions) || value.actions.length > 32 || value.microtonalPolicy !== 'refuse-attribute-slot-conflict' ||
      value.muteType != null && !integer(value.muteType, 15) || value.muteAmount01 != null && (!Number.isFinite(value.muteAmount01) || value.muteAmount01 < 0 || value.muteAmount01 > 1) ||
      value.playingPosition01 != null && (!Number.isFinite(value.playingPosition01) || value.playingPosition01 < 0 || value.playingPosition01 > 1)) throw new Error('Invalid orchestral articulation policy');
  const seen = new Set(), actions = value.actions.map(row => {
    if (!row || typeof row.action !== 'string' || !/^[a-z][a-z-]{0,63}$/.test(row.action) || seen.has(row.action) || !byId.has(row.semanticId) || !integer(row.variation, 15)) throw new Error('Invalid or ambiguous physical articulation rule');
    seen.add(row.action); return Object.freeze({ action: row.action, semanticId: row.semanticId, variation: row.variation });
  });
  const release = value.release ?? {};
  if (release.subclass != null && !integer(release.subclass, 4) || !integer(release.variation ?? 0, 15) || release.velocity01 != null && (!Number.isFinite(release.velocity01) || release.velocity01 < 0 || release.velocity01 > 1)) throw new Error('Invalid orchestral release articulation');
  return Object.freeze({ schema: value.schema, category: value.category, semanticId: value.semanticId, variation: value.variation, direction: value.direction, stringAssignment: value.stringAssignment,
    resetRoundRobin: value.resetRoundRobin, actions: Object.freeze(actions), microtonalPolicy: value.microtonalPolicy,
    muteType: value.muteType ?? null, muteAmount01: value.muteAmount01 ?? null, playingPosition01: value.playingPosition01 ?? null,
    release: Object.freeze({ subclass: release.subclass ?? null, variation: release.variation ?? 0, velocity01: release.velocity01 ?? null }), reconnect: 'explicit-profile-review-required' });
}
export function createOrchestralArticulationIntent(policy, { action, strength01, sourceActionId } = {}) {
  if (!policy) return null; const rule = policy.actions.find(row => row.action === action), row = byId.get(rule?.semanticId || policy.semanticId);
  return Object.freeze({ schema: 'lemmings-orchestral-articulation-intent/v1', semanticId: row.semanticId, category: policy.category, strength01,
    sourceActionId: sourceActionId ?? null, profileMappingRevision: 'M2-123-v1.0', attributeType: row.attributeType, subclass: row.subclass, variation: rule?.variation ?? policy.variation,
    direction: policy.direction, stringAssignment: policy.stringAssignment, resetRoundRobin: policy.resetRoundRobin });
}
