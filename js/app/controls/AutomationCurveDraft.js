const freezePoints = points => Object.freeze(points.map(point => Object.freeze({ beat: point.beat, value: point.value })));
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseAutomationCurvePoints(text, length) {
  if (typeof text !== 'string' || text.length > 16384 || !Number.isFinite(length) || length < 0.25 || length > 65536) return Object.freeze({ valid: false, error: 'The curve or its loop length exceeds the supported bounds.' });
  const entries = text.split(',');
  if (!text.trim() || entries.length > 128) return Object.freeze({ valid: false, error: 'Enter between 1 and 128 position:value pairs.' });
  const points = [];
  for (let index = 0; index < entries.length; index++) {
    const parts = entries[index].trim().split(':');
    if (parts.length !== 2 || parts.some(part => !decimal.test(part.trim()))) return Object.freeze({ valid: false, error: `Point ${index + 1} needs a complete decimal position:value pair.` });
    const beat = Number(parts[0]), value = Number(parts[1]);
    if (!Number.isFinite(beat) || beat < 0 || beat > length || !Number.isInteger(value) || value < 0 || value > 127) return Object.freeze({ valid: false, error: `Point ${index + 1} needs a position from 0 to ${length} and an integer value from 0 to 127.` });
    if (points.length && beat <= points.at(-1).beat) return Object.freeze({ valid: false, error: `Point ${index + 1} must follow the previous position. Duplicate positions are ambiguous.` });
    points.push({ beat, value });
  }
  return Object.freeze({ valid: true, points: freezePoints(points), error: null });
}

export const formatAutomationCurvePoints = points => points.map(point => `${point.beat}:${point.value}`).join(', ');

export function moveAutomationCurvePoint(points, index, { beat, value }, length, snap = 0) {
  if (!Array.isArray(points) || points.length < 1 || points.length > 128 || !Number.isInteger(index) || index < 0 || index >= points.length || !Number.isFinite(beat) || !Number.isFinite(value) || !Number.isFinite(snap) || snap < 0) return null;
  const nextBeat = Math.max(0, Math.min(length, snap ? Math.round(beat / snap) * snap : beat)), nextValue = Math.max(0, Math.min(127, Math.round(value)));
  if (index && nextBeat <= points[index - 1].beat || index + 1 < points.length && nextBeat >= points[index + 1].beat) return null;
  const next = points.map((point, at) => at === index ? { beat: nextBeat, value: nextValue } : point), parsed = parseAutomationCurvePoints(formatAutomationCurvePoints(next), length);
  return parsed.valid ? parsed.points : null;
}
