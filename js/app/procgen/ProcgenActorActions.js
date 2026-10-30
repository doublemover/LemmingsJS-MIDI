import { LemmingStateType as State } from '../../lemmings/LemmingStateType.js';

const PROCGEN_ACTION_LABELS = Object.freeze(['walk', 'fall', 'jump', 'dig', 'climb', 'build', 'block', 'bash', 'float', 'mine', 'idle']);
const STATES = [['WALKING', 0], ['FALLING', 1], ['JUMPING', 2], ['DIGGING', 3], ['CLIMBING', 4], ['HOISTING', 4],
  ['BUILDING', 5], ['BLOCKING', 6], ['BASHING', 7], ['FLOATING', 8], ['MINING', 9], ['SHRUG', 10]];
const createProcgenActionCodes = actions => {
  const codes = new Map();
  for (const [state, code] of STATES) { const action = actions?.[State[state]]; if (action) codes.set(action, code); }
  return codes;
};
const labelCache = new Map();
const formatProcgenActionMask = (mask, order) => {
  if (!mask) return '';
  const key = `${mask}:${order}`, cached = labelCache.get(key);
  if (cached != null) { labelCache.delete(key); labelCache.set(key, cached); return cached; }
  const labels = [];
  for (let remaining = order; remaining > 0; remaining = Math.floor(remaining / 16)) {
    const code = remaining % 16 - 1;
    if (code >= 0 && code < PROCGEN_ACTION_LABELS.length && mask & 1 << code) labels.push(PROCGEN_ACTION_LABELS[code]);
  }
  const value = labels.reverse().join(' ');
  if (labelCache.size >= 256) labelCache.delete(labelCache.keys().next().value);
  labelCache.set(key, value); return value;
};

export { PROCGEN_ACTION_LABELS, createProcgenActionCodes, formatProcgenActionMask };
