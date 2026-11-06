import { ORCHESTRAL_ARTICULATIONS, ORCHESTRAL_CATEGORIES, validateOrchestralArticulationPolicy } from '../../midi/content/OrchestralArticulationIntent.js';

export function createNativeMidiArticulationView({ document, container, routes, getLane, getWireTarget, getProfileSession, getProfileRecord, onSave, onAssign, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Orchestral articulation / physical actions'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (label, node) => { const wrapper = element('label'); wrapper.className = 'midi-field'; wrapper.append(element('span', label), node); node.setAttribute('aria-label', label); controls.append(wrapper); return node; };
  const select = (label, values) => { const node = field(label, element('select')); for (const [value, text] of values) { const option = element('option', text); option.value = String(value); node.append(option); } return node; };
  const numeric = (label, minimum, maximum, value, step = 'any') => { const node = field(label, element('input')); node.type = 'number'; node.min = String(minimum); node.max = String(maximum); node.value = String(value); node.step = String(step); return node; };
  const category = select('Authored instrument category', ORCHESTRAL_CATEGORIES.map(value => [value, value.replaceAll('-', ' ')]));
  const choices = ORCHESTRAL_ARTICULATIONS.map(row => [row.semanticId, row.label + ' · ' + (row.attributeType - 15) + '/' + (row.subclass + 1)]);
  const articulation = select('Default onset articulation', choices), variation = numeric('Variation (1–16)', 1, 16, 1, 1);
  const action = select('Physical action', ['walking', 'falling', 'climbing', 'hoisting', 'jumping', 'building', 'bashing', 'digging', 'mining', 'blocking', 'splatting'].map(value => [value, value]));
  const actionArticulation = select('Articulation for this action', choices), actionVariation = numeric('Action variation (1–16)', 1, 16, 1, 1);
  const direction = select('Stroke / hand direction', [[0, 'Receiver chooses'], [1, 'Down / right'], [2, 'Up / left']]);
  const string = select('String assignment', [[0, 'Receiver chooses'], ...Array.from({ length: 7 }, (_, index) => [index + 1, index === 6 ? 'Other string' : 'String ' + (index + 1)])]);
  const reset = field('Restart receiver round robin on each onset', element('input')); reset.type = 'checkbox';
  const muteType = select('Optional mute type', [['', 'Leave unchanged'], ...['No mute', 'Straight / standard', 'Practice', 'Cup', 'Harmon stem in', 'Harmon extended', 'Harmon removed', 'Plunger', 'Bucket', 'Mica', 'Solotone', 'Whisper', 'Hat', 'Hand', 'Stopped', 'Into stand'].map((label, index) => [index, label])]);
  const muteAmount = numeric('Optional mute amount (0–1; empty leaves unchanged)', 0, 1, ''), position = numeric('Optional playing position (0–1; empty leaves unchanged)', 0, 1, '');
  const release = select('Note ending', [['', 'Receiver chooses'], [0, 'No ending sample'], [1, 'Soft ending'], [2, 'Hard ending'], [3, 'Pitch rise'], [4, 'Pitch fall']]);
  const releaseVelocity = numeric('Optional release time control (0 longest, 1 shortest; empty uses receiver default)', 0, 1, '');
  const status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const rules = element('p'); root.append(status, rules, element('p', 'Instrument category is authored context; the profile reports available articulation variations. A microtonal onset requiring the same attribute slot is refused on this route. No keyswitch notes are generated.')); container.append(root);
  let disposed = false, busy = false, serial = 0, laneId = null, actions = [], message = '';
  const optional = node => node.value === '' ? null : Number(node.value);
  const policy = () => validateOrchestralArticulationPolicy({ schema: 'lemmings-orchestral-articulation-policy/v1', category: category.value, semanticId: articulation.value, variation: Number(variation.value) - 1,
    direction: Number(direction.value), stringAssignment: Number(string.value), resetRoundRobin: reset.checked, actions, microtonalPolicy: 'refuse-attribute-slot-conflict',
    muteType: optional(muteType), muteAmount01: optional(muteAmount), playingPosition01: optional(position), release: { subclass: optional(release), variation: 0, velocity01: optional(releaseVelocity) } });
  const render = () => {
    if (disposed) return; const lane = getLane(), record = getProfileRecord(), features = record?.id === '7e21010101' ? record.orchestralFeatures : null;
    if (laneId !== lane?.id) {
      laneId = lane?.id ?? null; const saved = lane?.orchestral; actions = [...(saved?.actions || [])]; category.value = saved?.category || 'strings'; articulation.value = saved?.semanticId || 'sustain'; variation.value = String((saved?.variation ?? 0) + 1);
      direction.value = String(saved?.direction ?? 0); string.value = String(saved?.stringAssignment ?? 0); reset.checked = saved?.resetRoundRobin || false;
      muteType.value = saved?.muteType == null ? '' : String(saved.muteType); muteAmount.value = saved?.muteAmount01 == null ? '' : String(saved.muteAmount01); position.value = saved?.playingPosition01 == null ? '' : String(saved.playingPosition01);
      release.value = saved?.release.subclass == null ? '' : String(saved.release.subclass); releaseVelocity.value = saved?.release.velocity01 == null ? '' : String(saved.release.velocity01);
    }
    for (const button of buttons) button.disabled = busy || !lane; read.disabled ||= record?.id !== '7e21010101';
    activate.disabled ||= !lane?.orchestral || !record?.enabled || !features;
    for (const picker of [articulation, actionArticulation]) for (const option of picker.options) {
      const row = ORCHESTRAL_ARTICULATIONS.find(row => row.semanticId === option.value), count = features?.variations[(row.attributeType - 16) * 16 + row.subclass];
      option.textContent = row.label + (count == null ? ' · availability unknown' : count ? ' · ' + count + ' variations' : ' · unavailable');
    }
    const route = lane && routes.resolve(lane.outputId, lane.id);
    status.textContent = (lane ? 'Lane ' + (lane.name || lane.id) : 'Choose a lane') + (route?.orchestral ? ' · ' + route.orchestral.policy.category + ' · accepted single-channel profile · group ' + (route.group + 1) + ', channel ' + (route.channel + 1) : ' · orchestral profile not bound') +
      (features ? ' · available articulation families ' + features.variations.filter(Boolean).length : ' · read current profile details') + (message ? ' · ' + message : '');
    rules.textContent = actions.length ? 'Physical action choices: ' + actions.map(row => row.action + ' → ' + row.semanticId + ' (variation ' + (row.variation + 1) + ')').join(' · ') : 'Each physical onset carries its own default articulation. Articulation changes do not add or move source onsets.';
  };
  const button = (label, operation) => {
    const node = element('button', label); node.type = 'button'; buttons.push(node); controls.append(node);
    bind(node, 'click', async () => { if (busy || disposed) return; const owned = ++serial; busy = true; render(); try { await operation(); } catch (error) { if (!disposed && owned === serial) { message = error.message; onStatus(message); } } finally { if (owned === serial) busy = false; render(); } }); return node;
  };
  const read = button('Read orchestral sound / optional-control details', async () => { const session = await getProfileSession(), record = getProfileRecord(); if (record?.id !== '7e21010101') throw new Error('Select the advertised orchestral articulation profile above'); const response = await session.details(record.profile, record.scope, 1); message = response.reason || 'Orchestral details: ' + response.status; });
  button('Assign articulation to this physical action', () => { const row = { action: action.value, semanticId: actionArticulation.value, variation: Number(actionVariation.value) - 1 }; actions = [...actions.filter(value => value.action !== row.action), row]; message = 'Action articulation drafted; save the lane policy before activating'; });
  button('Remove selected action choice', () => { actions = actions.filter(row => row.action !== action.value); });
  button('Draft builder / climber / impact articulations', () => { actions = [{ action: 'building', semanticId: 'staccato', variation: 0 }, { action: 'climbing', semanticId: 'legato', variation: 0 }, { action: 'falling', semanticId: 'marcato', variation: 0 }]; message = 'Suggested action choices drafted. Receiver availability is checked before activation.'; });
  button('Save lane articulation intent', () => { onSave(getLane().id, policy()); message = 'Semantic articulation intent saved. Review the current instrument profile and activate this route.'; });
  const activate = button('Activate accepted orchestral profile for this lane', async () => {
    const lane = getLane(), session = await getProfileSession(), record = getProfileRecord(), target = getWireTarget();
    if (!lane?.orchestral || record?.id !== '7e21010101') throw new Error('Save an articulation policy and select its accepted profile');
    await routes.prepareOutput(target.grant); const route = routes.bindOrchestral({ laneId: lane.id, policy: lane.orchestral, ...target, session, profile: record.profile }); onAssign(lane.id, route); message = 'Onsets now carry their chosen standardized articulation. Receiver sound and audible equivalence remain separate.';
  });
  bind(root, 'toggle', () => { if (root.open) render(); }); render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; serial++; for (const remove of removers) remove(); root.remove(); } });
}
