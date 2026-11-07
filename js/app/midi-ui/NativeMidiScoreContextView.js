import { FLEX_CHORD_TYPES } from '../../midi/protocol/UmpFlexData.js';
import { validateScoreContextPolicy } from '../../midi/content/ScoreContext.js';

export function createNativeMidiScoreContextView({ document, container, routes, getLane, getReceiveScope, onSave, onStatus }) {
  const element = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const root = element('details'); root.className = 'midi-preset-panel'; root.append(element('summary', 'Authored score context / received metadata'));
  const controls = element('div'); controls.className = 'midi-control-group'; root.append(controls); container.append(root);
  const removers = [], bind = (node, type, handler) => { node.addEventListener(type, handler); removers.push(() => node.removeEventListener(type, handler)); };
  const field = (text, node) => { const label = element('label'); label.className = 'midi-field'; label.append(element('span', text), node); controls.append(label); node.setAttribute('aria-label', text); return node; };
  const check = text => { const node = field(text, element('input')); node.type = 'checkbox'; return node; };
  const number = (text, min, max, value = 0) => { const node = field(text, element('input')); node.type = 'number'; node.min = String(min); node.max = String(max); node.step = '1'; node.value = String(value); return node; };
  const select = (text, choices) => { const node = field(text, element('select')); for (const [value, title] of choices) { const option = element('option', title); option.value = String(value); node.append(option); } return node; };
  const notes = [[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D'], [5, 'E'], [6, 'F'], [7, 'G']];
  const enabled = check('Transmit authored context on this native lane'), address = select('Harmony / annotation scope', [['channel', 'This channel'], ['group', 'This entire group']]);
  const title = field('Authored composition / phrase name', element('input')), annotation = field('Authored performance annotation', element('textarea')); title.maxLength = annotation.maxLength = 384;
  const hasKey = check('Declare a key signature'), keyAccidentals = number('Key signature flats (negative) / sharps (positive)', -8, 7), keyTonic = select('Key tonic', [[0, 'Unknown / nonstandard'], ...notes]);
  const hasChord = check('Declare an authored chord'), chordType = select('Chord quality', FLEX_CHORD_TYPES.map((title, index) => [index, title])), chordTonic = select('Chord tonic', notes), chordAccidental = number('Chord tonic accidental', -2, 2);
  const bass = select('Alternate bass tonic', [[0, 'Same as chord tonic'], ...notes]), bassAccidental = number('Alternate bass accidental', -2, 2), bassType = select('Bass chord quality', FLEX_CHORD_TYPES.map((title, index) => [index, title]));
  const changes = [], bassChanges = [];
  const alterationControls = (label, count, destination) => { for (let index = 0; index < count; index++) destination.push({ type: select(label + ' ' + (index + 1), [[0, 'None'], [1, 'Add'], [2, 'Subtract'], [3, 'Raise'], [4, 'Lower']]), degree: number(label + ' ' + (index + 1) + ' degree', 1, 15, index + 5) }); };
  alterationControls('Chord alteration', 4, changes); alterationControls('Bass alteration', 2, bassChanges);
  const save = element('button', 'Save authored context for this lane'); save.type = 'button'; controls.append(save);
  const status = element('output'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const received = element('div'); root.append(status, received, element('p', 'Tempo and meter come from the physical score timeline. Context precedes dependent native onsets at their existing physical deadlines. Received metadata stays read only. Inferred harmonic estimates are not transmitted as authored facts.'));
  let displayed = null, laneId = null, disposed = false, message = '';
  const setChanges = (nodes, values) => nodes.forEach((node, index) => { node.type.value = String(values?.[index]?.type || 0); node.degree.value = String(values?.[index]?.degree || index + 5); });
  const readChanges = nodes => nodes.filter(node => Number(node.type.value)).map(node => ({ type: Number(node.type.value), degree: Number(node.degree.value) }));
  const render = () => {
    if (disposed) return; const lane = getLane(), value = lane?.scoreContext || null;
    if (displayed !== value || laneId !== lane?.id) {
      displayed = value; laneId = lane?.id; enabled.checked = value?.enabled === true; address.value = value?.address || 'channel'; title.value = value?.title || ''; annotation.value = value?.annotation || '';
      hasKey.checked = !!value?.key; keyAccidentals.value = String(value?.key?.accidentals || 0); keyTonic.value = String(value?.key?.tonic || 3);
      hasChord.checked = !!value?.chord; chordType.value = String(value?.chord?.type ?? 1); chordTonic.value = String(value?.chord?.tonic || 3); chordAccidental.value = String(value?.chord?.accidental || 0);
      bass.value = String(value?.chord?.bass?.tonic || 0); bassAccidental.value = String(value?.chord?.bass?.accidental === -8 ? 0 : value?.chord?.bass?.accidental || 0); bassType.value = String(value?.chord?.bass?.type || 0); setChanges(changes, value?.chord?.alterations); setChanges(bassChanges, value?.chord?.bass?.alterations);
    }
    save.disabled = !lane; status.textContent = (value?.enabled ? 'Authored score context enabled for ' : 'Authored score context disabled for ') + (lane?.name || 'selected lane') + (message ? ' · ' + message : '');
    const rows = routes.receivedScoreContext(getReceiveScope()), heading = element('p', 'Received device metadata · read only · ' + rows.length + ' current observations'); received.replaceChildren(heading);
    for (const row of rows.slice(-12)) {
      const value = row.value;
      const description = row.kind === 'tempo' ? (6000000000 / value.tenNanosecondsPerQuarter).toFixed(3) + ' BPM' : row.kind === 'meter' ? value.numerator + '/' + (value.denominatorExponent <= 30 ? 2 ** value.denominatorExponent : '2^' + value.denominatorExponent) : row.kind === 'text' ? value.text : row.kind === 'chord' ? FLEX_CHORD_TYPES[value.type] + ' · tonic ' + (notes.find(([note]) => note === value.tonic)?.[1] || 'unknown') : 'Key · ' + value.accidentals + ' sharps/flats · tonic ' + (notes.find(([note]) => note === value.tonic)?.[1] || 'unknown');
      received.append(element('p', row.kind + ' · group ' + (row.group + 1) + (row.channel == null ? '' : ', channel ' + (row.channel + 1)) + ' · ' + description));
    }
  };
  bind(save, 'click', () => {
    try {
      const type = Number(chordType.value), bassNote = Number(bass.value);
      const policy = validateScoreContextPolicy({ enabled: enabled.checked, address: address.value, title: title.value, annotation: annotation.value,
        key: hasKey.checked ? { accidentals: Number(keyAccidentals.value), tonic: Number(keyTonic.value) } : null,
        chord: hasChord.checked ? { type, tonic: type === 0 ? 0 : Number(chordTonic.value), accidental: type === 0 ? 0 : Number(chordAccidental.value), alterations: type === 0 ? [] : readChanges(changes),
          bass: bassNote ? { tonic: bassNote, accidental: Number(bassAccidental.value), type: Number(bassType.value), alterations: readChanges(bassChanges) } : undefined } : null });
      onSave(getLane().id, policy); message = 'Saved authored context. Unsupported MIDI1 harmony requires an explicit conversion loss decision.'; onStatus(message);
    } catch (error) { message = error.message; onStatus(message); } render();
  });
  render(); return Object.freeze({ render, dispose() { if (disposed) return; disposed = true; for (const remove of removers) remove(); root.remove(); } });
}
