import { renderOwnedSourceControls } from './OwnedSourceControlRender.js';

export function renderOwnedSineControls(input, options) {
  if (input?.descriptor?.engineId !== 'worklet-sine') return Promise.reject(new TypeError('Offline controls require the pinned sine engine and a supported sample rate.'));
  return renderOwnedSourceControls(input, options);
}
