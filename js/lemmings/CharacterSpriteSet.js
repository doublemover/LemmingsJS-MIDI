import { PixelSpriteSkin, validateSkin } from './PixelSpriteSkin.js';
import { Frame } from '../render/Frame.js';
import { refineCharacterPresentation } from './CharacterPresentation.js';
import { CHARACTER_COLORS } from './characterColors.js';
import { normalizeCharacterAccessories, characterAppearanceKey, hasCharacterAccessories, hasCustomHeadwear, validateAccessoryLayers, composeCharacterAccessories } from './CharacterAccessories.js';

const CHARACTER_STORAGE_KEY = 'lemmings.character.appearance.v1';
const DEFAULT_CHARACTER_COLORS = Object.freeze({ bodyColor: '#4778ff', propColor: '#ff8066', eyewearColor: '#1f1f1f' });
let preference = Object.freeze({ shape: 'mixed', seed: 0, ...DEFAULT_CHARACTER_COLORS });
const validColor = (color, part) => color === 'random' ? color
  : (CHARACTER_COLORS[part === 'body' ? 'body' : 'prop'].find(entry => entry.hex === String(color).toLowerCase())?.hex || null);
const normalizePreference = (next, seed = 0) => {
  const eyewearColor = validColor(next?.eyewearColor, 'eyewear');
  return Object.freeze({
    shape: typeof next?.shape === 'string' ? next.shape : 'mixed',
    seed: Number.isSafeInteger(next?.seed) ? next.seed : seed,
    bodyColor: validColor(next?.bodyColor, 'body'), propColor: validColor(next?.propColor, 'prop'),
    ...normalizeCharacterAccessories({ ...next, eyewearColor: null }),
    ...(eyewearColor ? { eyewearColor } : {})
  });
};
const setCharacterPreference = next => {
  preference = normalizePreference(next, preference.seed);
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

const blankFrame = new Frame(1, 1);
blankFrame.getData().fill(0);
blankFrame.enableSpanCache();
const blankAnimation = Object.freeze({ getFrame: () => blankFrame, frames: [blankFrame], frameCount: 1 });
const loadingSkin = Object.freeze({ getAnimation: () => blankAnimation });
const hasRandomColors = settings => ['bodyColor', 'propColor', 'eyewearColor'].some(part => settings[part] === 'random');
const seededId = (id, seed, part = '') => seed || part ? `${seed}:${part}:${id ?? 0}` : id;
const appearanceIndex = (id, length, settings, part = '', index = null) => {
  if (!Number.isSafeInteger(index) || index < 0) return stableCharacterIndex(seededId(id, settings.seed, part), length);
  const offset = stableCharacterIndex(`${settings.seed}:${part}:offset`, length);
  return (index % length + offset) % length;
};
const resolvedAppearance = (settings, shape, id, index = null) => {
  const appearance = { ...settings, shape };
  for (const part of ['body', 'prop', 'eyewear']) {
    if (settings[`${part}Color`] !== 'random') continue;
    const colors = CHARACTER_COLORS[part === 'body' ? 'body' : 'prop'];
    appearance[`${part}Color`] = colors[appearanceIndex(id, colors.length, settings, part, index)].hex;
  }
  return appearance;
};
const paletteForAppearance = (manifest, appearance) => {
  const palette = recolorManifest(manifest, appearance).palette;
  if (palette.length === 16) {
    for (const [slot, hex] of [[11, appearance.propColor], [12, appearance.propColor], [13, appearance.eyewearColor]]) {
      if (hex) palette[slot] = [...[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)), 255];
    }
  }
  return palette;
};

class CharacterSpriteSet {
  constructor(base, catalog, loadText, getPreference = getCharacterPreference) {
    this.base = base;
    this.shapes = (catalog?.shapes || []).filter(shape => typeof shape.id === 'string' && typeof shape.path === 'string');
    this.loadText = loadText;
    this.getPreference = getPreference;
    this.manifests = new Map();
    this.accessoryLayers = new Map();
    this.headwearLayers = new Map();
    this.skins = new Map();
    this.pending = new Map();
    this.paletteSkins = new Map();
    this.actorSkins = new WeakMap();
    this.skinManifests = new WeakMap();
    this.generation = 0;
    this.error = null;
    this.activePreference = null;
    this.activeSkins = [];
    this.activeTemplates = [];
  }

