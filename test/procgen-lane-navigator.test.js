import { expect } from 'chai';
import { JSDOM } from 'jsdom';
import { createLaneNavigator, createLaneNavigatorView } from '../js/app/procgen/workstation/LaneNavigator.js';

const lanes = count => Array.from({ length: count }, (_, index) => ({ id: 'lane-' + (index + 1), name: index === 63 ? 'Duplicate name' : 'Lane ' + (index + 1), role: 'melody', solo: false }));

describe('stable bounded lane navigation', () => {
  for (const count of [1, 8, 64, 1024]) it(`searches and pages ${count} lanes without editing lane data`, () => {
    const source = lanes(count), original = JSON.stringify(source), navigator = createLaneNavigator(); navigator.sync(source, 'document'); navigator.window(8);
    expect(navigator.search().items.length).to.be.at.most(16); expect(navigator.search().total).to.equal(count);
    navigator.jump(source.at(-1).id); expect(navigator.summary(source.at(-1).id).selected).to.equal(null);
    expect(navigator.summary(source[0].id).firstLane).to.equal(Math.max(0, count - 8));
    expect(navigator.search('lane-' + count).items.some(x => x.id === source.at(-1).id)).to.equal(true); expect(JSON.stringify(source)).to.equal(original);
  });
  it('anchors the same lane across insertion and reorder and finds its nearest survivor after deletion', () => {
    const source = lanes(64), navigator = createLaneNavigator(); navigator.sync(source, 1); navigator.window(8); navigator.jump('lane-30');
    navigator.sync([{ id: 'inserted', name: 'New' }, ...source], 1); expect(navigator.summary(null)).to.include({ firstVisibleId: 'lane-30', firstLane: 30 });
    const reordered = [source[29], ...source.filter(x => x.id !== 'lane-30')]; navigator.sync(reordered, 1); expect(navigator.summary(null)).to.include({ firstVisibleId: 'lane-30', firstLane: 0 });
    navigator.sync(source.filter(x => x.id !== 'lane-30'), 1); expect(navigator.summary(null).firstVisibleId).to.equal('lane-1');
    navigator.jump('lane-20'); navigator.sync(source.filter(x => !['lane-20', 'lane-30'].includes(x.id)), 1); expect(navigator.summary(null).firstVisibleId).to.equal('lane-21');
  });
  it('resets a document namespace instead of applying a reused ID to the new project', () => {
    const source = lanes(64), navigator = createLaneNavigator(); navigator.sync(source, 1); navigator.jump('lane-30'); navigator.sync([...source], 2);
    expect(navigator.summary(null)).to.include({ firstVisibleId: 'lane-1', firstLane: 0 });
  });
  it('accumulates tiny native deltas and handles direction, units, idle gaps and zoom gestures', () => {
    const navigator = createLaneNavigator(); navigator.sync(lanes(64), 1); navigator.window(8);
    for (let i = 0; i < 39; i++) expect(navigator.wheel({ deltaY: 1 }, 116, 1080, i)).to.equal(0);
    expect(navigator.wheel({ deltaY: 2 }, 116, 1080, 40)).to.equal(1);
    expect(navigator.wheel({ deltaY: -10 }, 116, 1080, 41)).to.equal(1); expect(navigator.wheel({ deltaY: -32 }, 116, 1080, 42)).to.equal(0);
    expect(navigator.wheel({ deltaY: 3, deltaMode: 1 }, 116, 1080, 43)).to.equal(1);
    expect(navigator.wheel({ deltaY: 1, deltaMode: 2 }, 116, 1080, 44)).to.equal(9);
    expect(navigator.wheel({ deltaY: 120, ctrlKey: true }, 116, 1080, 45)).to.equal(null);
    navigator.wheel({ deltaY: 30 }, 116, 1080, 1000); expect(navigator.wheel({ deltaY: 20 }, 116, 1080, 2000)).to.equal(9);
    expect(navigator.wheel({ deltaY: NaN }, 116, 1080, 2001)).to.equal(null);
  });
  it('reports exact offscreen solo/armed counts with selected/armed/solo jump priority', () => {
    const source = lanes(64); source[40].solo = source[41].solo = true; const navigator = createLaneNavigator(); navigator.sync(source, 1);
    expect(navigator.summary('lane-64', ['lane-1', 'lane-50', 'removed'])).to.include({ selected: 'lane-64', soloCount: 2, armedCount: 1, target: 'lane-64' });
    expect(navigator.summary('lane-1', ['lane-50']).target).to.equal('lane-50'); expect(navigator.summary('lane-1').target).to.equal('lane-41');
  });
  it('keeps duplicate/long names independent, bounds search/page inputs and rejects invalid identities', () => {
    const source = lanes(1024); source[0].name = source[63].name; source[1].name = 'X'.repeat(256); const navigator = createLaneNavigator(); navigator.sync(source, 1);
    expect(navigator.search('duplicate name').items.map(x => x.id)).to.deep.equal(['lane-1', 'lane-64']); expect(navigator.search('', Infinity).items).to.have.length(16);
    expect(navigator.search('', 100000).page).to.equal(63); expect(navigator.search('no such lane', -100).total).to.equal(0);
    expect(navigator.jump('removed')).to.equal(null); expect(() => navigator.sync([...source, source[0]], 1)).to.throw('admitted');
    expect(() => navigator.sync([source[0], source[0]], 1)).to.throw('unique'); navigator.dispose(); expect(navigator.search().total).to.equal(0); expect(navigator.jump('lane-1')).to.equal(null);
  });
});

