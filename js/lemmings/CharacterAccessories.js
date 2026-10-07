const CHARACTER_ACCESSORIES = Object.freeze({
  ears: Object.freeze([{ id: 'headphones', label: 'Headphones' }]),
  neck: Object.freeze([{ id: 'bow', label: 'Bow tie' }]),
  eyewear: Object.freeze([
    { id: 'monocle', label: 'Monocle' },
    { id: 'tall_oval_frames', label: 'Tall oval frames' },
    { id: 'separate_trapezoid_lenses', label: 'Separate trapezoid lenses' },
    { id: 'classic_sunglasses', label: 'Classic sunglasses' },
    { id: 'round_sunglasses', label: 'Round sunglasses' }
  ])
});
const ACCESSORY_SLOTS = Object.freeze(Object.keys(CHARACTER_ACCESSORIES));
const validColor = color => /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : null;

function normalizeCharacterAccessories(next) {
  const accessories = {}, accessoryColors = {};
  for (const slot of ACCESSORY_SLOTS) {
    const selected = next?.accessories?.[slot];
    if (CHARACTER_ACCESSORIES[slot].some(item => item.id === selected)) accessories[slot] = selected;
    const color = validColor(next?.accessoryColors?.[slot]);
    if (color) accessoryColors[slot] = color;
  }
  return {
    ...(Object.keys(accessories).length ? { accessories: Object.freeze(accessories) } : {}),
    ...(Object.keys(accessoryColors).length ? { accessoryColors: Object.freeze(accessoryColors) } : {})
  };
}

const characterAppearanceKey = appearance => JSON.stringify([
  appearance.shape, appearance.bodyColor ?? null, appearance.propColor ?? null,
  ...ACCESSORY_SLOTS.flatMap(slot => [appearance.accessories?.[slot] ?? null, appearance.accessoryColors?.[slot] ?? null])
]);
const hasCharacterAccessories = appearance => ACCESSORY_SLOTS.some(slot => appearance.accessories?.[slot]);

function validateAccessoryLayers(pack, manifest, shapeId) {
  const fail = reason => { throw new Error(`Invalid character accessories: ${reason}`); };
  if (pack?.format !== 'hydro-accessory-layers-v1' || pack.shapeId !== shapeId) fail('format or body');
  if (!Array.isArray(pack.patches) || pack.patches.length > 4096 || pack.patches[0] !== null) fail('patch collection');
  for (const patch of pack.patches.slice(1)) {
    if (!Array.isArray(patch) || patch.length !== 3) fail('patch');
    const [x, y, rows] = patch;
    if (![x, y].every(value => Number.isInteger(value) && value >= 0) || !Array.isArray(rows) ||
        !rows.length || rows.length > 40 || !rows[0]?.length || rows[0].length > 32 ||
        rows.some(row => typeof row !== 'string' || row.length !== rows[0].length || /[^.pdh]/.test(row))) fail('patch pixels');
  }
  const check = (record, source) => {
    if (!record || !source) fail('missing animation');
    for (const items of Object.values(CHARACTER_ACCESSORIES)) for (const item of items) {
      const indices = record.items?.[item.id];
      if (!Array.isArray(indices) || indices.length !== source.frameCount) fail('frame count');
      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= pack.patches.length) fail('patch reference');
        const patch = pack.patches[index];
        if (patch && (patch[0] + patch[2][0].length > source.width || patch[1] + patch[2].length > source.height)) fail('patch bounds');
      }
    }
  };
  if (!Array.isArray(pack.animations) || pack.animations.length !== manifest.animations.length) fail('animation collection');
  manifest.animations.forEach((source, index) => {
    const record = pack.animations[index];
    if (!record || record.state !== source.state || record.direction !== source.direction) fail('animation identity');
    check(record, source);
  });
  const landing = manifest.cosmetics?.beretLanding;
  if (!landing || !Array.isArray(pack.landing) || pack.landing.length !== landing.variants.length) fail('landing collection');
  landing.variants.forEach((source, index) => {
    const record = pack.landing[index];
    if (!record || record.direction !== source.direction || record.startSway !== source.startSway) fail('landing identity');
    check(record, landing);
  });
  return pack;
}

function composeCharacterAccessories(manifest, pack, appearance) {
  if (!hasCharacterAccessories(appearance)) return manifest;
  const palette = manifest.palette.map(color => [...color]);
  const slots = {};
  let symbols = manifest.symbols;
  const append = rgba => {
    const symbol = 'BCDEF'[palette.length - manifest.palette.length];
    symbols += symbol; palette.push(rgba); return symbol;
  };
  for (const slot of ACCESSORY_SLOTS) {
    const hex = validColor(appearance.accessoryColors?.[slot]) || '#ff813d';
    slots[slot] = append([...[1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)), 255]);
  }
  const dark = append([32, 34, 40, 255]), highlight = append([177, 197, 211, 255]);
  const compose = (frames, items) => frames.map((rows, frame) => {
    const result = rows.map(row => [...row]);
    for (const slot of ACCESSORY_SLOTS) {
      const selected = appearance.accessories?.[slot];
      if (!selected) continue;
      const patch = pack.patches[items[selected][frame]];
      if (!patch) continue;
      const [left, top, pixels] = patch;
      pixels.forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol !== '.') result[top + y][left + x] = symbol === 'p' ? slots[slot] : symbol === 'd' ? dark : highlight;
      }));
    }
    return result.map(row => row.join(''));
  });
  const landing = manifest.cosmetics.beretLanding;
  return { ...manifest, palette, symbols,
    animations: manifest.animations.map((record, index) => ({ ...record, frames: compose(record.frames, pack.animations[index].items) })),
    cosmetics: { ...manifest.cosmetics, beretLanding: { ...landing,
      variants: landing.variants.map((record, index) => ({ ...record, frames: compose(record.frames, pack.landing[index].items) }))
    } }
  };
}

export { CHARACTER_ACCESSORIES, ACCESSORY_SLOTS, normalizeCharacterAccessories, characterAppearanceKey,
  hasCharacterAccessories, validateAccessoryLayers, composeCharacterAccessories };
