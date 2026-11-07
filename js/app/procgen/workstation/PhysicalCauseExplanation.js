import { causalIntentOutcome, isCausalBodyApplication } from './CausalVisualProjection.js';

export function explainPhysicalCause({ lane, evidence, operational, mix } = {}) {
  const record = evidence?.record, event = record?.events.find(value => value.kind === 'begin') || record?.events.at(-1), receipts = event?.receipts || [];
  const sources = event?.sources?.filter(value => value.recorded) || [], outcome = event ? causalIntentOutcome(event) : null;
  const stage = (id, label, state, detail) => Object.freeze({ id, label, state, detail });
  const output = mix?.outputState, muted = lane?.mute || ['self-muted', 'solo-suppressed', 'zero-gain'].includes(output) || lane?.gain === 0;
  const rejected = receipts.find(value => value.status === 'rejected'), applied = receipts.find(isCausalBodyApplication);
  const submitted = receipts.find(value => value.status === 'accepted' && value.stage === 'submitted'), admitted = receipts.find(value => value.status === 'accepted');
  const stages = Object.freeze([
    stage('cause', 'Observed physical cause', sources.length ? 'observed' : 'unknown', sources.length ? sources.slice(0, 8).map(value => value.eventId + ' · actor ' + value.actorId).join('; ') :
      lane?.mode === 'pattern' ? 'This is a complementary pattern lane; a physical cause is not asserted.' : 'No eligible event observed in this retained window. A missing cause is not zero input.'),
    stage('mapping', 'Mapping and eligibility', muted ? 'blocked' : event?.mappingId ? 'observed' : 'unknown', muted ? 'The selected lane is muted, solo-suppressed or at zero gain.' :
      event?.mappingId ? event.mappingId + ' · graph ' + event.graphRevision + ' · ' + (event.mappingEvidence || 'historical mapping coverage unreported') : 'No matching historical mapping decision is retained.'),
    stage('intent', 'Intent and admission', event ? outcome === 'rejected' || outcome === 'cancelled' ? 'blocked' : 'observed' : 'not-reached', event ? event.intentId + ' · ' + outcome + (rejected ? ' · ' + rejected.reason : '') : 'No retained musical intent. The UI does not manufacture a test note.'),
    stage('render', 'Local render or driver submission', applied ? 'applied' : submitted ? 'submitted' : admitted ? 'admitted' : 'unknown', applied ? 'Owned body command applied at frame ' + applied.appliedFrame + '; shared-body output remains separate.' :
      submitted ? 'Driver API submission observed; receiver and acoustics unverified.' : admitted ? 'Sink ' + admitted.stage + '; applied output is unobserved.' : 'No qualified render or submission receipt is retained.'),
    stage('monitor', 'Selected monitor and output', operational?.noteOutput ? 'observed' : 'unknown', (operational?.noteOutput?.label || 'No output observation') + '. ' + (operational?.audioContext?.label || '') + ' Hearing is unverified.')
  ]);
  const recover = operational?.recoveryAction;
  const action = muted ? Object.freeze({ id: 'inspect-mix', label: 'Review selected lane mix', identity: operational?.identity, laneId: lane?.id }) :
    recover?.enabled ? Object.freeze({ ...recover, identity: operational.identity, laneId: lane?.id }) : null;
  return Object.freeze({ laneId: lane?.id ?? null, eventId: event?.intentId ?? null, sourceTick: record?.sourceTick ?? null,
    evidenceRevision: evidence?.revision ?? null, coverage: record?.completeness || 'unrecorded', stages, action,
    evidence: 'frozen-causal-lineage-and-current-owner-reports;no-acoustic-inference' });
}
