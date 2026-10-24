const pitchRange = (value, fallback) => {
  const range = value ?? { semitones: fallback, cents: 0 };
  const semitones = range?.semitones, cents = range?.cents ?? 0;
  return Number.isInteger(semitones) && semitones >= 0 && semitones <= 96 && Number.isInteger(cents) && cents >= 0 && cents <= 99 &&
    semitones + cents / 100 <= 96 ? Object.freeze({ semitones, cents }) : null;
};

export function createMpeZonePlan(mpe = {}, reservedChannels = new Set()) {
  mpe ||= {};
  const managerChannel = mpe.masterChannel ?? 1;
  const configuration = mpe.configuration ?? 'manual', voicePolicy = mpe.voicePolicy ?? 'steal-oldest', programPolicy = mpe.programPolicy ?? 'zone';
  const authored = Array.isArray(mpe.memberChannels) ? mpe.memberChannels : [];
  const members = [...new Set(authored)].sort((a, b) => managerChannel === 16 ? b - a : a - b);
  const memberRange = pitchRange(mpe.pitchBendRange, 48), managerRange = pitchRange(mpe.masterPitchBendRange, 2);
  const oppositeCount = mpe.oppositeZoneMemberCount ?? 0;
  let reason = ![1, 16].includes(managerChannel) || !Array.isArray(mpe.memberChannels) && mpe.memberChannels != null ||
    authored.length !== members.length || authored.some(channel => !Number.isInteger(channel) || channel < 1 || channel > 16 || channel === managerChannel)
    ? 'invalid-mpe-channel' : !members.length ? 'empty-mpe-zone' : null;
  if (!reason && [managerChannel, ...members].some(channel => reservedChannels.has(channel))) reason = 'reserved-mpe-channel';
  const step = managerChannel === 16 ? -1 : 1;
  if (!reason && members.some((channel, index) => channel !== managerChannel + step * (index + 1))) reason = 'noncontiguous-mpe-zone';
  if (!reason && (!Number.isInteger(oppositeCount) || oppositeCount < 0 || oppositeCount > 15)) reason = 'invalid-opposite-mpe-zone';
  if (!reason && oppositeCount && members.length + oppositeCount > 14) reason = 'overlapping-mpe-zones';
  if (!reason && (!memberRange || !managerRange)) reason = 'invalid-mpe-pitch-range';
  if (!reason && !['manual', 'send-zone'].includes(configuration)) reason = 'unsupported-mpe-configuration';
  if (!reason && !['steal-oldest', 'reject'].includes(voicePolicy)) reason = 'unsupported-mpe-voice-policy';
  if (!reason && !['zone', 'member-mode4'].includes(programPolicy)) reason = 'unsupported-mpe-program-policy';
  if (!reason && mpe.receiverMpe === false) reason = 'receiver-mpe-unsupported';
  return Object.freeze({ ok: !reason, reason, protocol: 'legacy-mpe', zone: managerChannel === 16 ? 'upper' : 'lower',
    managerChannel, memberChannels: Object.freeze(members), memberRange, managerRange, configuration, voicePolicy, programPolicy,
    oppositeZoneMemberCount: oppositeCount, receiverEvidence: 'manual-assumption', verified: false,
    reservedChannels: Object.freeze([...reservedChannels].sort((a, b) => a - b)),
    configurationMessages: Object.freeze(configuration === 'send-zone' && !reason
      ? [[101, 0], [100, 6], [6, members.length], [101, 127], [100, 127]].map(message => Object.freeze(message)) : []) });
}
