const domains = Object.freeze({
  'world-distance': Object.freeze({ unit: 'px', label: 'World distance' }),
  'simulation-time': Object.freeze({ unit: 'ms', label: 'Source time' }),
  'musical-beat': Object.freeze({ unit: 'quarters', label: 'Musical position' }),
  'event-ordinal': Object.freeze({ unit: 'events', label: 'Event order' })
});
const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const shortNumber = value => { const text = Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString(); return Number(text) === value ? text : '≈' + text; };
const unavailable = reason => Object.freeze({ status: 'unavailable', reason, value: null, method: null });
const validFields = ({ domain, origin, extent, authorityId, generation, epoch, revision, confidence, historical, paused, reason }) => !(!Object.hasOwn(domains, domain) || !finite(origin) || !finite(extent) || extent <= 0 || !finite(origin + extent) || !boundedId(authorityId) ||
      generation !== null && (!Number.isSafeInteger(generation) || generation < 0) || epoch !== null && !boundedId(epoch) || revision !== null && !boundedId(revision) ||
      !['authoritative', 'captured', 'estimated', 'unavailable'].includes(confidence) || typeof historical !== 'boolean' || paused !== null && typeof paused !== 'boolean' || reason !== null && (!boundedId(reason) || reason.length > 240));
const assertAxis = axis => { if (!axis || axis.schema !== 'lemmings-axis/v1' || !validFields(axis) || axis.unit !== domains[axis.domain]?.unit) throw new TypeError('Invalid axis descriptor.'); return axis; };
export function createAxisDescriptor({ domain, origin, extent, authorityId, generation = null, epoch = null, revision = null, confidence = 'unavailable', historical = false, paused = null, reason = null } = {}) {
  if (!validFields({ domain, origin, extent, authorityId, generation, epoch, revision, confidence, historical, paused, reason })) throw new TypeError('Invalid axis descriptor.');
  return Object.freeze({ schema: 'lemmings-axis/v1', domain, origin, extent, unit: domains[domain].unit, label: domains[domain].label, authorityId, generation, epoch, revision, confidence, historical, paused, reason });
}
export const axisBindingKey = axis => { assertAxis(axis); return JSON.stringify([axis.domain, axis.authorityId, axis.generation, axis.epoch, axis.revision]); };
export function projectAxisValue(axis, value) {
  assertAxis(axis);
  if (!finite(value) || axis.confidence === 'unavailable') return unavailable('axis-or-value-unavailable');
  const fraction = (value - axis.origin) / axis.extent;
  if (!Number.isFinite(fraction)) return unavailable('axis-projection-overflow');
  return Object.freeze({ status: 'known', value, fraction, outside: fraction < 0 || fraction > 1 });
}
export function convertAxisValue(value, from, to, receipt = null) {
  assertAxis(from); assertAxis(to);
  if (!finite(value) || from.confidence === 'unavailable' || to.confidence === 'unavailable') return unavailable('axis-or-value-unavailable');
  const source = axisBindingKey(from), destination = axisBindingKey(to);
  if (source === destination) return Object.freeze({ status: 'known', value, method: 'exact', evidenceId: 'same-axis' });
  if (receipt?.schema !== 'verified-axis-conversion/v1' || receipt.from !== source || receipt.to !== destination || !['exact', 'sampled'].includes(receipt.method) ||
      !boundedId(receipt.evidenceId) || !finite(receipt.scale) || receipt.scale === 0 || !finite(receipt.offset)) return unavailable('verified-conversion-unavailable');
  if ((from.confidence === 'estimated' || to.confidence === 'estimated') && receipt.method !== 'sampled') return unavailable('estimated-axis-needs-sampled-conversion');
  const converted = value * receipt.scale + receipt.offset;
  return finite(converted) ? Object.freeze({ status: 'known', value: converted, method: receipt.method, evidenceId: receipt.evidenceId }) : unavailable('axis-conversion-overflow');
}
export function formatAxisDescriptor(axis) {
  assertAxis(axis);
  const compact = axis.confidence === 'unavailable' ? axis.label + ' · ' + axis.unit + ' unavailable' : axis.label + ' · ' + shortNumber(axis.origin) + '–' + shortNumber(axis.origin + axis.extent) + ' ' + axis.unit;
  const details = [compact, axis.confidence === 'authoritative' ? 'Observed authority' : axis.confidence === 'captured' ? 'Captured history' : axis.confidence === 'estimated' ? 'Estimated display; not a scheduled note' : 'Authority unavailable',
    axis.authorityId, axis.reason || 'Display domain; conversion needs its own evidence', 'Exact display extent ' + axis.origin + '–' + (axis.origin + axis.extent) + ' ' + axis.unit, axis.generation === null ? 'Generation not applicable' : 'Generation ' + axis.generation,
    axis.epoch === null ? 'No cross-domain clock correlation' : 'Epoch ' + axis.epoch,
    axis.historical ? 'Historical marks do not follow current tempo or camera' : axis.paused === null ? 'Current view extent' : axis.paused ? 'Transport paused' : 'Transport running'].join(' · ');
  return Object.freeze({ compact, details });
}
export function capturedScoreAxis({ timeDomain, glyphs, takeId, takeRevision, generation }) {
  const domain = { 'physical-source-time': 'simulation-time', 'causal-order': 'event-ordinal', 'musical-score-time': 'musical-beat' }[timeDomain];
  if (!domain || !Array.isArray(glyphs) || glyphs.length > 16384 || !boundedId(takeId) || !Number.isSafeInteger(takeRevision) || takeRevision < 1) throw new TypeError('Invalid captured score axis.');
  const epochs = new Set(); let first = Infinity, last = -Infinity, known = 0, ambiguous = false;
  for (const glyph of glyphs) {
    const range = glyph.axisRange;
    if (range?.known && finite(range.minimum) && finite(range.maximum)) { known++; epochs.add(range.epoch || null); ambiguous ||= range.ambiguous === true; first = Math.min(first, range.minimum); last = Math.max(last, range.maximum); }
    else if (glyph.axis?.status === 'known' && finite(glyph.axis.value)) { known++; epochs.add(glyph.axis.epoch || null); first = Math.min(first, glyph.axis.value); last = Math.max(last, glyph.axis.value); }
  }
  const available = known > 0 && epochs.size === 1 && !ambiguous;
  return createAxisDescriptor({ domain, origin: available ? first : 0, extent: available ? Math.max(1, last - first) : 1, authorityId: 'Captured take ' + takeId,
    generation, epoch: available ? [...epochs][0] : null, revision: String(takeRevision), confidence: available ? 'captured' : 'unavailable', historical: true, reason: available ? null : epochs.size > 1 || ambiguous ? 'Captured positions belong to multiple clock epochs.' : 'No captured values in this axis domain.' });
}

