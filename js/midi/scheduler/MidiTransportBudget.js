import { MIDI_BYTES_PER_SECOND } from './MidiSchedulerShared.js';

const positive = (value, fallback, ceiling = Number.MAX_SAFE_INTEGER) => Number.isFinite(value) && value > 0
  ? Math.min(ceiling, Math.floor(value)) : fallback;

export function midiTransportBudget(output, limits = {}, overrides = {}) {
  const endpointId = output?.id == null ? null : String(output.id);
  if (output?.supportsIndependentNoteGates) return Object.freeze({ endpointId, transport: 'local-audio', protocol: 'local-audio',
    confidence: 'adapter-capability', linkId: null, scope: `local:${endpointId || 'default'}`,
    maxMessagesPerSecond: Number.MAX_SAFE_INTEGER, maxBytesPerSecond: Number.MAX_SAFE_INTEGER,
    maxPending: 4096, queueHorizonMs: 60000 });
  const profile = overrides.budgetProfile || limits.endpointProfiles?.[endpointId] || output?.budgetProfile || {};
  const linkId = typeof profile.linkId === 'string' && profile.linkId ? profile.linkId : null;
  const shared = linkId ? limits.linkProfiles?.[linkId] || {} : {};
  let endpointMaxMessages = positive(profile.maxMessagesPerSecond, positive(limits.maxEventsPerSecond, 1000));
  let endpointMaxBytes = positive(profile.maxBytesPerSecond, positive(limits.maxBytesPerSecond, MIDI_BYTES_PER_SECOND));
  if (Number.isFinite(overrides.maxMessagesPerSecond)) endpointMaxMessages = Math.min(endpointMaxMessages, positive(overrides.maxMessagesPerSecond, endpointMaxMessages));
  if (Number.isFinite(overrides.maxBytesPerSecond)) endpointMaxBytes = Math.min(endpointMaxBytes, positive(overrides.maxBytesPerSecond, endpointMaxBytes));
  if (profile.transport === 'din') endpointMaxBytes = Math.min(endpointMaxBytes, MIDI_BYTES_PER_SECOND);
  const linkMaxMessages = linkId ? positive(shared.maxMessagesPerSecond, positive(limits.maxEventsPerSecond, 1000)) : null;
  let linkMaxBytes = linkId ? positive(shared.maxBytesPerSecond, positive(limits.maxBytesPerSecond, MIDI_BYTES_PER_SECOND)) : null;
  if (linkId && shared.transport === 'din') linkMaxBytes = Math.min(linkMaxBytes, MIDI_BYTES_PER_SECOND);
  return Object.freeze({ endpointId, transport: typeof profile.transport === 'string' ? profile.transport : 'unknown-webmidi',
    protocol: 'midi1', confidence: profile.transport || profile.maxBytesPerSecond ? 'user-configured' : 'conservative-default',
    requestedProtocol: profile.protocol || 'midi1', linkId, scope: linkId ? `link:${linkId}` : `endpoint:${endpointId || 'default'}`,
    endpointMaxMessagesPerSecond: endpointMaxMessages, endpointMaxBytesPerSecond: endpointMaxBytes,
    linkMaxMessagesPerSecond: linkMaxMessages, linkMaxBytesPerSecond: linkMaxBytes,
    maxMessagesPerSecond: Math.min(endpointMaxMessages, linkMaxMessages ?? Infinity),
    maxBytesPerSecond: Math.min(endpointMaxBytes, linkMaxBytes ?? Infinity),
    maxPending: positive(profile.maxPending, 4096, 4096), queueHorizonMs: positive(profile.queueHorizonMs, 60000, 60000) });
}