  getAnimation(state, right) { return this.skinForActor({ id: 0 }).getAnimation(state, right); }
  get colorPalette() { return this.base.colorPalette; }
  get lemmingAnimation() { return this.base.lemmingAnimation; }

  appearanceForId(id) { return this.appearanceForActor({ id }); }

  appearanceForActor(actor) {
    const settings = this.activePreference || normalizePreference(this.getPreference());
    const selected = settings.shape === 'mixed' ? this.shapes[appearanceIndex(actor?.id, this.shapes.length, settings, '', actor?.appearanceIndex)]
      : this.shapes.find(shape => shape.id === settings.shape);
    return resolvedAppearance(settings, selected?.id || settings.shape, actor?.id, actor?.appearanceIndex);
  }

  async prepare() {
    const requested = this.getPreference();
    const settings = normalizePreference(requested);
    const generation = ++this.generation;
    const current = () => generation === this.generation && this.getPreference() === requested;
    const shapes = settings.shape === 'mixed' ? this.shapes : this.shapes.filter(shape => shape.id === settings.shape);
    this.error = null;
    try {
      if (settings.shape !== 'classic' && !shapes.length) throw new Error(this.catalogError || `Character art unavailable for ${settings.shape}`);
      await Promise.all(shapes.map(shape => this.load(shape)));
      if (!current()) return true;
      if (hasCustomHeadwear(settings)) await Promise.all(shapes.map(shape => this.loadAccessories(shape, true)));
      else if (hasCharacterAccessories(settings)) await Promise.all(shapes.map(shape => this.loadAccessories(shape)));
      if (!current()) return true;
      const templates = shapes.map(shape => this.templateForAppearance({ ...settings, shape: shape.id }));
      const decoded = templates.map(template => hasRandomColors(settings) ? template : this.colorSkin(template, settings));
      if (current()) {
        this.activePreference = settings; this.activeTemplates = templates; this.activeSkins = decoded;
        this.actorSkins = new WeakMap();
        for (const [key, entry] of this.paletteSkins) if (!templates.includes(entry.template)) this.paletteSkins.delete(key);
      }
      return true;
    } catch (error) {
      if (current()) this.error = error.message;
      return false;
    }
  }

  load(shape) {
    if (this.manifests.has(shape.id)) return Promise.resolve(this.manifests.get(shape.id));
    if (!this.pending.has(shape.id)) {
      const pending = Promise.resolve().then(() => this.loadText(shape.path)).then(text => {
        const manifest = JSON.parse(text);
        // Validate before admitting it to the cache.
        validateSkin(manifest);
        const refined = refineCharacterPresentation(manifest, manifest, shape.id);
        const skin = new PixelSpriteSkin(refined);
        this.manifests.set(shape.id, manifest);
        this.skins.set(characterAppearanceKey({ shape: shape.id }), skin);
        this.skinManifests.set(skin, refined);
        return manifest;
      }).finally(() => this.pending.delete(shape.id));
      this.pending.set(shape.id, pending);
    }
    return this.pending.get(shape.id);
  }

