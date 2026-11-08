const heightOverrides = new WeakMap();
const restoreHeight = element => {
  const previous = heightOverrides.get(element); if (!previous) return;
  for (const key of ['maxHeight', 'overflowY']) if (element.style[key] === previous.applied[key]) element.style[key] = previous.original[key];
  heightOverrides.delete(element);
};
export function placeAnchoredControl({ element, anchor, window, margin = 12, preferAbove = false }) {
  restoreHeight(element); element.style.left = '0px'; element.style.top = '0px';
  const reference = anchor.getBoundingClientRect(); let origin = element.getBoundingClientRect();
  const width = Number(window?.innerWidth) || element.ownerDocument?.documentElement?.clientWidth || 1920;
  const height = Number(window?.innerHeight) || element.ownerDocument?.documentElement?.clientHeight || 1080;
  const scaleX = element.offsetWidth > 0 && origin.width > 0 ? origin.width / element.offsetWidth : 1;
  const scaleY = element.offsetHeight > 0 && origin.height > 0 ? origin.height / element.offsetHeight : 1;
  const below = reference.bottom + 6, aboveRoom = Math.max(0, reference.top - 6 - margin), belowRoom = Math.max(0, height - margin - below);
  const above = preferAbove ? origin.height <= aboveRoom || origin.height > belowRoom && aboveRoom > belowRoom : origin.height > belowRoom && (origin.height <= aboveRoom || aboveRoom > belowRoom);
  const available = above ? aboveRoom : belowRoom;
  if (origin.height > available) {
    const computed = window?.getComputedStyle?.(element), extra = computed?.boxSizing === 'content-box' ? ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(computed[key]) || 0), 0) : 0;
    const original = { maxHeight: element.style.maxHeight, overflowY: element.style.overflowY };
    element.style.maxHeight = Math.max(0, available / scaleY - extra) + 'px'; element.style.overflowY = 'auto';
    heightOverrides.set(element, { original, applied: { maxHeight: element.style.maxHeight, overflowY: element.style.overflowY } });
    origin = element.getBoundingClientRect();
  }
  const left = Math.max(margin, Math.min(reference.left, width - origin.width - margin)), top = above ? reference.top - origin.height - 6 : below;
  element.style.left = (left - origin.left) / scaleX + 'px'; element.style.top = (top - origin.top) / scaleY + 'px';
  return Object.freeze({ left, top, width: origin.width, height: origin.height, scaleX, scaleY });
}
