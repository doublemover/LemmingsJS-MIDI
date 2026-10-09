// Procgen orientation is prepared from the selected source images. Authored
// MapObject images and their shared caches remain untouched.
const orientedImages = new WeakMap();
const procgenObjectImage = object => {
  const image = object.piece.image, flip = !!object.flip, flipY = !!object.flipY;
  if (!flip && !flipY) return image;
  let variants = orientedImages.get(image);
  if (!variants) { variants = new Array(4); orientedImages.set(image, variants); }
  const key = Number(flip) + 2 * Number(flipY);
  if (!variants[key]) {
    const { width, height } = image;
    const frames = image.frames.map(frame => {
      const pixels = new Uint8Array(frame.length);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
        pixels[y * width + x] = frame[(flipY ? height - 1 - y : y) * width + (flip ? width - 1 - x : x)];
      return pixels;
    });
    variants[key] = { ...image, frames,
      trigger_left: flip ? width - image.trigger_left - image.trigger_width : image.trigger_left,
      trigger_top: flipY ? height - image.trigger_top - image.trigger_height : image.trigger_top };
  }
  return variants[key];
};
export { procgenObjectImage };
