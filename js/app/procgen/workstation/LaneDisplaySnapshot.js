import { formatLaneGain } from './LaneMixState.js';

export const LANE_DISPLAY_PAGES = Object.freeze(['identity', 'cause', 'parameter', 'output']);
const words = value => String(value || '').replaceAll('-', ' ');
export function createLaneDisplaySnapshot({ lane, revision = 0, page = 'identity', simulation = {}, mix = null, evidence = null, parameter = null, activeControl = null } = {}) {
  if (!lane || typeof lane.id !== 'string' || !LANE_DISPLAY_PAGES.includes(page)) throw new Error('Invalid lane display snapshot.');
  const record = evidence?.record, event = record?.events.find(value => value.kind === 'begin') || record?.events.at(-1) || null;
  const ageTicks = record && Number.isSafeInteger(evidence.latestTick) && evidence.latestTick >= record.sourceTick ? evidence.latestTick - record.sourceTick : null;
  const stale = ageTicks !== null && ageTicks > 30;
  const receipts = event?.receipts || [], rejected = receipts.find(value => value.status === 'rejected'), degraded = receipts.find(value => value.status === 'degraded');
  const submitted = receipts.find(value => value.status === 'accepted' && value.stage === 'submitted' && value.targetTimeDomain === 'performance-microseconds');
  const admitted = receipts.find(value => value.status === 'accepted' && value.outputRequested && ['queued', 'scheduled'].includes(value.stage));
  const outputState = !evidence?.available ? 'unavailable' : mix?.outputState || 'unreported';
  const blocked = ['output-disconnected', 'self-muted', 'solo-suppressed', 'zero-gain'].includes(outputState);
  const evidenceClass = rejected ? 'rejected' : degraded ? 'degraded' : submitted ? 'api-submitted' : admitted ? 'sink-admitted' : event ? 'intent-observed' : 'unknown';
  const decisionText = rejected ? `Rejected: ${rejected.reason || 'unreported reason'}` : degraded ? `Degraded: ${degraded.reason || 'unreported reason'}` : submitted ? '' : admitted ? `Sink ${admitted.stage}; render unknown` : event ? 'Intent observed; output unknown' : 'No intent observed';
  const receiptText = [decisionText, submitted ? 'MIDI API submitted; receiver unknown' : ''].filter(Boolean).join('; ');
  const causeText = event ? `${event.action || event.sourceKind || 'Physical fact'} · actor ${event.actorId ?? 'shared/unknown'}` : lane.mode === 'pattern' ? 'Pattern lane; physical trace unavailable' : 'No physical intent observed';
  let top = `${lane.role || lane.family} · ${lane.mode === 'pattern' ? 'PATTERN' : 'PHYSICAL'}`, bottom = `${formatLaneGain(lane.gain ?? 1)} · requested`, priority = 'ordinary';
  if (page === 'cause') { top = causeText; bottom = event ? `Tick ${event.tick} · ${stale ? 'stale' : 'past fact'} · ${record.completeness}` : 'No retained cause'; }
  if (page === 'parameter') { top = parameter?.parameter ? `${parameter.parameter} · request ${parameter.requestedValue ?? 'unknown'}` : 'Level · requested'; bottom = parameter?.parameter ? `API ${parameter.submittedValue ?? 'unknown'} · receiver unknown` : `${formatLaneGain(lane.gain ?? 1)} · local signal unknown`; }
  if (page === 'output') { top = words(outputState); bottom = receiptText; }
  if (activeControl) { priority = 'edit'; top = activeControl.name || 'Parameter draft'; bottom = `${activeControl.value ?? 'unknown'}${activeControl.unit ? ' ' + activeControl.unit : ''} · draft`; }
  if (activeControl?.error) { priority = 'blocked'; top = 'Parameter needs attention'; bottom = activeControl.error; }
  if (simulation.state === 'paused' && !activeControl) { top = 'World paused'; bottom = page === 'cause' ? causeText : bottom; }
  if (blocked || rejected || !evidence?.available) { priority = 'blocked'; top = !evidence?.available ? evidence?.reason || 'Display evidence unavailable' : blocked ? words(outputState) : 'Intent rejected'; bottom = rejected ? receiptText : 'Output activity not confirmed'; }
  const detail = [lane.name, `${lane.role} · ${lane.mode}`, top, bottom, receiptText, event ? `Intent ${event.intentId}; batch ${event.batchId}; mapping ${event.mappingId || 'unknown'}; graph revision ${event.graphRevision ?? 'unknown'}; voice ${event.voiceId || 'unknown'}` : 'Cause unknown',
    event ? `Sources ${event.sources.map(value => value.eventId + (value.recorded ? '' : ' (unrecorded)')).join(', ') || 'unknown'}; source tick ${event.tick}; age ${ageTicks ?? 'unknown'} ticks` : '',
    `Coverage ${record?.completeness || 'unrecorded'}; omitted ${evidence?.omitted ?? 0}; acoustic evidence unknown`].filter(Boolean).join('\n');
  const glyph = priority === 'blocked' ? '!' : { rejected: '×', degraded: '!', 'api-submitted': '↗', 'sink-admitted': '▷', 'intent-observed': '◇', unknown: '○' }[evidenceClass];
  return Object.freeze({ version: 1, laneId: lane.id, revision, name: lane.name, role: lane.role, mode: lane.mode, displayPage: page, glyph,
    sourceTick: record?.sourceTick ?? null, ageTicks, stale, outputState, evidenceClass, completeness: record?.completeness || 'unrecorded', priority, top, bottom, detail,
    recentCause: event, meter: Object.freeze({ source: 'unavailable', peak: null, rms: null }) });
}
