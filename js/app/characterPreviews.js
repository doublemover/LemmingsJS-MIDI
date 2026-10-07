import { SpriteTypes } from '../lemmings/SpriteTypes.js';
import { CHARACTER_COLORS } from '../lemmings/characterColors.js';
import { stableCharacterIndex } from '../lemmings/CharacterSpriteSet.js';

const resolvePreviewColors = (preference, index) => {
  const appearance = { ...preference };
  for (const part of ['body', 'prop', 'eyewear']) {
    if (appearance[`${part}Color`] !== 'random') continue;
    const colors = CHARACTER_COLORS[part === 'body' ? 'body' : 'prop'];
    const offset = stableCharacterIndex(`${preference.seed}:${part}:offset`, colors.length);
    appearance[`${part}Color`] = colors[(index + offset) % colors.length].hex;
  }
  return appearance;
};

const updateCharacterPreviews = async ({ document, sprites, preference, isCurrent }) => {
  if (!sprites.skinForAppearance || !sprites.load) return;
  await Promise.all(sprites.shapes.map(async shape => {
    await sprites.load(shape);
    await sprites.loadAccessories(shape, true);
    await sprites.loadAccessories(shape);
  }));
  if (!isCurrent()) return;
  const selected = sprites.shapes.find(shape => shape.id === preference.shape) || sprites.shapes[0];
  if (!selected) return;
  for (const [field, part] of [['characterShape', 'shape'], ['characterAccessory', 'accessory'], ['characterEyewear', 'eyewear']]) {
    for (const [index, button] of Array.from(document.getElementById(`${field}Choices`)?.children || []).entries()) {
      if (button.dataset.value === 'mixed') continue;
      const appearance = resolvePreviewColors({ ...preference, shape: selected.id, [part]: button.dataset.value }, index);
      const frame = sprites.skinForAppearance(appearance).getAnimation(SpriteTypes.WALKING, true)?.getFrame(0);
      if (!frame) continue;
      let preview = Array.from(button.children).find(child => child.tagName === 'CANVAS');
      if (!preview) {
        preview = document.createElement('canvas');
        if (!preview.getContext) return;
        preview.setAttribute('aria-hidden', 'true');
        while (button.firstChild) button.removeChild(button.firstChild);
        button.appendChild(preview);
      }
      preview.width = frame.width; preview.height = frame.height;
      const context = preview.getContext('2d'), pixels = context.createImageData(frame.width, frame.height);
      pixels.data.set(frame.getData());
      const mask = frame.getMask();
      for (let i = 0; i < mask.length; i++) if (!mask[i]) pixels.data[i * 4 + 3] = 0;
      context.putImageData(pixels, 0, 0);
      preview.dataset.appearance = JSON.stringify(appearance);
    }
  }
};

export { resolvePreviewColors, updateCharacterPreviews };
