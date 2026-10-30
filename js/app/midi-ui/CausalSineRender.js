import { planCausalOwnedRender, renderCausalOwnedTake } from './CausalOwnedRender.js';

const check = input => {
  if (input?.descriptor?.engineId !== 'worklet-sine') throw Object.assign(new Error('Choose a bounded sine render with its pinned descriptor.'), { name: 'CausalRenderError', code: 'render-preflight' });
};
export async function planCausalSineRender(input) { check(input); return planCausalOwnedRender(input); }
export async function renderCausalSineTake(input, options) { check(input); return renderCausalOwnedTake(input, options); }