describe('bounded lane navigator DOM ownership', () => {
  const setup = () => {
    const dom = new JSDOM('<body></body>'), { document } = dom.window, source = lanes(1024), navigator = createLaneNavigator(); navigator.sync(source, 1); let selected = 'lane-1', armed = [], identity = 1; const jumps = [];
    const view = createLaneNavigatorView({ document, navigator, getSelection: () => selected, getArmed: () => armed, onJump: id => { jumps.push(id); navigator.jump(id); selected = id; view.update(identity); } });
    document.body.append(view.element, view.breadcrumb); view.update(identity);
    return { dom, document, source, navigator, view, jumps, update: () => view.update(identity), select: id => { selected = id; }, arm: ids => { armed = ids; }, replace: () => { identity++; navigator.sync([...source], identity); view.update(identity); }, close: () => { view.dispose(); dom.window.close(); } };
  };
  it('retains focused keyed results and typed/caret/IME buffers through unrelated revisions', () => {
    const f = setup(); try {
      const input = f.document.querySelector('input'), first = f.document.querySelector('[data-jump-lane-id]'); first.focus(); f.update(); expect(f.document.activeElement).to.equal(first);
      input.focus(); input.value = 'duplicate'; input.setSelectionRange(3, 3); input.dispatchEvent(new f.dom.window.Event('input')); f.update(); expect(f.document.activeElement).to.equal(input); expect(input.selectionStart).to.equal(3); expect(f.document.querySelectorAll('[data-jump-lane-id]')).to.have.length(1);
      input.dispatchEvent(new f.dom.window.Event('compositionstart')); input.value = 'Lane 1024'; input.dispatchEvent(new f.dom.window.Event('input')); expect(f.document.querySelectorAll('[data-jump-lane-id]')).to.have.length(1);
      input.dispatchEvent(new f.dom.window.Event('compositionend')); expect(f.document.querySelector('[data-jump-lane-id]').dataset.jumpLaneId).to.equal('lane-1024');
      expect(f.jumps).to.deep.equal([]);
    } finally { f.close(); }
  });
  it('bounds mounted results through all match pages and falls back to search when a result disappears', () => {
    const f = setup(); try {
      for (let page = 0; page < 64; page++) { expect(f.document.querySelectorAll('[data-jump-lane-id]')).to.have.length(16); f.view.element.querySelectorAll(':scope > button')[1].click(); }
      const result = f.document.querySelector('[data-jump-lane-id]'); result.focus(); const input = f.document.querySelector('input'); input.value = 'no matching target'; input.dispatchEvent(new f.dom.window.Event('input')); expect(f.document.activeElement).to.equal(input); expect(f.document.querySelectorAll('[data-jump-lane-id]')).to.have.length(0);
    } finally { f.close(); }
  });
  it('keeps offscreen navigation reachable and fences retired controls and replacement query state', () => {
    const f = setup(); try {
      f.select('lane-64'); f.arm(['lane-63']); f.update(); expect(f.view.breadcrumb.hidden).to.equal(false); expect(f.view.breadcrumb.textContent).to.include('Armed 1'); expect(f.view.breadcrumb.getAttribute('aria-label')).to.include('Selected offscreen · Armed 1 offscreen'); f.view.breadcrumb.click(); expect(f.jumps).to.deep.equal(['lane-64']);
      const input = f.document.querySelector('input'), priorDocumentButton = f.document.querySelector('[data-jump-lane-id]'); input.value = 'old query'; priorDocumentButton.focus(); f.replace(); expect(input.value).to.equal(''); expect(f.document.activeElement).to.equal(input); priorDocumentButton.click(); expect(f.jumps).to.deep.equal(['lane-64']);
      const stale = f.document.querySelector('[data-jump-lane-id]'), breadcrumb = f.view.breadcrumb; f.view.dispose(); stale.click(); breadcrumb.click(); input.dispatchEvent(new f.dom.window.Event('input')); expect(f.jumps).to.deep.equal(['lane-64']);
    } finally { f.close(); }
  });
});
