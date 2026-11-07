import { encodeFlexScoreValue, decodeFlexScoreValue, encodeFlexText } from '../protocol/UmpFlexData.js';

const target = Object.freeze({ group: 0, address: 'group' });
export function validateScoreContextPolicy(value) {
  if (value == null) return null;
  if (typeof value.enabled !== 'boolean' || !['group', 'channel'].includes(value.address) || typeof value.title !== 'string' || typeof value.annotation !== 'string') throw new Error('Invalid authored score context');
  encodeFlexText(value.title, target, { bank: 1, status: 2 }); encodeFlexText(value.annotation, target, { bank: 2, status: 0 });
  if (value.key != null) encodeFlexScoreValue('key', value.key, target);
  if (value.chord != null) encodeFlexScoreValue('chord', value.chord, target);
  const normalized = (kind, value, status) => value == null ? null : decodeFlexScoreValue(encodeFlexScoreValue(kind, value, target), { bank: 0, status, address: 'group' }).value;
  return Object.freeze({ enabled: value.enabled, address: value.address, title: value.title, annotation: value.annotation, key: normalized('key', value.key, 5), chord: normalized('chord', value.chord, 6) });
}
export function createScoreContextEvents(policy, { worldId, generation, laneId, scoreTime, bpm, meter, sourceId }) {
  if (!policy?.enabled) return Object.freeze([]);
  if (!Number.isSafeInteger(generation) || generation < 0 || typeof worldId !== 'string' || !worldId || typeof laneId !== 'string' || !laneId ||
      typeof sourceId !== 'string' || !sourceId || !Number.isFinite(scoreTime?.beat) || scoreTime.beat < 0 || typeof scoreTime.epoch !== 'string') throw new Error('Score context requires current physical source coordinates');
  const entries = [['tempo', { bpm }, 'score-timeline']];
  if (meter) entries.push(['meter', { numerator: meter.beats ?? meter.numerator, denominator: meter.unit ?? meter.denominator, thirtySecondsPerQuarter: meter.thirtySecondsPerQuarter ?? 8 }, 'authored-score']);
  if (policy.key) entries.push(['key', policy.key, 'authored-harmonic-context']);
  if (policy.chord) entries.push(['chord', policy.chord, 'authored-harmonic-context']);
  if (policy.title) entries.push(['text', { text: policy.title, bank: 1, status: 2 }, 'authored-score']);
  if (policy.annotation) entries.push(['text', { text: policy.annotation, bank: 2, status: 0 }, 'authored-score']);
  return Object.freeze(entries.map(([kind, value, provenance], order) => Object.freeze({ schema: 'lemmings-score-context-event/v1', eventId: sourceId + ':context:' + order, worldId, generation,
    effectiveScoreTime: Object.freeze({ ...scoreTime }), scope: Object.freeze({ laneId, address: kind === 'tempo' || kind === 'meter' ? 'group' : policy.address }), kind, value: Object.freeze(value),
    sourceOrder: order, provenance, inferred: false, timing: 'physical-score-time-preserved' })));
}
export function lowerScoreContextEvent(event, route) {
  if (event?.schema !== 'lemmings-score-context-event/v1' || event.inferred !== false || !['score-timeline', 'authored-score', 'authored-harmonic-context'].includes(event.provenance)) throw new Error('Only explicitly authored/score-owned context can be transmitted');
  const scope = { group: route.group, channel: route.channel, address: event.scope.address };
  return event.kind === 'text' ? encodeFlexText(event.value.text, scope, event.value) : Object.freeze([encodeFlexScoreValue(event.kind, event.value, scope)]);
}
