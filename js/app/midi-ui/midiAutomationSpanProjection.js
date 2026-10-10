import { previewMidiAutomationSpan, MAX_MIDI_AUTOMATION_SPANS, SPAN_TARGET_RANGES } from '../../midi/project/MidiAutomationSpan.js';
const formatted = value => Number.isFinite(value) ? String(Math.round(value * 100) / 100) : 'unavailable';
/** Display the last note evaluation; the transport forecast is never a resolved output. */
const projectMidiAutomationSpan = (entry, state, { previewPosition = null, generation = null, draft = false } = {}) => {
  const preview = previewMidiAutomationSpan(entry, previewPosition);
  const resolution = !draft && entry.enabled !== false && (generation == null || state?.generation === generation) ? state?.resolution : null;
  const position = entry.span.domain === 'beats' ? resolution?.beat : resolution?.distance;
  let status = 'waiting', text = 'Waiting for a matching note evaluation';
  if (draft) { status = 'draft'; text = 'Draft preview; no resolved evaluation'; }
  else if (entry.enabled === false) { status = 'bypassed'; text = 'Bypassed'; }
  else if (resolution) {
    const at = ' at ' + formatted(position) + (entry.span.domain === 'beats' ? ' beats' : ' px') + ', tick ' + formatted(resolution.tick) + (Number.isInteger(resolution.laneIndex) ? ' | lane ' + (resolution.laneIndex + 1) : '') + (entry.span.domain === 'distance' && Number.isFinite(position) ? ' | ' + (resolution.distanceSource === 'completed-actor' ? 'completed actor' : 'event origin') : '');
    if (!resolution.conditionMatched) { status = 'gated'; text = 'Gated evaluation' + at; }
    else if (!resolution.active) { status = 'outside'; text = 'Outside interval' + at; }
    else if (resolution.won) { status = 'winner'; text = 'Last resolved ' + resolution.target + ' ' + formatted(resolution.value) + at; }
    else { status = 'suppressed'; text = 'Superseded by ' + (resolution.winnerId?.slice(0, 32) || 'another span') + ': ' + formatted(resolution.winnerValue) + at; }
  }
  return Object.freeze({ status, text, resolved: !!resolution, winning: status === 'winner',
    phase: resolution?.phase ?? 0, value: resolution?.won ? resolution.value : resolution?.winnerValue ?? null,
    candidateValue: resolution?.value ?? null, position: Number.isFinite(position) ? position : null,
    bar: resolution?.bar ?? null, spanPass: resolution?.spanPass ?? null, originEventCount: resolution?.originEventCount ?? null,
    distanceSource: resolution?.distanceSource ?? null,
    laneIndex: resolution?.laneIndex ?? null,
    evaluation: resolution?.evaluation ?? null, tick: resolution?.tick ?? null, winnerId: resolution?.winnerId ?? null,
    previewPosition: preview?.position ?? null, previewActive: entry.enabled !== false && !!preview?.active,
    previewText: entry.span.domain === 'beats' && preview ? 'Transport preview ' + formatted(preview.position) + ' beats' : null });
};
// Keep runtime-eligible rows visible even when saved bypassed rows fill an earlier page.
// Selection takes precedence without changing authored order or runtime admission.
const selectMidiSpanDisplayEntries = (entries, selectedIds = []) => {
  const selected = new Set(Array.from(selectedIds).slice(0, MAX_MIDI_AUTOMATION_SPANS)), seen = new Set(), result = [];
  const add = entry => { if (result.length < MAX_MIDI_AUTOMATION_SPANS && !seen.has(entry.id)) { result.push(entry); seen.add(entry.id); } };
  for (const entry of entries) if (entry.span && selected.has(entry.id)) add(entry);
  let eligible = 0;
  for (const entry of entries) {
    if (!entry.span || entry.enabled === false || !Object.hasOwn(SPAN_TARGET_RANGES, entry.target)) continue;
    if (eligible++ >= MAX_MIDI_AUTOMATION_SPANS) break;
    add(entry);
  }
  for (const entry of entries) { if (result.length === MAX_MIDI_AUTOMATION_SPANS) break; if (entry.span && entry.enabled === false) add(entry); }
  return result;
};
export { projectMidiAutomationSpan, selectMidiSpanDisplayEntries };
