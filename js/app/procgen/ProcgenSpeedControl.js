const normalizeProcgenSpeed = (value, fallback = 3) => Number.isFinite(Number(value)) && Number(value) >= 0.1 ? Number(value) : fallback;
const changeProcgenSpeed = (value, direction, { fast = false, panel = false } = {}) => {
  let speed = normalizeProcgenSpeed(value);
  for (let i = 0; i < (fast ? 5 : 1); i++) {
    const step = speed < 1 || (direction < 0 && speed <= 1) ? 0.1 : panel && (direction > 0 ? speed >= 10 : speed > 10) ? 10 : 1;
    speed = Math.max(0.1, Math.round((speed + direction * step) * 100) / 100);
  }
  return speed;
};
export { normalizeProcgenSpeed, changeProcgenSpeed };

const renderProcgenSpeedControl = ({ document, sprites, speed }) => {
  if (!sprites) return;
  const draw = (id, frame, width, height) => {
    const host = document.getElementById(id); if (!host || !frame) return;
    let canvas = Array.from(host.children).find(child => child.tagName === 'CANVAS');
    if (!canvas) { canvas = document.createElement('canvas'); if (!canvas.getContext) return; canvas.setAttribute('aria-hidden', 'true'); host.appendChild(canvas); }
    canvas.width = width; canvas.height = height;
    const bitmap = document.createElement('canvas'); bitmap.width = frame.width; bitmap.height = frame.height;
    const context = bitmap.getContext('2d'), pixels = context.createImageData(frame.width, frame.height);
    pixels.data.set(frame.getData()); context.putImageData(pixels, 0, 0);
    const target = canvas.getContext('2d'); target.imageSmoothingEnabled = false; target.drawImage(bitmap, 0, 0, width, height);
  };
  draw('procgenSpeedDown', sprites.getLetterSprite('-'), 6, 12);
  draw('procgenSpeedUp', sprites.getLetterSprite('F'), 6, 8);
  const host = document.getElementById('procgenSpeedReadout'); if (!host) return;
  let canvas = Array.from(host.children).find(child => child.tagName === 'CANVAS');
  if (!canvas) { canvas = document.createElement('canvas'); if (!canvas.getContext) return; host.appendChild(canvas); }
  const label = String(speed), context = canvas.getContext('2d'); canvas.width = label.length * 8; canvas.height = 8;
  context.imageSmoothingEnabled = false;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '.') { context.fillStyle = '#fff'; context.fillRect(i * 8 + 3, 6, 1, 1); continue; }
    const frame = sprites.getNumberSpriteRight(Number(label[i])); if (!frame) continue;
    const pixels = context.createImageData(frame.width, frame.height); pixels.data.set(frame.getData());
    const bitmap = document.createElement('canvas'); bitmap.width = frame.width; bitmap.height = frame.height; bitmap.getContext('2d').putImageData(pixels, 0, 0);
    context.drawImage(bitmap, i * 8, 0);
  }
};
export { renderProcgenSpeedControl };
