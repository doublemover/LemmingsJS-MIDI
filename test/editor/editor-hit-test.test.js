import { expect } from 'chai';
import {
  getEntryBounds,
  hitTestBounds,
  hitTestEntry,
  findEntryAt
} from '../../js/editor/EditorHitTest.js';

describe('EditorHitTest', () => {
  it('computes bounds with fallbacks', () => {
    const entry = { props: { X: 10, Y: 20 } };
    const meta = { width: 12, height: 14 };
    const bounds = getEntryBounds(entry, meta);
    expect(bounds).to.deep.equal({ x: 10, y: 20, width: 12, height: 14 });

    const boundsFromProps = getEntryBounds({ props: { X: 1, Y: 2, WIDTH: 5, HEIGHT: 6 } }, meta);
    expect(boundsFromProps).to.deep.equal({ x: 1, y: 2, width: 5, height: 6 });

    const boundsFromOptions = getEntryBounds({ props: { X: 0, Y: 0 } }, {}, { widthFallback: 3, heightFallback: 4 });
    expect(boundsFromOptions).to.deep.equal({ x: 0, y: 0, width: 3, height: 4 });

    const boundsFromNull = getEntryBounds(null);
    expect(boundsFromNull).to.deep.equal({ x: 0, y: 0, width: 8, height: 8 });
  });

  it('tests bounds hits', () => {
    const bounds = { x: 5, y: 5, width: 10, height: 10 };
    expect(hitTestBounds(bounds, 6, 6)).to.equal(true);
    expect(hitTestBounds(bounds, 20, 20)).to.equal(false);
    expect(hitTestBounds(null, 0, 0)).to.equal(false);
  });

  it('tests entries and finds the topmost hit', () => {
    const entries = [
      { props: { X: 0, Y: 0, WIDTH: 8, HEIGHT: 8, PIECE: 1 } },
      { props: { X: 2, Y: 2, WIDTH: 8, HEIGHT: 8, PIECE: 2 } }
    ];
    const metaById = new Map([
      [1, { width: 8, height: 8 }],
      [2, { width: 8, height: 8 }]
    ]);
    const hitEntry = hitTestEntry(entries[0], metaById.get(1), 3, 3);
    expect(hitEntry).to.equal(true);

    const hit = findEntryAt(entries, metaById, 3, 3);
    expect(hit.index).to.equal(1);
    expect(hit.bounds.width).to.equal(8);

    expect(findEntryAt([], metaById, 0, 0)).to.equal(null);
    expect(findEntryAt(null, metaById, 0, 0)).to.equal(null);

    const sparseEntries = [null, {}, { props: { X: 0, Y: 0, WIDTH: 2, HEIGHT: 2, PIECE: 99 } }];
    const hitNoMeta = findEntryAt(sparseEntries, new Map(), 1, 1);
    expect(hitNoMeta.index).to.equal(2);

    const miss = findEntryAt(sparseEntries, new Map(), 99, 99);
    expect(miss).to.equal(null);
  });
});
