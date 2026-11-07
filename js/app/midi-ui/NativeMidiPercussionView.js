import { DEFAULT_DRUM_ROLES } from '../../midi/native/DrumProfileAdapter.js';
import { validatePercussionIntentPolicy } from '../../midi/content/PercussionRoleIntent.js';

export function createNativeMidiPercussionView({ document, container, routes, getLane, getWireTarget, getProfileSession, getProfileRecord, onSave, onAssign, onStatus = () => {} }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Percussion roles / hardware pad map'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls);
  const removers = [], buttons = [], bind = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (label, node) => { const wrapper = element('label'); wrapper.className = 'midi-field'; wrapper.append(element('span', label), node); node.setAttribute('aria-label', label); controls.append(wrapper); return node; };
  const select = (label, values) => { const node = field(label, element('select')); for (const [value, text] of values) { const option = element('option', text); option.value = value; node.append(option); } return node; };
  const kinds = select('Hardware map', [['profile-default', 'Accepted Default Drum Note Map profile'], ['named-gm', 'Explicit General MIDI map · unverified receiver'], ['custom', 'Named custom note map · unverified receiver']]);
  const name = field('Map name', element('input')); name.maxLength = 128; name.value = 'Default Drum Note Map';
  const choices = DEFAULT_DRUM_ROLES.map(row => [row.instrumentRole, row.instrumentRole.replaceAll('-', ' ')]);
  const defaultRole = select('Default physical pad / contact role', choices), action = select('Physical action', ['walking', 'falling', 'building', 'bashing', 'digging', 'mining', 'climbing', 'blocking', 'landing', 'splatting'].map(value => [value, value]));
  const actionRole = select('Role for this action', choices);
  const note = field('Custom note for selected role', element('input')); note.type = 'number'; note.min = '0'; note.max = '127'; note.step = '1'; note.value = '36';
  const release = field('Release velocity (0–1)', element('input')); release.type = 'number'; release.min = '0'; release.max = '1'; release.step = '0.01'; release.value = '0';
  const status = element('output'); status.className = 'midi-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const rules = element('p'), custom = element('p'); root.append(status, rules, custom); container.append(root);
  let disposed = false, busy = false, serial = 0, actions = [], notes = [], laneId = null, message = '';
  const policy = () => validatePercussionIntentPolicy({ schema: 'lemmings-percussion-role-policy/v1', instrumentRole: defaultRole.value, actions, map: { kind: kinds.value, name: name.value, notes: kinds.value === 'custom' ? notes : [] }, releaseVelocity01: Number(release.value), overlapPolicy: 'refuse-same-note' });
  const render = () => {
    if (disposed) return; const lane = getLane(), target = getWireTarget(), record = getProfileRecord(), route = lane && routes.resolve(lane.outputId, lane.id);
    if (laneId !== lane?.id) {
      laneId = lane?.id ?? null; const saved = lane?.percussion; actions = [...(saved?.actions || [])]; notes = [...(saved?.map.notes || [])];
      defaultRole.value = saved?.instrumentRole || 'bass-drum'; kinds.value = saved?.map.kind || 'profile-default'; name.value = saved?.map.name || 'Default Drum Note Map'; release.value = String(saved?.releaseVelocity01 ?? 0);
    }
    for (const button of buttons) button.disabled = busy || !lane;
    const drum = record && ['7e20030101', '7e2003017f'].includes(record.id);
    features.disabled ||= !drum; activate.disabled ||= !lane?.percussion || kinds.value === 'profile-default' && (!drum || !record.enabled || !record.drumFeatures);
    note.disabled = kinds.value !== 'custom' || busy;
    const actual = route?.percussion?.mapping.find(row => row.instrumentRole === lane?.percussion?.instrumentRole);
    status.textContent = (lane ? 'Lane ' + (lane.name || lane.id) : 'Choose a lane') + (actual ? ' · ' + actual.instrumentRole.replaceAll('-', ' ') + ' → note ' + actual.note + ' · group ' + (route.group + 1) + ', channel ' + (route.channel + 1) + ' · ' + route.percussion.qualification : ' · map not activated') +
      (drum ? ' · receiver sound availability ' + (record.drumFeatures ? record.drumFeatures.availableNotes.length : 'unknown') : '') + (message ? ' · ' + message : '');
    rules.textContent = actions.length ? 'Action roles: ' + actions.map(row => row.action + ' → ' + row.instrumentRole).join(' · ') : 'Actual physical attacks keep their onset identities. This map assigns their instrument role; it does not generate a rhythm.';
    custom.textContent = kinds.value === 'custom' ? 'Custom roles: ' + (notes.map(row => row.instrumentRole + ' → note ' + row.note).join(' · ') || 'Add every role used above.') :
      'Same-note overlap is explicitly refused; note addresses are never rotated into other drums. Only an accepted profile establishes its mutually exclusive sets. Local and external drum timbres may differ.';
    if (target.grant && route && route.grant !== target.grant) activate.title = 'Review the selected hardware connection before rebinding';
  };
  const button = (label, operation) => {
    const node = element('button', label); node.type = 'button'; buttons.push(node); controls.append(node);
    bind(node, 'click', async () => { if (disposed || busy) return; const owned = ++serial; busy = true; render(); try { await operation(); } catch (error) { if (!disposed && owned === serial) { message = error.message; onStatus(message); } } finally { if (owned === serial) busy = false; render(); } }); return node;
  };
  const features = button('Read drum sound availability', async () => { const session = await getProfileSession(), record = getProfileRecord(); if (!record || !['7e20030101', '7e2003017f'].includes(record.id)) throw new Error('Select an advertised Default Drum Note Map profile above'); const response = await session.details(record.profile, record.scope, 1); message = response.reason || 'Drum features: ' + response.status; });
  button('Assign action to selected role', () => { const next = { action: action.value, instrumentRole: actionRole.value, articulation: 'default' }; actions = [...actions.filter(row => row.action !== next.action), next]; message = 'Action mapping drafted; save before activating'; });
  button('Remove selected action rule', () => { actions = actions.filter(row => row.action !== action.value); });
  button('Set custom note for selected role', () => {
    const value = Number(note.value); if (!Number.isInteger(value) || value < 0 || value > 127 || notes.some(row => row.instrumentRole !== actionRole.value && row.note === value)) throw new Error('Choose a unique note number for this custom drum role');
    notes = [...notes.filter(row => row.instrumentRole !== actionRole.value), { instrumentRole: actionRole.value, note: value }]; message = 'Custom address drafted; receiver sound/choke behavior remains unverified';
  });
  button('Save percussion role intent', () => { const lane = getLane(); onSave(lane.id, policy()); message = 'Percussion intent saved. Explicitly activate the current device map before native playback.'; });
  const activate = button('Activate reviewed drum map on this channel', async () => {
    const lane = getLane(), target = getWireTarget(); if (!lane?.percussion) throw new Error('Save the lane’s percussion policy first');
    let session = null, record = null; if (lane.percussion.map.kind === 'profile-default') { session = await getProfileSession(); record = getProfileRecord(); }
    await routes.prepareOutput(target.grant); const route = routes.bindPercussion({ laneId: lane.id, policy: lane.percussion, ...target, session, profile: record?.profile });
    onAssign(lane.id, route); message = 'Drum role mapping active on the explicitly selected channel. Its saved local kit remains independent.';
  });
  for (const node of [kinds, defaultRole, actionRole]) bind(node, 'change', render);
  bind(root, 'toggle', () => { if (root.open) render(); }); render();
  return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; serial++; for (const remove of removers) remove(); root.remove(); } });
}
