import { expect } from 'chai';
import { EditorPreviewCache } from '../../js/app/editorPreviewCache.js';

class FakeStorage {
  constructor() {
    this._map = new Map();
  }

  get length() {
    return this._map.size;
  }

  key(index) {
    return Array.from(this._map.keys())[index] ?? null;
  }

  getItem(key) {
    return this._map.has(key) ? this._map.get(key) : null;
  }

  setItem(key, value) {
    this._map.set(key, String(value));
  }

  removeItem(key) {
    this._map.delete(key);
  }
}

const buildPalette = () => ({
  getColor(index) {
    const colors = [
      0xff101010,
      0xff202020,
      0xff303030,
      0xff404040
    ];
    return colors[index % colors.length] >>> 0;
  }
});

const buildImage = (pixels) => ({
  width: 2,
  height: 2,
  frames: [Uint8Array.from(pixels)],
  palette: buildPalette()
});

const createCanvasDocument = () => {
  let renderCount = 0;
  return {
    get renderCount() {
      return renderCount;
    },
    createElement(tag) {
      if (tag !== 'canvas') {
        throw new Error(`Unexpected element: ${tag}`);
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            createImageData(width, height) {
              return { data: new Uint8ClampedArray(width * height * 4) };
            },
            putImageData() {}
          };
        },
        toDataURL() {
          renderCount += 1;
          return `data:image/png;base64,preview-${renderCount}`;
        }
      };
    }
  };
};

describe('EditorPreviewCache', () => {
  it('reuses generated previews from memory/storage', () => {
    const document = createCanvasDocument();
    const storage = new FakeStorage();
    const cache = new EditorPreviewCache({ document, storage });
    const image = buildImage([0, 1, 2, 3]);

    const first = cache.getPreviewUrl({ type: 'terrain', id: 1, image });
    const second = cache.getPreviewUrl({ type: 'terrain', id: 1, image });
    expect(first).to.be.a('string');
    expect(second).to.equal(first);
    expect(document.renderCount).to.equal(1);
  });

  it('enforces memory LRU size without losing persisted previews', () => {
    const document = createCanvasDocument();
    const storage = new FakeStorage();
    const cache = new EditorPreviewCache({
      document,
      storage,
      maxMemoryEntries: 1
    });

    const imageA = buildImage([0, 1, 2, 3]);
    const imageB = buildImage([1, 2, 3, 0]);
    const urlA = cache.getPreviewUrl({ type: 'terrain', id: 1, image: imageA });
    const urlB = cache.getPreviewUrl({ type: 'terrain', id: 2, image: imageB });
    expect(urlA).to.not.equal(urlB);
    expect(cache.memory.size).to.equal(1);

    const urlAFromStorage = cache.getPreviewUrl({ type: 'terrain', id: 1, image: imageA });
    expect(urlAFromStorage).to.equal(urlA);
    expect(document.renderCount).to.equal(2);
  });

  it('invalidates stale type/id entries during style reloads', () => {
    const document = createCanvasDocument();
    const storage = new FakeStorage();
    const cache = new EditorPreviewCache({ document, storage });
    const imageA = buildImage([0, 1, 2, 3]);
    const imageB = buildImage([1, 2, 3, 0]);

    cache.getPreviewUrl({ type: 'terrain', id: 1, image: imageA });
    cache.getPreviewUrl({ type: 'terrain', id: 2, image: imageB });
    expect(document.renderCount).to.equal(2);

    cache.invalidateTypeIds('terrain', [1]);
    const terrainKeys = [];
    for (let i = 0; i < storage.length; i += 1) {
      terrainKeys.push(storage.key(i));
    }
    expect(terrainKeys.some(key => key.includes(':terrain:2:'))).to.equal(false);

    cache.getPreviewUrl({ type: 'terrain', id: 2, image: imageB });
    expect(document.renderCount).to.equal(3);
  });
});
