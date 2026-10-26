import { prepareResonatorBlendKernelProfile } from '../../../midi/content/ResonatorBlendProfile.js';
import { prepareResonatorMorphKernelProfile, ResonatorMorphKernel } from './ResonatorMorphKernel.js';
import { ResonatorBlendKernel } from './ResonatorBlendKernel.js';
export const RESONATOR_REFERENCE_DECODER_REVISION = 'reviewed-resonator-body-control-render-v2';
export const prepareResonatorControlProfile = (map, a, b, rate) => map?.transitionPolicy === 'prepared-dual-body-blend' ? prepareResonatorBlendKernelProfile(map, a, b, rate) : prepareResonatorMorphKernelProfile(map, a, b, rate);
export const createResonatorControlKernel = profile => profile.transitionPolicy === 'prepared-dual-body-blend' ? new ResonatorBlendKernel(profile) : new ResonatorMorphKernel(profile);
