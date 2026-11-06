import { encodeIntent } from '../protocol/UmpPacketCodec.js';
import { scaleMidiResolution } from '../protocol/MidiProtocolLowering.js';

const u32 = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const bounded = (value, minimum, maximum) => Number.isFinite(value) && value >= minimum && value <= maximum;
const text = (value, maximum = 256) => typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).length <= maximum;
const forms = ['absolute', 'relative', 'both', 'none'];
const types = ['cc', 'chPress', 'pPress', 'rpn', 'nrpn', 'pBend', 'pnrc', 'pnac', 'pnp'];
const hints = ['continuous', 'momentary', 'toggle', 'relative', 'valueSelect'];
export const DEVICE_PARAMETER_SOURCES = Object.freeze({
  pressure01: Object.freeze({ label: 'Actor pressure / crowd compression', unit: 'ratio', minimum: 0, maximum: 1 }),
  velocity01: Object.freeze({ label: 'Physical onset impact', unit: 'ratio', minimum: 0, maximum: 1 }),
  pan01: Object.freeze({ label: 'Authored physical spacing expression', unit: 'ratio', minimum: -1, maximum: 1 }),
  positionYWorldPixels: Object.freeze({ label: 'Actor height / depth', unit: 'world-pixel', minimum: 0, maximum: 256 }),
  displacementPixels: Object.freeze({ label: 'Committed actor movement', unit: 'world-pixel', minimum: 0, maximum: 16 }),
  changedSolidCells: Object.freeze({ label: 'Excavation / construction work', unit: 'cells', minimum: 0, maximum: 32 })
});
export function normalizeDeviceParameters(data, { resource, resId = null, channel = null, mapValues = new Map(), revision } = {}) {
  if (!['AllCtrlList', 'ChCtrlList'].includes(resource) || !Array.isArray(data) || data.length > 512 || !Number.isSafeInteger(revision) || revision < 0) throw new Error('A bounded current controller resource is required');
  const seen = new Map();
  return Object.freeze(data.map(row => {
    const propertyChannel = resource === 'AllCtrlList' ? row?.channel : channel;
    if (!row || !text(row.title) || !types.includes(row.ctrlType) || !Number.isInteger(propertyChannel) || propertyChannel < 1 || propertyChannel > 256 ||
        row.description != null && !text(row.description, 2048) || row.paramPath != null && (typeof row.paramPath !== 'string' || new TextEncoder().encode(row.paramPath).length > 256 || row.paramPath && !/^\/(?:[^~]|~[01])*$/.test(row.paramPath)) ||
        row.priority != null && (!Number.isInteger(row.priority) || row.priority < 1 || row.priority > 5)) throw new Error('Malformed controller identity or scope');
    const index = row.ctrlIndex ?? [], needed = ['chPress', 'pPress', 'pBend', 'pnp'].includes(row.ctrlType) ? 0 : ['rpn', 'nrpn'].includes(row.ctrlType) ? 2 : 1;
    if (!Array.isArray(index) || index.length !== needed && !(row.ctrlType === 'cc' && index.length === 2) ||
        index.some(value => !Number.isInteger(value) || value < 0 || value > (['pnrc', 'pnac'].includes(row.ctrlType) ? 255 : 127)) ||
        row.ctrlType === 'cc' && index.length === 2 && (index[0] > 31 || index[1] !== index[0] + 32)) throw new Error('Malformed controller wire index');
    const recognize = row.recognize ?? 'absolute', transmit = row.transmit ?? 'absolute', sourceResolution = row.numSigBits ?? 32, hint = row.typeHint ?? 'continuous';
    if (!forms.includes(recognize) || !forms.includes(transmit) || !hints.includes(hint) || !Number.isInteger(sourceResolution) || sourceResolution < 1 || sourceResolution > 32 ||
        row.default != null && !u32(row.default) || row.minMax != null && (!Array.isArray(row.minMax) || row.minMax.length !== 2 || !row.minMax.every(u32) || row.minMax[0] >= row.minMax[1]) ||
        row.stepCount != null && (!Number.isInteger(row.stepCount) || row.stepCount < 2 || row.stepCount > 4294967296 || row.minMax != null)) throw new Error('Malformed controller range, resolution or form');
    if (row.ctrlMapId != null && !/^[a-zA-Z0-9_]{1,36}$/.test(row.ctrlMapId) || hint === 'valueSelect' && !row.ctrlMapId) throw new Error('Controller enumeration requires an advertised map');
    const key = JSON.stringify([propertyChannel, row.ctrlType, index]), previous = seen.get(key);
    if (previous && !(previous.recognize === 'none' && recognize !== 'none' && transmit === 'none' || previous.transmit === 'none' && transmit !== 'none' && recognize === 'none')) throw new Error('Ambiguous duplicate controller declaration');
    seen.set(key, { recognize: previous && previous.recognize !== 'none' ? previous.recognize : recognize, transmit: previous && previous.transmit !== 'none' ? previous.transmit : transmit });
    const entries = row.ctrlMapId ? mapValues.get(row.ctrlMapId) || [] : [];
    const descriptor = { stableId: JSON.stringify([resource, resId, propertyChannel, row.ctrlType, index, recognize === 'none' ? 'transmit' : 'recognize']), resource, resId, propertyChannel,
      name: row.title, description: row.description || null, paramPath: row.paramPath || null, priority: row.priority ?? 3, ctrlType: row.ctrlType, ctrlIndex: Object.freeze([...index]),
      type: hint === 'valueSelect' ? 'enum' : hint === 'continuous' && row.stepCount ? 'integer' : hint, bipolar: ['pBend', 'pnp'].includes(row.ctrlType),
      unit: text(row.unit, 32) ? row.unit : null, minimum: row.minMax?.[0] ?? 0, maximum: row.minMax?.[1] ?? 0xffffffff, stepCount: row.stepCount ?? null,
      defaultValue: row.default ?? null, readable: transmit !== 'none', writable: recognize !== 'none', recognize, transmit, sourceResolution,
      enumValues: entries, ctrlMapId: row.ctrlMapId || null, scope: ['pPress', 'pnrc', 'pnac', 'pnp'].includes(row.ctrlType) ? 'note' : 'channel', revision };
    return Object.freeze({ ...descriptor, signature: JSON.stringify({ ...descriptor, revision: undefined }) });
  }));
}
export function normalizeControllerMap(data) {
  if (!Array.isArray(data) || data.length > 256) throw new Error('Controller enumeration capacity');
  const seen = new Set();
  return Object.freeze(data.map(row => { if (!u32(row?.value) || !text(row.title) || seen.has(row.value)) throw new Error('Malformed or duplicate controller-map value'); seen.add(row.value); return Object.freeze({ value: row.value, title: row.title }); }).sort((a, b) => a.value - b.value));
}
export function quantizeDeviceParameter(parameter, value) {
  if (!u32(value) || value < parameter.minimum || value > parameter.maximum) throw new Error('Parameter value is outside its declared carrier range');
  if (parameter.type === 'enum') { if (!parameter.enumValues.some(row => row.value === value)) throw new Error('Choose an advertised enumeration value'); return value; }
  if (parameter.type === 'momentary' || parameter.type === 'toggle') return value < parameter.minimum + (parameter.maximum - parameter.minimum) / 2 ? parameter.minimum : parameter.maximum;
  if (parameter.stepCount) return Math.round(Math.round(value / 0xffffffff * (parameter.stepCount - 1)) * 0xffffffff / (parameter.stepCount - 1));
  const quantum = 2 ** (32 - parameter.sourceResolution);
  return Math.max(parameter.minimum, Math.min(parameter.maximum, Math.round(value / quantum) * quantum));
}
export function encodeDeviceParameter(parameter, { group, channel, protocol = 'midi2', note = null }, { value, delta = null } = {}) {
  if (!parameter.writable || delta == null && !['absolute', 'both'].includes(parameter.recognize) ||
      delta != null && (!['relative', 'both'].includes(parameter.recognize) || !['rpn', 'nrpn'].includes(parameter.ctrlType))) throw new Error('The device does not recognize this controller form');
  if (parameter.scope === 'note' && (!Number.isInteger(note) || note < 0 || note > 127)) throw new Error('Choose an owned note for this per-note control');
  const type = parameter.ctrlType, indexes = parameter.ctrlIndex;
  const carrier = delta == null ? quantizeDeviceParameter(parameter, value) : delta;
  if (delta != null && (!Number.isInteger(delta) || delta < -2147483648 || delta > 2147483647)) throw new Error('Relative controller increment exceeds signed 32 bits');
  const statuses = { cc: 'controlChange', chPress: 'channelPressure', pPress: 'polyPressure', rpn: 'registeredController', nrpn: 'assignableController', pBend: 'pitchBend', pnrc: 'registeredPerNoteController', pnac: 'assignablePerNoteController', pnp: 'perNotePitchBend' };
  if (protocol === 'midi2') return encodeIntent({ group, channel, status: delta == null ? statuses[type] : type === 'rpn' ? 'relativeRegisteredController' : 'relativeAssignableController',
    ...(parameter.scope === 'note' ? { note } : {}), ...(['pnrc', 'pnac'].includes(type) ? { controller: indexes[0] } : type === 'cc' ? { controller: indexes[0] } : ['rpn', 'nrpn'].includes(type) ? { bank: indexes[0], index: indexes[1] } : {}),
    controllerValue: delta == null ? { value: carrier, bits: 32, sourceBits: parameter.sourceResolution } : { value: carrier, bits: 32, signed: true } });
  if (protocol !== 'midi1-in-ump' || delta != null || ['pnrc', 'pnac', 'pnp'].includes(type)) throw new Error('This controller requires the MIDI2 protocol');
  const words = [], message = (status, first, second = 0) => words.push((0x20000000 | group << 24 | status << 20 | channel << 16 | first << 8 | second) >>> 0);
  const seven = scaleMidiResolution(carrier, 32, 7), fourteen = scaleMidiResolution(carrier, 32, 14);
  if (type === 'cc' && indexes.length === 2) { message(11, indexes[0], fourteen >> 7); message(11, indexes[1], fourteen & 127); }
  else if (type === 'cc') message(11, indexes[0], seven);
  else if (type === 'chPress') message(13, seven);
  else if (type === 'pPress') message(10, note, seven);
  else if (type === 'pBend') message(14, fourteen & 127, fourteen >> 7);
  else { message(11, type === 'rpn' ? 101 : 99, indexes[0]); message(11, type === 'rpn' ? 100 : 98, indexes[1]); message(11, 6, fourteen >> 7); message(11, 38, fourteen & 127); message(11, type === 'rpn' ? 101 : 99, 127); message(11, type === 'rpn' ? 100 : 98, 127); }
  return Object.freeze(words);
}
export function validateDeviceParameterMappings(input) {
  if (!Array.isArray(input) || input.length > 8) throw new Error('At most eight device-expression bindings are supported per lane');
  const seen = new Set();
  return Object.freeze(input.map(row => {
    const source = DEVICE_PARAMETER_SOURCES[row?.source], cached = row?.cachedDescriptor;
    if (!row || row.schema !== 'lemmings-device-parameter-intent/v1' || !source || !text(row.stableId, 512) || seen.has(row.stableId) || !text(row.signature, 8192) ||
        !cached || cached.stableId !== row.stableId || cached.signature !== row.signature || JSON.stringify(cached).length > 16384 || !text(cached.name) ||
        !bounded(row.inputMinimum, -1000000000, 1000000000) || !bounded(row.inputMaximum, -1000000000, 1000000000) || row.inputMinimum >= row.inputMaximum ||
        !['linear', 'exponential', 'logarithmic', 'step'].includes(row.curve) || !bounded(row.exponent, 0.1, 10) || !bounded(row.smoothingMs, 0, 60000) || !bounded(row.deadband, 0, 0.5) ||
        typeof row.pickup !== 'boolean' || !['channel', 'note'].includes(row.scope) || typeof row.deviceFingerprint !== 'string' || row.deviceFingerprint.length > 1024) throw new Error('Invalid saved device-expression intent');
    seen.add(row.stableId);
    return Object.freeze({ schema: row.schema, stableId: row.stableId, signature: row.signature, cachedDescriptor: Object.freeze(JSON.parse(JSON.stringify(cached))),
      deviceFingerprint: row.deviceFingerprint, source: row.source, inputMinimum: row.inputMinimum, inputMaximum: row.inputMaximum, curve: row.curve, exponent: row.exponent,
      smoothingMs: row.smoothingMs, deadband: row.deadband, pickup: row.pickup, scope: row.scope, reconnect: 'explicit-review-required' });
  }));
}
export function mapDeviceParameterSource(parameter, mapping, intent, state, targetMicroseconds, baseline) {
  let source = mapping.source === 'velocity01' ? intent.velocity01 : intent.expression?.[mapping.source];
  if (source == null && intent.performanceCause?.evidence === 'completed-world-fact') source = intent.performanceCause.values?.[mapping.source]?.value;
  if (!Number.isFinite(source)) return null;
  let normalized = Math.max(0, Math.min(1, (source - mapping.inputMinimum) / (mapping.inputMaximum - mapping.inputMinimum)));
  if (mapping.curve === 'exponential') normalized **= mapping.exponent;
  else if (mapping.curve === 'logarithmic') normalized = Math.log1p(normalized * (Math.exp(mapping.exponent) - 1)) / mapping.exponent;
  else if (mapping.curve === 'step') normalized = normalized < 0.5 ? 0 : 1;
  if (state.hardwareRevision !== baseline.revision) { state.hardwareRevision = baseline.revision; state.pickedUp = !mapping.pickup; state.previous = null; }
  if (!state.pickedUp && mapping.pickup) {
    const expected = baseline.known ? (baseline.value - parameter.minimum) / (parameter.maximum - parameter.minimum) : null;
    if (expected == null || Math.abs(normalized - expected) > Math.max(mapping.deadband, 0.01) && !(state.previous != null && (state.previous - expected) * (normalized - expected) <= 0)) { state.previous = normalized; return null; }
    state.pickedUp = true;
  }
  const elapsedMs = state.targetMicroseconds == null ? null : Math.max(0, (targetMicroseconds - state.targetMicroseconds) / 1000);
  if (mapping.smoothingMs && elapsedMs != null && state.normalized != null) normalized = state.normalized + (normalized - state.normalized) * -Math.expm1(-elapsedMs / mapping.smoothingMs);
  state.targetMicroseconds = targetMicroseconds; state.normalized = normalized;
  const raw = parameter.type === 'enum' ? parameter.enumValues[Math.min(parameter.enumValues.length - 1, Math.round(normalized * (parameter.enumValues.length - 1)))]?.value :
    Math.round(parameter.minimum + normalized * (parameter.maximum - parameter.minimum));
  if (raw == null) return null;
  const value = quantizeDeviceParameter(parameter, raw);
  if (state.sent != null && Math.abs(value - state.sent) <= mapping.deadband * (parameter.maximum - parameter.minimum)) return null;
  state.sent = value; return value;
}
