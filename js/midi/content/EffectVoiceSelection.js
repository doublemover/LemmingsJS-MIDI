import { freezeData } from '../../core/CanonicalData.js';

export function validateEffectVoiceSelection(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 64) throw new TypeError('Select one to sixty-four causal voices.');
  const seen = new Set(), result = raw.map(member => {
    if (!member || Object.getPrototypeOf(member) !== Object.prototype || Object.keys(member).some(key => !['voiceId', 'generation'].includes(key)) ||
        typeof member.voiceId !== 'string' || !member.voiceId || member.voiceId.length > 512 || !Number.isSafeInteger(member.generation) || member.generation < 0) throw new TypeError('A source selection requires exact causal voice and generation identities.');
    const key = member.generation + ':' + member.voiceId; if (seen.has(key)) throw new TypeError('A source voice was selected twice.'); seen.add(key);
    return { voiceId: member.voiceId, generation: member.generation };
  });
  result.sort((a, b) => a.generation - b.generation || (a.voiceId < b.voiceId ? -1 : a.voiceId > b.voiceId ? 1 : 0)); return freezeData(result);
}
export const sourceVoiceMatches = (selection, voiceId, generation) => selection.some(member => member.voiceId === voiceId && member.generation === generation);
