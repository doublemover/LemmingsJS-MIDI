import { formatLaneGain } from './LaneMixState.js';
import { causalIntentOutcome } from './CausalVisualProjection.js';

export const LANE_DISPLAY_PAGES = Object.freeze(['identity', 'cause', 'parameter', 'output']);
const words = value => String(value || '').replaceAll('-', ' ');
export function createLaneDisplaySnapshot({ lane, revision = 0, page = 'identity', simulation = {}, operational = null, mix = null, evidence = null, parameter = null, activeControl = null } = {}) {
  if (!lane || typeof lane.id !== 'string' || !LANE_DISPLAY_PAGES.includes(page)) throw new Error('Invalid lane display snapshot.');
  const record = evidence?.record, event = record?.events.find(value => value.kind === 'begin') || record?.events.at(-1) || null;
  const ageTicks = record && Number.isSafeInteger(evidence.latestTick) && evidence.latestTick >= record.sourceTick ? evidence.latestTick - record.sourceTick : null;
  const stale = ageTicks !== null && ageTicks > 30;
  const receipts = event?.receipts || [], rejected = receipts.find(value => value.status === 'rejected'), degraded = receipts.find(value => value.status === 'degraded');
  const outcome = event ? causalIntentOutcome(event) : 'unconfirmed', fullyRejected = outcome === 'rejected' || outcome === 'cancelled';
  const submitted = receipts.find(value => value.status === 'accepted' && value.stage === 'submitted' && value.targetTimeDomain === 'performance-microseconds');
  const admitted = receipts.find(value => value.status === 'accepted' && value.outputRequested && ['queued', 'scheduled'].includes(value.stage));
  let outputState = !evidence?.available ? 'unavailable' : mix?.outputState || 'unreported';
  if (outputState === 'output-disconnected' && operational) {
    const route = operational.noteOutput?.state, local = operational.localBackend;
    if (route === 'not-selected' && !local?.enabled) outputState = ['error', 'interrupted'].includes(local?.state) ? 'local-output-error' : ['starting', 'preparing'].includes(local?.state) ? 'output-preparing' : 'local-output-off';
    else if (route && !['active', 'lost'].includes(route)) outputState = route === 'preparing' ? 'output-preparing' : 'midi-output-off';
  }
  const inactive = ['local-output-off', 'midi-output-off', 'output-preparing'].includes(outputState);
  const blocked = ['output-disconnected', 'local-output-error', 'self-muted', 'solo-suppressed', 'zero-gain'].includes(outputState);
  const evidenceClass = outcome === 'mixed' ? 'mixed' : rejected ? 'rejected' : degraded ? 'degraded' : submitted ? 'api-submitted' : admitted ? 'sink-admitted' : event ? 'intent-observed' : 'unknown';
  const decisionText = rejected ? `${outcome === 'mixed' ? 'One sink rejected' : 'Rejected'}: ${rejected.reason || 'unreported reason'}` : degraded ? `Degraded: ${degraded.reason || 'unreported reason'}` : submitted ? '' : admitted ? `Sink ${admitted.stage}; render unknown` : event ? 'Intent observed; output unknown' : 'No intent observed';
  const receiptText = [decisionText, submitted ? 'MIDI API submitted; receiver unknown' : ''].filter(Boolean).join('; ');
  const causeText = event ? `${event.action || event.sourceKind || 'Physical fact'} · actor ${event.actorId ?? 'shared/unknown'}` : lane.mode === 'pattern' ? 'Pattern lane; physical trace unavailable' : 'No physical intent observed';
  let top = `${lane.role || lane.family} · ${lane.mode === 'pattern' ? 'PAT' : 'PHYS'}${inactive ? ' OFF' : ''}`, bottom = `${formatLaneGain(lane.gain ?? 1)} · requested`, priority = 'ordinary';
  if (page === 'cause') { top = causeText; bottom = event ? `Tick ${event.tick} · ${stale ? 'stale' : 'past fact'} · ${record.completeness}` : 'No retained cause'; }
  if (page === 'parameter') { top = parameter?.parameter ? `${parameter.parameter} · request ${parameter.requestedValue ?? 'unknown'}` : 'Level · requested'; bottom = parameter?.parameter ? `API ${parameter.submittedValue ?? 'unknown'} · receiver unknown` : `${formatLaneGain(lane.gain ?? 1)} · local signal unknown`; }
  if (page === 'output') { top = words(outputState); bottom = receiptText; }
  if (activeControl) { priority = 'edit'; top = activeControl.name || 'Parameter draft'; bottom = `${activeControl.value ?? 'unknown'}${activeControl.unit ? ' ' + activeControl.unit : ''} · draft`; }
  if (activeControl?.error) { priority = 'blocked'; top = 'Parameter needs attention'; bottom = activeControl.error; }
  if (simulation.state === 'paused' && !activeControl && page === 'identity') top = inactive ? 'World paused · OFF' : 'World paused';
  if (blocked || fullyRejected || !evidence?.available) { priority = 'blocked'; top = !evidence?.available ? evidence?.reason || 'Display evidence unavailable' : blocked ? words(outputState) : 'Intent rejected'; bottom = rejected ? receiptText : 'Output activity not confirmed'; }
  const patchIdentity = lane.instrumentRef?.definitionHash || lane.instrumentPatchId || null;
  const detail = [lane.name, `${lane.role} · ${lane.mode}; world ${simulation.state || 'unreported'}; output ${words(outputState)}`, top, bottom, receiptText,
    `Requested lane level ${formatLaneGain(lane.gain ?? 1)}; project revision ${revision}; display evidence revision ${evidence?.revision ?? 'unknown'}; current patch ${patchIdentity || 'unknown'}`,
    event ? `Intent ${event.intentId}; batch ${event.batchId}; mapping ${event.mappingId || 'unknown'}; graph revision ${event.graphRevision ?? 'unknown'}; definition revision ${event.mappingRevision ?? 'unknown'}; ${event.mappingEvidence || 'unrecorded'}; voice ${event.voiceId || 'unknown'}` : 'Cause unknown',
    event ? `Frozen intent pitch ${event.pitchCents ?? 'unknown'} cents; velocity ${event.velocity01 ?? 'unknown'}` : '',
    ...receipts.map(value => `${value.sinkId || 'Unknown sink'}: ${value.status || 'unknown'} / ${value.stage || 'unknown'}; target ${value.targetFrame ?? 'unknown'} ${value.targetTimeDomain || 'unreported domain'}; execution ${value.executionEpoch || 'unknown'}${value.reason ? '; ' + value.reason : ''}`),
    event ? `Sources ${event.sources.map(value => value.eventId + (value.recorded ? '' : ' (unrecorded)')).join(', ') || 'unknown'}; source tick ${event.tick}; age ${ageTicks ?? 'unknown'} ticks` : '',
    `Coverage ${record?.completeness || 'unrecorded'}; omitted ${evidence?.omitted ?? 0}; acoustic evidence unknown`].filter(Boolean).join('\n');
  const glyph = priority === 'blocked' && evidenceClass !== 'rejected' ? '!' : { mixed: '±', rejected: '×', degraded: '!', 'api-submitted': '↗', 'sink-admitted': '▷', 'intent-observed': '◇', unknown: '○' }[evidenceClass];
  return Object.freeze({ version: 1, laneId: lane.id, revision, projectRevision: revision, evidenceRevision: evidence?.revision ?? null, patchIdentity, name: lane.name, role: lane.role, mode: lane.mode, displayPage: page, glyph,
    sourceTick: record?.sourceTick ?? null, ageTicks, stale, outputState, evidenceClass, completeness: record?.completeness || 'unrecorded', priority, top, bottom, detail,
    recentCause: event, meter: Object.freeze({ source: 'unavailable', peak: null, rms: null }) });
}
