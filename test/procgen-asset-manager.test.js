import { expect } from 'chai';
import { ProcgenAssetManager } from '../js/app/procgenAssetManager.js';

describe('ProcgenAssetManager', function () {
  it('selects pieces using constraint filtering without building temp arrays', function () {
    const manager = new ProcgenAssetManager({ random: () => 0 });
    const pieces = [
      { id: 'wide', bounds: { width: 12, height: 3 } },
      { id: 'tall', bounds: { width: 4, height: 8 } },
      { id: 'small', bounds: { width: 3, height: 3 } }
    ];

    const selected = manager._pickFromList(pieces, 5, 5, 3);

    expect(selected.id).to.equal('tall');
  });

  it('falls back to the source list when no constrained candidates match', function () {
    const manager = new ProcgenAssetManager({ random: () => 0.8 });
    const pieces = [
      { id: 'a', bounds: { width: 6, height: 2 } },
      { id: 'b', bounds: { width: 7, height: 2 } }
    ];

    const selected = manager._pickFromList(pieces, 3, 9, 3);

    expect(['a', 'b']).to.include(selected.id);
  });

  it('tags catalog pieces with the selected theme contract', function () {
    const manager = new ProcgenAssetManager({ styleName: 'crystal' });
    manager._buildTerrainCatalog({
      styleName: 'crystal',
      groundSet: 4,
      terrainImages: [
        {
          width: 2,
          height: 2,
          frames: [new Uint8Array([
            1, 1,
            1, 0x80
          ])]
        }
      ]
    });
    manager.groundSet = 4;

    expect(manager.terrainPieces).to.have.length(1);
    expect(manager.terrainPieces[0]).to.include({
      id: 0,
      styleName: 'crystal',
      theme: 'crystal',
      groundSet: 4
    });
    expect(manager.getThemeSummary()).to.include({
      selectedTheme: 'crystal',
      groundSet: 4,
      terrainPieceCount: 1
    });
  });
});
