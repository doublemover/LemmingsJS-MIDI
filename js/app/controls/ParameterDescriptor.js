const clamp = value => Math.max(0, Math.min(1, value));
const functionalRoles = new Set(['neutral', 'pitch', 'time', 'timbre', 'level', 'space', 'danger']);
const quantityRoles = Object.freeze({ 'pitch-offset': 'pitch', 'lane-gain': 'level', 'event-velocity-multiplier': 'level', 'stereo-position': 'space' });
export function normalizeParameterDescriptor(input) {
  if (!input || typeof input.id !== 'string' || !input.id || typeof input.name !== 'string' || typeof input.quantity !== 'string' ||
      typeof input.unit !== 'string' || !Number.isFinite(input.min) || !Number.isFinite(input.max) || input.min >= input.max ||
      !Number.isFinite(input.defaultValue) || input.defaultValue < input.min || input.defaultValue > input.max ||
      !Number.isFinite(input.step) || input.step <= 0 || input.scale === 'logarithmic' && input.min <= 0) throw new Error('Invalid typed parameter descriptor.');
  const scale = input.scale ?? 'linear'; if (!['linear', 'logarithmic'].includes(scale)) throw new Error('Unsupported parameter scale.');
  const functionalRole = input.functionalRole ?? quantityRoles[input.quantity] ?? 'neutral';
  if (!functionalRoles.has(functionalRole)) throw new Error('Unsupported parameter function.');
  const fineStep = input.fineStep ?? input.step / 10;
  if (!Number.isFinite(fineStep) || fineStep <= 0 || !Number.isSafeInteger(input.revision ?? 1)) throw new Error('Invalid parameter precision.');
  const detents = [...new Set(input.detents || (input.min < 0 && input.max > 0 ? [0] : []))].sort((a, b) => a - b);
  if (detents.length > 64 || detents.some(value => !Number.isFinite(value) || value < input.min || value > input.max)) throw new Error('Invalid parameter detents.');
  return Object.freeze({ ...input, revision: input.revision ?? 1, scale, functionalRole, fineStep, detents: Object.freeze(detents) });
}
export const parameterUnitPosition = (descriptor, value) => descriptor.scale === 'logarithmic'
  ? clamp(Math.log(value / descriptor.min) / Math.log(descriptor.max / descriptor.min)) : clamp((value - descriptor.min) / (descriptor.max - descriptor.min));
export const parameterValueAt = (descriptor, position) => descriptor.scale === 'logarithmic'
  ? descriptor.min * (descriptor.max / descriptor.min) ** clamp(position) : descriptor.min + clamp(position) * (descriptor.max - descriptor.min);
export function quantizeParameter(descriptor, value, fine = false) {
  if (!Number.isFinite(value)) throw new Error('A finite parameter value is required.');
  const step = fine ? descriptor.fineStep : descriptor.step;
  return Math.max(descriptor.min, Math.min(descriptor.max, Number((descriptor.min + Math.round((value - descriptor.min) / step) * step).toPrecision(14))));
}
export function parseParameterValue(descriptor, input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Enter a value; an empty field is not zero.');
  let text = input.trim(); if (descriptor.unit && text.endsWith(descriptor.unit)) text = text.slice(0, -descriptor.unit.length).trim();
  const value = descriptor.parse ? descriptor.parse(text) : Number(text);
  if (!Number.isFinite(value) || value < descriptor.min || value > descriptor.max) throw new Error(`Enter ${descriptor.min}–${descriptor.max} ${descriptor.unit}.`);
  return quantizeParameter(descriptor, value, true);
}
export const formatParameterValue = (descriptor, value) => value == null ? 'absolute value unknown' : descriptor.format ? descriptor.format(value) : `${Number(value.toPrecision(8))}${descriptor.unit ? ' ' + descriptor.unit : ''}`;
