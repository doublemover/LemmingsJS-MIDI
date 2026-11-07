export function placeAnchoredControl({ element, anchor, window, margin = 12, preferAbove = false }) {
  element.style.left = '0px'; element.style.top = '0px';
  const reference = anchor.getBoundingClientRect(), origin = element.getBoundingClientRect();
  const width = Number(window?.innerWidth) || element.ownerDocument?.documentElement?.clientWidth || 1920;
  const height = Number(window?.innerHeight) || element.ownerDocument?.documentElement?.clientHeight || 1080;
  const scaleX = element.offsetWidth > 0 && origin.width > 0 ? origin.width / element.offsetWidth : 1;
  const scaleY = element.offsetHeight > 0 && origin.height > 0 ? origin.height / element.offsetHeight : 1;
  const left = Math.max(margin, Math.min(reference.left, width - origin.width - margin));
  const below = reference.bottom + 6, above = reference.top - origin.height - 6;
  const top = preferAbove && above >= margin ? above : below + origin.height <= height - margin ? below : Math.max(margin, Math.min(above, height - origin.height - margin));
  element.style.left = (left - origin.left) / scaleX + 'px'; element.style.top = (top - origin.top) / scaleY + 'px';
  return Object.freeze({ left, top, width: origin.width, height: origin.height, scaleX, scaleY });
}
