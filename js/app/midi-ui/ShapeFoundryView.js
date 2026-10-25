import { createShapeFoundryOwner } from './ShapeFoundryOwner.js';
import { ORIGINAL_SHAPE_BODY_IDS } from '../../midi/content/OriginalShapeMeshes.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';

export function createShapeFoundryView({ document, audio, resourceBudget, jobs, getTargetIdentity, onApply, onStatus = () => {} }) {
  const listeners = [], retirement = createProcgenRetirementScope(); let disposed = false, owner, preparedTarget = null, active = null, previousFocus = null;
  const node = (tag, text = '') => { const value = document.createElement(tag); value.textContent = text; return value; };
  const listen = (target, event, action) => { target.addEventListener(event, action); listeners.push(() => target.removeEventListener(event, action)); };
  const dialog = node('dialog'), title = node('h2', 'Pocket shape foundry'), fields = node('div'), actions = node('div'), status = node('output'), readiness = node('output'), details = node('pre');
  dialog.className = 'studio-dialog studio-echo-rack'; dialog.setAttribute('aria-label', 'Original shape body authoring'); status.setAttribute('role', 'status'); readiness.setAttribute('aria-label', 'Independent body compilation, audition and durability readiness'); details.setAttribute('aria-label', 'Actual geometry, solver, selected modes and qualification receipt');
  const field = (label, input) => { const wrapper = node('label', label); input.setAttribute('aria-label', label); wrapper.append(input); fields.append(wrapper); return input; };
  const select = (label, options) => { const input = field(label, node('select')); for (const [value, text] of options) { const option = node('option', text); option.value = String(value); input.append(option); } return input; };
  const shape = select('Original solid', ORIGINAL_SHAPE_BODY_IDS.map(id => [id, id.replaceAll('-', ' ')])), modes = select('Explicit mode budget', [8, 16, 32].map(value => [value, value + ' selected modes · unsupported tiers decline'])), rate = select('Prepared source rate', [44100, 48000, 96000].map(value => [value, value + ' Hz'])); rate.value = '48000';
  const duration = field('Finite body sample · seconds', node('input')); duration.type = 'number'; duration.min = '0.2'; duration.max = '4'; duration.step = '0.1'; duration.value = '2';
  const site = select('Explicit strike site', [['end', 'End'], ['shoulder', 'Shoulder'], ['corner', 'Corner']]);
  const config = () => ({ shapeId: shape.value, modeCount: Number(modes.value), sampleRate: Number(rate.value), seconds: Number(duration.value) }), key = value => JSON.stringify(value), targetKey = () => key(getTargetIdentity());
  const say = text => { if (!disposed) { status.textContent = text; try { onStatus(text); } catch {} } };
  let prepareButton, auditionButton, saveButton, applyButton;
  const refresh = () => {
    if (disposed || !owner) return; const value = owner.state(), matching = key(value.config) === key(config()), targetMatches = preparedTarget === targetKey();
    readiness.textContent = 'Compiled ' + (value.compiledReady ? 'ready' : 'unavailable') + ' · isolated audition ' + (value.auditionReady ? 'complete' : 'pending') + ' · durable ' + (value.durable ? 'yes' : 'no') + (value.compiledReady && !matching ? ' · current draft differs from retained body' : '') + (value.compiledReady && !targetMatches ? ' · selected lane or document changed' : '');
    status.textContent = value.error || value.phase + (value.progress ? ' · ' + value.progress.completedUnits + '/' + value.progress.totalUnits : '');
    prepareButton.disabled = !!active || value.active; auditionButton.disabled = !!active || value.active || !value.compiledReady || !matching || !targetMatches; saveButton.disabled = !!active || value.active || !value.auditionReady; applyButton.disabled = !!active || value.active || !value.durable || !value.auditionReady || !matching || !targetMatches;
    if (value.overview) details.textContent = JSON.stringify({ ...value.overview, content: value.contract }, null, 2);
  };
  const run = action => () => { if (disposed || active) return; let work; try { work = action(); } catch (error) { say(error.message); return; } active = Promise.resolve(work).catch(error => say(error.message)).finally(() => { active = null; refresh(); }); refresh(); };
  const button = (label, action) => { const value = node('button', label); value.type = 'button'; listen(value, 'click', action); actions.append(value); return value; };
  prepareButton = button('Prepare original body', run(async () => {
    if (!duration.checkValidity()) throw new Error('Choose a finite body duration from 0.2 to 4 seconds.'); const snapshot = config(), target = targetKey();
    await owner.prepare(snapshot, { isCurrent: () => !disposed && key(config()) === key(snapshot) && targetKey() === target }); preparedTarget = target; say('Prepared the exact original body and selected sites. Algebraic convergence is recorded; physical mesh accuracy and listening remain unqualified.');
  }));
  auditionButton = button('Prelisten selected site', run(() => owner.audition(site.value, { isCurrent: () => preparedTarget === targetKey() })));
  saveButton = button('Save immutable instrument', run(() => owner.install()));
  applyButton = button('Apply to selected lane', run(async () => { await owner.apply({ isCurrent: () => preparedTarget === targetKey() && key(owner.state().config) === key(config()) }); preparedTarget = targetKey(); say('Applied the ordinary saved instrument through the lane Undo boundary. Physical routes are unchanged.'); }));
  button('Restore retained body settings', () => { const value = owner.state().config; if (!value) return; shape.value = value.shapeId; modes.value = String(value.modeCount); rate.value = String(value.sampleRate); duration.value = String(value.seconds); refresh(); });
  button('Cancel / stop prelisten', () => owner.stop());
  const suspend = () => { owner?.stop(); if (dialog.open) dialog.close(); previousFocus?.focus?.({ preventScroll: true }); };
  button('Close', suspend); listen(dialog, 'cancel', event => { event.preventDefault(); suspend(); });
  for (const input of [shape, modes, rate, duration]) listen(input, 'change', () => { owner.stop(); refresh(); });
  dialog.append(title, node('p', 'Choose an original closed solid and prepare its selected modes off the audio thread. Meter scale, material assumptions, boundary conditions, signed sites and solver evidence are retained in the ordinary instrument pack. Changing the picture or painting terrain does not retune an active body.'),
    node('p', 'These coarse linear solids are experimental. Algebraic convergence does not establish mesh accuracy, physical material identity or perceptual quality. Site previews share one gain calibration. The resulting sampler keeps fixed body tuning; it does not infer root pitch or require a native solver during playback.'), fields, actions, readiness, status, details);
  (document.getElementById('procgenPresentationRoot') || document.body).append(dialog);
  try { owner = createShapeFoundryOwner({ audio, resourceBudget, jobs, onApply, onState: refresh }); } catch (error) { for (const remove of listeners) remove(); dialog.remove(); throw error; }
  return Object.freeze({ open() { if (disposed) return; previousFocus = document.activeElement; refresh(); if (!dialog.open) dialog.showModal(); }, suspend,
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); suspend(); disposed = true; const receipt = owner.dispose(); return retirement.retire([{ name: 'shape-foundry-owner', run: () => receipt }, { name: 'shape-foundry-view', run: async () => { await receipt.completion; for (const remove of listeners) remove(); dialog.remove(); } }]); } });
}