  loadAccessories(shape, headwear = false) {
    const cache = headwear ? this.headwearLayers : this.accessoryLayers;
    if (cache.has(shape.id)) return Promise.resolve(cache.get(shape.id));
    const key = `${headwear ? 'headwear' : 'accessories'}:${shape.id}`;
    if (!this.pending.has(key)) {
      const pending = Promise.resolve().then(() => {
        const path = headwear ? shape.headwearPath : shape.accessoriesPath;
        if (!path) throw new Error(`Accessory art unavailable for ${shape.id}`);
        return this.loadText(path);
      }).then(text => {
        const pack = JSON.parse(text);
        if (headwear) {
          validateSkin(pack.bare);
          if (pack.bare.shapeId !== shape.id) throw new Error('Invalid character accessories: bare body identity');
        }
        validateAccessoryLayers(pack, headwear ? pack.bare : this.manifests.get(shape.id), shape.id, headwear);
        cache.set(shape.id, pack);
        return pack;
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return this.pending.get(key);
  }

  templateForAppearance(appearance) {
    const plain = { shape: appearance.shape, accessory: appearance.accessory, eyewear: appearance.eyewear };
    const key = characterAppearanceKey(plain);
    if (this.skins.has(key)) return this.skins.get(key);
    const manifest = this.manifests.get(appearance.shape);
    if (!manifest) throw new Error(`Character art unavailable for ${appearance.shape}`);
    const headwear = hasCustomHeadwear(plain);
    const pack = (headwear ? this.headwearLayers : this.accessoryLayers).get(appearance.shape);
    if ((hasCharacterAccessories(plain) || headwear) && !pack) throw new Error(`Accessory art unavailable for ${appearance.shape}`);
    const composed = composeCharacterAccessories(headwear ? pack.bare : manifest, pack, plain);
    const refined = refineCharacterPresentation(composed, manifest, appearance.shape, pack, plain);
    const skin = new PixelSpriteSkin(refined);
    while (this.skins.size >= Math.max(32, this.shapes.length * 2)) this.skins.delete(this.skins.keys().next().value);
    this.skins.set(key, skin);
    this.skinManifests.set(skin, refined);
    return skin;
  }

  colorSkin(template, appearance) {
    const colors = [appearance.bodyColor, appearance.propColor, appearance.eyewearColor];
    if (!colors.some(Boolean)) return template;
    const manifest = this.skinManifests.get(template);
    const key = characterAppearanceKey({ ...appearance, shape: manifest.shapeId });
    const cached = this.paletteSkins.get(key);
    if (cached?.template === template) return cached.skin;
    const skin = template.withPalette(paletteForAppearance(manifest, appearance));
    while (this.paletteSkins.size >= 256) this.paletteSkins.delete(this.paletteSkins.keys().next().value);
    this.paletteSkins.set(key, { template, skin });
    return skin;
  }

  skinForAppearance(appearance) {
    if (appearance.shape === 'classic') return this.base;
    return this.colorSkin(this.templateForAppearance(appearance), appearance);
  }

  skinForActor(lem) {
    const settings = this.activePreference;
    if (!settings) return this.getPreference()?.shape === 'classic' ? this.base : loadingSkin;
    if (settings.shape === 'classic') return this.base;
    const index = settings.shape === 'mixed' ? appearanceIndex(lem?.id, this.activeSkins.length, settings, '', lem?.appearanceIndex) : 0;
    if (!hasRandomColors(settings)) return this.activeSkins[index];
    const cached = this.actorSkins.get(lem);
    if (cached && cached.id === lem.id && cached.index === lem.appearanceIndex) return cached.skin;
    const skin = this.colorSkin(this.activeTemplates[index], this.appearanceForActor(lem));
    if (lem && typeof lem === 'object') this.actorSkins.set(lem, { id: lem.id, index: lem.appearanceIndex, skin });
    return skin;
  }
  getActorAnimation(state, right, lem) { return this.skinForActor(lem).getAnimation(state, right); }
  getActorParticleParts(lem) {
    const skin = this.skinForActor(lem);
    return skin === this.base ? null : skin.getParticleParts?.(lem.lookRight) || null;
  }
  resetActor(lem) {
    this.actorSkins.get(lem)?.skin.resetActor?.(lem);
    this.actorSkins.delete(lem);
    const skins = new Set([...this.skins.values(), ...this.activeSkins, ...this.paletteSkins.values()].map(entry => entry.skin || entry));
    for (const skin of skins) skin.resetActor?.(lem);
    this.base.resetActor?.(lem);
  }
  onActionChange(lem, previousAction, previousFrameIndex) {
    const skin = this.skinForActor(lem);
    if (skin === this.base) { skin.onActionChange?.(lem, previousAction, previousFrameIndex); return; }
    const previous = previousAction && { spriteProvider: previousAction.spriteProvider === this ? skin : previousAction.spriteProvider,
      getActionName: () => previousAction.getActionName?.() };
    skin.onActionChange?.(lem, previous, previousFrameIndex);
  }
  drawCosmeticTransition(display, lem) { return this.skinForActor(lem).drawCosmeticTransition?.(display, lem) || false; }
}

export { CharacterSpriteSet, CHARACTER_STORAGE_KEY, getCharacterPreference, setCharacterPreference, stableCharacterIndex, recolorManifest, DEFAULT_CHARACTER_COLORS };
