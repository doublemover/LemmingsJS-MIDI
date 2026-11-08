import { freezeData } from '../../core/CanonicalData.js';

export const FINITE_FM_EXCITER_REVISION = 'original-softened-fm-strike-12ms-v1';
export const FINITE_FM_EXCITER = freezeData({ revision: FINITE_FM_EXCITER_REVISION, supportSeconds: 0.012, carrierHz: 440, modulatorHz: 660, indexStart: 0.9, indexEnd: 0.08, gain: 0.25,
  equation: 'integrated-frequency-FM;index-linear-in-material-time;Hann-support;weighted-DC-removal-before-fixed-gain', maximumPeak: 0.5, pitch: 'fixed-material-rate;body-root-is-independent', quality: 'original-unqualified-source;no-alias-or-perceptual-equivalence-claim' });
