const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;
const drawbars = value => Array.isArray(value) && value.length === 9 && value.every(number => Number.isInteger(number) && number >= 0 && number <= 8);
export const ORGAN_DRAWBAR_NAMES = Object.freeze(['16′', '5⅓′', '8′', '4′', '2⅔′', '2′', '1⅗′', '1⅓′', '1′']);
export function validateOrganRotaryPolicy(value) {
  if (!value || value.schema !== 'lemmings-organ-rotary-policy/v1' || !['organ', 'rotary', 'both'].includes(value.profiles) || !['primary', 'parallel-control'].includes(value.routeMode) ||
      value.routeMode === 'parallel-control' && value.profiles !== 'rotary' || !['none', 'represented-actor-density'].includes(value.drawbarSource) ||
      !drawbars(value.minimumDrawbars) || !drawbars(value.maximumDrawbars) || !['none', 'cohort-circulation'].includes(value.rotarySource) ||
      !Number.isFinite(value.fullRotationRadiansPerSecond) || value.fullRotationRadiansPerSecond <= 0 || value.fullRotationRadiansPerSecond > 1000 ||
      !Number.isFinite(value.smoothingMs) || value.smoothingMs < 0 || value.smoothingMs > 60000 || !unit(value.deadband01) || typeof value.pickup !== 'boolean') throw new Error('Invalid authored organ/rotary source policy');
  return Object.freeze({ schema: value.schema, profiles: value.profiles, routeMode: value.routeMode, drawbarSource: value.drawbarSource,
    minimumDrawbars: Object.freeze([...value.minimumDrawbars]), maximumDrawbars: Object.freeze([...value.maximumDrawbars]), rotarySource: value.rotarySource,
    fullRotationRadiansPerSecond: value.fullRotationRadiansPerSecond, smoothingMs: value.smoothingMs, deadband01: value.deadband01, pickup: value.pickup, reconnect: 'explicit-profile-review-required' });
}
export function validateOrganRotaryControls(value = {}) {
  if (!value || value.drawbars != null && !drawbars(value.drawbars) || value.rotaryFast != null && typeof value.rotaryFast !== 'boolean' ||
      value.rotaryBrake != null && typeof value.rotaryBrake !== 'boolean' || value.percussion != null && typeof value.percussion !== 'boolean' ||
      value.keyClick01 != null && !unit(value.keyClick01) || value.leakage01 != null && !unit(value.leakage01) ||
      value.acceleration01 != null && !unit(value.acceleration01)) throw new Error('Invalid drawbar/rotary performance controls');
  return Object.freeze({ drawbars: value.drawbars ? Object.freeze([...value.drawbars]) : null, rotaryFast: value.rotaryFast ?? null, rotaryBrake: value.rotaryBrake ?? null, percussion: value.percussion ?? null,
    keyClick01: value.keyClick01 ?? null, leakage01: value.leakage01 ?? null, acceleration01: value.acceleration01 ?? null });
}
