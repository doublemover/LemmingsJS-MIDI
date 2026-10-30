import { formatLaneGain, parseLaneGain } from './LaneMixState.js';

const formatGainInput = value => value === 0 ? '-inf' : (20 * Math.log10(value)).toFixed(2);
const formatPan = pan => pan === 0 ? 'Center' : `${Math.abs(Number(pan.toFixed(1)))} ${pan < 0 ? 'L' : 'R'}`;
const parsePan = text => { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error('Enter a signed decimal pan position.'); return Number(text); };

export const createLaneLevelDescriptor = laneId => Object.freeze({ id: 'lane-fader:' + laneId, name: 'Level', quantity: 'lane-gain', unit: 'dB', min: 0, max: 2, step: 0.01, fineStep: 0.001, defaultValue: 1, detents: Object.freeze([1]), format: formatLaneGain, formatInput: formatGainInput, parse: parseLaneGain });
export const createLanePanDescriptor = laneId => Object.freeze({ id: 'lane-pan:' + laneId, name: 'Pan', quantity: 'stereo-position', unit: 'pan units', min: -127, max: 127, step: 1, fineStep: 0.1, defaultValue: 0, detents: Object.freeze([0]), format: formatPan, parse: parsePan });
