import { PixelSpriteSkin } from './PixelSpriteSkin.js';

const CHARACTER_STORAGE_KEY = 'lemmings.character.appearance.v1';
let preference = Object.freeze({ shape: 'classic', bodyColor: null, propColor: null });
const validColor = color => /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : null;

const setCharacterPreference = next => {
  preference = Object.freeze({
    shape: typeof next?.shape === 'string' ? next.shape : 'classic',
    bodyColor: validColor(next?.bodyColor), propColor: validColor(next?.propColor)
  });
  return preference;
};
const getCharacterPreference = () => preference;
const stableCharacterIndex = (id, length) => {
  if (Number.isSafeInteger(id)) {
    let hash = Math.imul((id >>> 0) ^ Math.floor(id / 4294967296), 0x45d9f3b);
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
    return ((hash ^ (hash >>> 16)) >>> 0) % Math.max(1, length);
  }
  let hash = 2166136261;
  for (const ch of String(id ?? 0)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  return (hash >>> 0) % Math.max(1, length);
};

const recolorManifest = (manifest, { bodyColor, propColor }) => {
  const palette = manifest.palette.map(color => [...color]);
  const swap = (hex, slots, base) => {
    if (!hex) return;
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    for (const slot of slots) for (let component = 0; component < 3; component += 1) {
      const old = manifest.palette[slot][component], anchor = manifest.palette[base][component];
      palette[slot][component] = Math.round(old <= anchor ? rgb[component] * old / Math.max(1, anchor)
        : rgb[component] + (255 - rgb[component]) * (old - anchor) / Math.max(1, 255 - anchor));
    }
  };
  swap(bodyColor, [2, 3, 4], 3); swap(propColor, [6, 7, 8], 7);
  return { ...manifest, palette };
};

class CharacterSpriteSet {
  constructor(base, catalog, loadText, getPreference = getCharacterPreference) {
    this.base = base;
    this.shapes = (catalog?.shapes || []).filter(shape => typeof shape.id === 'string' && typeof shape.path === 'string');
    this.loadText = loadText;
    this.getPreference = getPreference;
    this.manifests = new Map();
    this.skins = new Map();
    this.pending = new Map();
    this.error = null;
    this.activePreference = null;
    this.activeSkins = [];
  }

  getAnimation(state, right) { return this.base.getAnimation(state, right); }
  get colorPalette() { return this.base.colorPalette; }
  get lemmingAnimation() { return this.base.lemmingAnimation; }

  appearanceForId(id) {
    const settings = this.getPreference();
    const selected = settings.shape === 'mixed' ? this.shapes[stableCharacterIndex(id, this.shapes.length)]
      : this.shapes.find(shape => shape.id === settings.shape);
    return selected ? { ...settings, shape: selected.id } : { shape: 'classic', bodyColor: null, propColor: null };
  }

  async prepare() {
    const settings = this.getPreference();
    const shapes = settings.shape === 'mixed' ? this.shapes : this.shapes.filter(shape => shape.id === settings.shape);
    this.error = null;
    try {
      await Promise.all(shapes.map(shape => this.load(shape)));
      // Decode the requested variants outside the render loop.
      const decoded = shapes.map(shape => this.skinForAppearance({ ...settings, shape: shape.id }));
      if (this.getPreference() === settings) { this.activePreference = settings; this.activeSkins = decoded; }
      return true;
    } catch (error) { this.error = error.message; return false; }
  }

  load(shape) {
    if (this.manifests.has(shape.id)) return Promise.resolve(this.manifests.get(shape.id));
    if (!this.pending.has(shape.id)) {
      const pending = Promise.resolve().then(() => this.loadText(shape.path)).then(text => {
        const manifest = JSON.parse(text);
        // Validate before admitting it to the cache.
        const skin = new PixelSpriteSkin(manifest);
        this.manifests.set(shape.id, manifest);
        this.skins.set(JSON.stringify([shape.id, null, null]), skin);
        return manifest;
      }).finally(() => this.pending.delete(shape.id));
      this.pending.set(shape.id, pending);
    }
    return this.pending.get(shape.id);
  }

  skinForAppearance(appearance) {
    if (appearance.shape === 'classic') return this.base;
    const key = JSON.stringify([appearance.shape, appearance.bodyColor, appearance.propColor]);
    if (this.skins.has(key)) return this.skins.get(key);
    const manifest = this.manifests.get(appearance.shape);
    if (!manifest) return this.base;
    const skin = new PixelSpriteSkin(recolorManifest(manifest, appearance));
    // One active collection plus a small edit working set. Actor identities are never cached.
    while (this.skins.size >= Math.max(32, this.shapes.length * 2)) this.skins.delete(this.skins.keys().next().value);
    this.skins.set(key, skin);
    return skin;
  }

  skinForActor(lem) {
    const settings = this.getPreference();
    if (settings.shape === 'classic' || settings !== this.activePreference || !this.activeSkins.length) return this.base;
    return this.activeSkins[settings.shape === 'mixed' ? stableCharacterIndex(lem?.id, this.activeSkins.length) : 0];
  }
  getActorAnimation(state, right, lem) { return this.skinForActor(lem).getAnimation(state, right); }
  resetActor(lem) { for (const skin of this.skins.values()) skin.resetActor?.(lem); this.base.resetActor?.(lem); }
  onActionChange(lem, previousAction, previousFrameIndex) {
    const skin = this.skinForActor(lem);
    if (skin === this.base) { skin.onActionChange?.(lem, previousAction, previousFrameIndex); return; }
    const previous = previousAction && { spriteProvider: previousAction.spriteProvider === this ? skin : previousAction.spriteProvider,
      getActionName: () => previousAction.getActionName?.() };
    skin.onActionChange?.(lem, previous, previousFrameIndex);
  }
  drawCosmeticTransition(display, lem) { return this.skinForActor(lem).drawCosmeticTransition?.(display, lem) || false; }
}

export { CharacterSpriteSet, CHARACTER_STORAGE_KEY, getCharacterPreference, setCharacterPreference, stableCharacterIndex, recolorManifest };
