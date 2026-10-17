import { expect } from 'chai';
import { createProcgenMusicControls, spreadLabel } from '../js/app/procgen/ProcgenMusicControls.js';
import { TestDocument } from './helpers/test-dom.js';
const fixture = (ranges = []) => {
  const document = new TestDocument(), create = document.createElement.bind(document);
  document.createElement = tag => {
    const el = create(tag);
    el.removeEventListener = (type, handler) => el.listeners.set(type, (el.listeners.get(type) || []).filter(fn => fn !== handler));
    el.replaceChildren = (...children) => { el.children = []; el.append(...children); };
    el.remove = () => el.parent?.removeChild(el);
    el.insertBefore = (child, before) => { child.parent?.removeChild(child); child.parent = el; el.children.splice(before ? el.children.indexOf(before) : el.children.length, 0, child); };
    return el;
  };
  for (const id of ['procgenMusicGlobalControls', 'procgenLaneMusicControls']) document.registerElement(id, document.createElement('div'));
  const state = { root: 0, scaleId: 'major', spread: 12, stereoWidth: 64, variation: 'balanced', laneCount: 8, defaultSchemeId: 'melody', maxRanges: 32,
    schemes: [{ id: 'melody', label: 'Melody', description: 'Melodic voices' }, { id: 'drums', label: 'Drums', description: 'Drum responses' }], scales: [{ id: 'major', label: 'Major' }], ranges };
  const commands = [], ui = createProcgenMusicControls({ document, getState: () => state, onChange: command => {
    commands.push(command);
    if (command.type === 'global') Object.assign(state, command.patch);
    if (command.type === 'addRange') state.ranges.push(range('added', 1, 8));
    if (command.type === 'removeRange') state.ranges = state.ranges.filter(row => row.id !== command.id);
    if (command.type === 'updateRange') Object.assign(state.ranges.find(row => row.id === command.id), command.patch);
  } });
  const el = id => document._all.find(element => element.id === id);
  return { document, state, commands, ui, el, rows: () => document.getElementById('procgenLaneMusicControls').querySelectorAll('.procgen-lane-music-row') };
};
const range = (id, startLane, endLane, schemeId = 'drums', enabled = true) => ({ id, startLane, endLane, schemeId, enabled });
describe('procgen music workspace controls', () => {
  it('labels musical spread and dispatches valid global edits without owning persistence', () => {
    const f = fixture(), root = f.el('procgenMusicRoot'), spread = f.el('procgenMusicSpread');
    expect(root.children.map(option => option.textContent)).to.include.members(['C', 'B', 'F# / Gb']);
    expect(spreadLabel(0)).to.equal('Same register · 0 semitones'); expect(spreadLabel(24)).to.equal('2 octaves · 24 semitones');
    spread.value = ''; spread.dispatchEvent({ type: 'change' }); expect(f.commands).to.have.length(0); expect(spread.value).to.equal('12');
    spread.value = '49'; spread.dispatchEvent({ type: 'change' }); expect(f.commands).to.have.length(0);
    spread.value = '18'; spread.dispatchEvent({ type: 'change' }); expect(f.commands).to.deep.equal([{ type: 'global', patch: { spread: 18 } }]);
    expect(f.el('procgenMusicSpreadValue').textContent).to.equal('18 semitones');
    f.ui.dispose(); root.value = '7'; root.dispatchEvent({ type: 'change' }); expect(f.commands).to.have.length(1);
  });
  it('shows last-enabled overlap precedence, defaults and retained out-of-run ranges', () => {
    const f = fixture([range('early', 2, 6), range('late', 4, 5, 'melody'), range('later-disabled', 1, 8, 'drums', false), range('future', 10, 12)]);
    const rows = f.rows(); expect(rows[0].querySelectorAll('.procgen-lane-music-summary')[0].textContent).to.equal('3 of 8 current lanes use this scheme.');
    expect(rows[0].querySelectorAll('.procgen-lane-music-warning')[0].textContent).to.include('Partly overridden');
    expect(rows[2].querySelectorAll('.procgen-lane-music-summary')[0].textContent).to.include('Disabled');
    expect(rows[3].querySelectorAll('.procgen-lane-music-warning')[0].textContent).to.include('Saved through lane 12');
    expect(f.el('procgenLaneMusicAssignments').children.map(el => el.textContent)).to.deep.equal(['Lane 1: Melody (default)', 'Lanes 2–3: Drums', 'Lanes 4–5: Melody', 'Lane 6: Drums', 'Lanes 7–8: Melody (default)']);
    expect(f.state.ranges).to.have.length(4); f.ui.dispose();
  });
  it('retains focused drafts and row identity on refresh and restores focus after removal', () => {
    const f = fixture([range('one', 1, 4)]), row = f.rows()[0], fields = row.children[0], start = fields.children[1].children[0];
    start.focus(); start.value = ''; f.ui.sync(); expect(start.value).to.equal(''); expect(f.rows()[0]).to.equal(row); expect(f.document.activeElement).to.equal(start);
    start.dispatchEvent({ type: 'change' }); expect(start.value).to.equal('1'); expect(f.commands).to.have.length(0);
    const remove = fields.children[4].children[2]; remove.focus(); remove.dispatchEvent({ type: 'click' });
    expect(f.commands).to.deep.equal([{ type: 'removeRange', id: 'one' }]); expect(f.rows()).to.have.length(0); expect(f.document.activeElement).to.equal(f.el('procgenLaneMusicAdd')); f.ui.dispose();
  });
  it('puts keyboard focus on the newly added range', () => {
    const f = fixture(); f.el('procgenLaneMusicAdd').dispatchEvent({ type: 'click' });
    expect(f.rows()).to.have.length(1); expect(f.document.activeElement).to.equal(f.rows()[0].children[0].children[1].children[0]);
    f.ui.dispose();
  });
  it('bounds additions and preserves keyed controls when priority order changes', () => {
    const f = fixture([range('one', 1, 5), range('two', 3, 8)]), initial = f.rows();
    f.state.maxRanges = 2; f.ui.sync(); expect(f.el('procgenLaneMusicAdd').disabled).to.equal(true);
    const up = initial[1].children[0].children[4].children[0]; up.focus(); up.dispatchEvent({ type: 'click' });
    expect(f.commands[0]).to.deep.equal({ type: 'moveRange', id: 'two', direction: -1 });
    f.state.ranges.reverse(); f.ui.sync(); expect(f.rows()[0]).to.equal(initial[1]); expect(f.document.activeElement).to.equal(up); f.ui.dispose();
  });
});