export function readCapturedAxisValue(domain, source, intents) {
  if (domain === 'causal-order') return { status: 'known', value: source.causalSequence, unit: 'causal-sequence' };
  if (domain === 'physical-source-time') return Number.isFinite(source.sourceTimeMs)
    ? { status: 'known', value: source.sourceTimeMs, unit: 'milliseconds', precision: source.precision || 'tick' }
    : { status: 'unknown', value: null, unit: 'milliseconds', reason: 'source-time-unavailable' };
  if (domain !== 'musical-score-time') throw new TypeError('Unknown captured axis domain.');
  const times = intents.filter(intent => Number.isFinite(intent.scoreTime?.beat)).map(intent => intent.scoreTime);
  if (!times.length) return { status: 'unknown', value: null, unit: 'beats', reason: 'captured-score-time-unavailable' };
  const first = times[0];
  if (times.some(time => time.epoch !== first.epoch || time.beat !== first.beat)) return { status: 'unknown', value: null, unit: 'beats', reason: 'multiple-interpretation-times' };
  return { status: 'known', value: first.beat, unit: 'beats', epoch: first.epoch || null, precision: first.precision || 'tick' };
}
export function describeCapturedCoordinateSample(glyph) {
  if (!glyph?.source || glyph.kind === 'aggregate') return Object.freeze({ sourceEventId: null, text: 'Expand the aggregate to inspect one recorded cause.', method: 'unavailable' });
  const source = glyph.source, intents = Array.isArray(glyph.intents) && glyph.intents.length <= 1024 ? glyph.intents : null;
  const readings = ['physical-source-time', 'causal-order', 'musical-score-time'].map(domain => ({ domain, ...readCapturedAxisValue(domain, source, intents || []) }));
  const text = readings.map(value => ({ 'physical-source-time': 'Source time', 'causal-order': 'Event order', 'musical-score-time': 'Musical position' }[value.domain]) + ' ' +
    (value.status === 'known' && Number.isFinite(value.value) ? value.value + ' ' + value.unit + (value.epoch ? ' · epoch ' + value.epoch : '') : 'unavailable')).join('; ');
  return Object.freeze({ sourceEventId: source.eventId, method: 'sampled-at-recorded-cause', readings: Object.freeze(readings.map(Object.freeze)), text: text + '. Co-observed at this recorded cause; conversion between causes is unavailable.' });
}

export function axisTickMarks(axis, count = 5) {
  assertAxis(axis);
  if (!Number.isSafeInteger(count) || count < 2 || count > 12) throw new RangeError('Invalid axis tick bound.');
  if (axis.confidence === 'unavailable') return Object.freeze([]);
  const values = [];
  if (axis.domain === 'event-ordinal') {
    const step = Math.max(1, Math.ceil(axis.extent / (count - 1))), first = Math.ceil(axis.origin / step) * step;
    for (let index = 0; index < count; index++) { const value = first + index * step; if (value > axis.origin + axis.extent) break; values.push(value); }
  } else for (let index = 0; index < count; index++) values.push(index === count - 1 ? axis.origin + axis.extent : axis.origin + index * axis.extent / (count - 1));
  return Object.freeze(values.map(value => Object.freeze({ value, fraction: (value - axis.origin) / axis.extent, label: shortNumber(value) + ' ' + axis.unit })));
}
