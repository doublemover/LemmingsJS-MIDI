// Presentation stays on the original cell, foot anchor and action clock.
const BODY = '2345';
const GAITS = Object.freeze({
  rounded_triangle: { hop: [0, 0, 0, 1, 1, 1, 0, 0] },
  capsule: { hop: [0, 0, 0, 0, 1, 0, 0, 0] },
  circle: { hop: [0, 0, 1, 1, 1, 0, 0, 0] },
  circle_two_ears: { hop: [0, 1, 1, 0, 0, 0, 0, 0] },
  four_lobed_butterfly: { hop: [0, 1, 1, 0, 0, 1, 1, 0] },
  heart: { hop: [0, 0, 1, 1, 0, 0, 0, 0] },
  rounded_cube: { hop: [0, 0, 0, 0, 0, 0, 0, 0], roll: [0, -5, -5, 0, 0, 5, 5, 0] },
  rounded_diamond: { hop: [0, 0, 1, 1, 1, 1, 0, 0] },
  rounded_head_two_ears: { hop: [0, 0, 0, 1, 0, 0, 0, 0] },
  six_lobed_flower: { hop: [0, 1, 0, 0, 0, 1, 0, 0] },
  twelve_scalloped_rosette: { hop: [0, 0, 0, 1, 1, 0, 0, 0], roll: [0, 0, -4, -4, 0, 0, 4, 4] },
  donut: { hop: [0, 0, 0, 0, 1, 1, 0, 0] }
});

function bodyBounds(rows) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  rows.forEach((row, y) => [...row].forEach((symbol, x) => {
    if (!BODY.includes(symbol)) return;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }));
  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function transformRows(rows, record, scale, { hop = 0, shift = 0, roll = 0 } = {}) {
  const angle = roll * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return rows.map((row, y) => [...row].map((_, x) => {
    const dx = x + record.offsetX - shift, dy = y + record.offsetY + 0.5 + hop;
    const sx = Math.round((dx * cos + dy * sin) / scale - record.offsetX);
    const sy = Math.round((-dx * sin + dy * cos) / scale - record.offsetY - 0.5);
    return rows[sy]?.[sx] || '0';
  }).join(''));
}

function enclosedPixels(rows) {
  const width = rows[0].length, height = rows.length, outside = new Set(), queue = [];
  const visit = (x, y) => {
    const key = y * width + x;
    if (x < 0 || x >= width || y < 0 || y >= height || rows[y][x] !== '0' || outside.has(key)) return;
    outside.add(key); queue.push([x, y]);
  };
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i]; visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  const interior = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rows[y][x] === '0' && !outside.has(y * width + x)) interior.push([x, y]);
  }
  return interior;
}

function preserveAperture(source, result, record, scale, pose) {
  const aperture = enclosedPixels(source);
  if (!aperture.length || enclosedPixels(result).length) return;
  // If downsampling skips a one-row aperture, keep one transparent pixel at its projected center.
  const x = aperture.reduce((sum, pixel) => sum + pixel[0], 0) / aperture.length;
  const y = aperture.reduce((sum, pixel) => sum + pixel[1], 0) / aperture.length;
  const tx = Math.round((x + record.offsetX) * scale - record.offsetX + (pose.shift || 0));
  const ty = Math.round((y + record.offsetY + 0.5) * scale - record.offsetY - 0.5 - (pose.hop || 0));
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const px = tx + dx, py = ty + dy;
    if (!BODY.includes(result[py]?.[px] || '-')) continue;
    if (![[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]].every(([nx, ny]) => result[ny]?.[nx] && result[ny][nx] !== '0')) continue;
    result[py] = result[py].slice(0, px) + '0' + result[py].slice(px + 1);
    return;
  }
}

function preserveEyes(source, result, record, scale, pose) {
  if (scale >= 1) return;
  const columns = new Map();
  source.forEach((row, y) => [...row].forEach((symbol, x) => {
    if (symbol === '5') columns.set(x, [...(columns.get(x) || []), y]);
  }));
  if (!columns.size || columns.size > 2) return;
  const angle = (pose.roll || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const points = [...columns].map(([x, ys]) => {
    const dx = (x + record.offsetX) * scale, dy = (ys[0] + record.offsetY + 0.5) * scale;
    return { x: Math.round(dx * cos - dy * sin - record.offsetX + (pose.shift || 0)),
      y: Math.round(dx * sin + dy * cos - record.offsetY - 0.5 - (pose.hop || 0)) };
  }).sort((a, b) => a.x - b.x);
  const onBody = point => BODY.includes(result[point.y]?.[point.x] || '-');
  if (points.length === 2 && points[1].x - points[0].x < 2) {
    if (onBody({ ...points[0], x: points[0].x - 1 })) points[0].x--;
    else if (onBody({ ...points[1], x: points[1].x + 1 })) points[1].x++;
  }
  if (!points.every(onBody)) return;
  for (let y = 0; y < result.length; y++) result[y] = result[y].replaceAll('5', '3');
  for (const point of points) result[point.y] = result[point.y].slice(0, point.x) + '5' + result[point.y].slice(point.x + 1);
}

function copyBrick(rows, original, record) {
  const y = -record.offsetY - 1;
  for (let x = 0; x < record.width; x++) {
    if (!'678'.includes(original[y][x])) continue;
    rows[y] = rows[y].slice(0, x) + original[y][x] + rows[y].slice(x + 1);
  }
}

// https://easings.net/#easeInExpo: hold near the surface, then accelerate down.
const easeInExpo = progress => progress === 0 ? 0 : 2 ** (10 * progress - 10);
const drowningSink = (index, distance) => Math.round(distance * easeInExpo(Math.min(1, Math.max(0, (index - 3) / 11))));

function deathBody(neutral, record, scale, shapeId) {
  const rows = Array.from({ length: record.height }, (_, y) => Array.from({ length: record.width }, (_, x) => {
    const symbol = neutral.frames[0][y + record.offsetY - neutral.offsetY]?.[x + record.offsetX - neutral.offsetX];
    return BODY.includes(symbol || '-') ? symbol : '0';
  }).join(''));
  const result = transformRows(rows, record, scale);
  preserveEyes(rows, result, record, scale, {});
  if (shapeId === 'donut') preserveAperture(rows, result, record, scale, {});
  return result;
}

function deathFrame(body, record, index, kind = record.state === 'DROWNING' ? 'water' : 'fire') {
  const pixels = Array.from({ length: record.height }, () => Array(record.width).fill('0'));
  const bounds = bodyBounds(body), floor = -record.offsetY - 1;
  const dot = (x, y, color) => { if (pixels[y]?.[x] != null) pixels[y][x] = color; };
  const line = (x1, x2, y, color) => { for (let x = x1; x <= x2; x++) dot(x, y, color); };
  if (kind === 'water') {
    const sink = drowningSink(index, bounds.height + 2);
    body.forEach((row, y) => [...row].forEach((symbol, x) => {
      if (symbol !== '0' && y + sink < floor) dot(x, y + sink, symbol);
    }));
    // Tiny raised hands stay with the body and disappear beneath the same waterline.
    const handY = bounds.top + (index < 3 ? 2 - index : 0) + sink;
    for (const x of [bounds.left - 1, bounds.right + 1]) {
      if (handY < floor) dot(x, handY, '4');
      if (handY + 1 < floor) dot(x, handY + 1, '3');
    }
    if (index < 14) {
      line(3 + index % 2, 6, floor, '9'); line(9, 12 - index % 2, floor, '9');
      if (index < 4) { dot(2, floor - 2 - index % 2, 'A'); dot(13, floor - 1 - index % 2, '9'); }
    } else {
      dot(7, floor - (index - 13), '9'); dot(8, floor - (index - 13) - 1, 'A');
      if (index === 14) { dot(5, floor, '9'); dot(10, floor, '9'); }
    }
  } else if (kind === 'fire' || kind === 'lava') {
    const phase = Math.round(index * 13 / (record.frameCount - 1));
    const hop = [0, 1, 0, 2, 0, 1, 2, 0, 1, 0, 0, 0, 0, 0][phase];
    const shift = phase < 10 ? [0, -1, 1, 0][phase % 4] : 0;
    const sink = kind === 'lava' ? drowningSink(index, bounds.height + 2) : 0;
    if (phase < 12) {
      for (const x of [3, 6, 10, 12]) {
        const height = 2 + Math.floor(phase / 2) + (phase + x) % 3;
        for (let dy = 0; dy < height; dy++) {
          dot(x + (dy === height - 1 ? phase % 2 : 0), floor - dy, dy < height - 2 ? 'A' : '9');
          if (dy < height - 2) dot(x + 1, floor - dy, '9');
        }
      }
    }
    if (phase < 11) {
      body.forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol === '0') return;
        const charred = phase >= 6 && ((x * 3 + y) % 5 < phase - 5);
        const color = charred ? (symbol === '5' ? 'A' : '1') : symbol;
        const py = y - hop + sink;
        if (kind !== 'lava' || py < floor) dot(x + shift, py, color);
      }));
      const handY = bounds.top - hop + (phase % 2 ? 0 : 2) + sink;
      for (const x of [bounds.left - 1 + shift, bounds.right + 1 + shift]) {
        if (handY < floor) dot(x, handY, phase >= 8 ? '1' : '4');
        if (handY + 1 < floor) dot(x, handY + 1, phase >= 8 ? '1' : '3');
      }
      const mouthX = Math.round((bounds.left + bounds.right) / 2) + shift;
      const mouthY = bounds.bottom - 1 - hop + sink;
      if ('234'.includes(pixels[mouthY]?.[mouthX] || '-')) dot(mouthX, mouthY, '5');
    } else {
      line(5, 10, floor, '1');
      for (const x of [5, 8, 10]) dot(x, floor - 2 - (phase + x) % 4, '9');
    }
  } else if (kind === 'acid') {
    const progress = index / (record.frameCount - 1), dissolve = progress * progress;
    body.forEach((row, y) => [...row].forEach((symbol, x) => {
      if (symbol === '0' || ((x * 7 + y * 13) % 19) / 19 < dissolve) return;
      const py = Math.round(y + dissolve * (floor - y));
      if (py < floor) dot(x, py, symbol);
    }));
    if (index < record.frameCount - 2) {
      line(4, 11, floor, '9');
      dot(3 + index % 3, floor - 1 - index % 3, 'A');
      dot(11 - index % 2, floor - 1 - (index + 1) % 3, '9');
    } else dot(7 + index % 2, floor - 2, 'A');
  } else {
    const progress = index / (record.frameCount - 1);
    if (index < record.frameCount - 3) {
      body.forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol === '0') return;
        let px = x, py = y, color = symbol;
        const middle = (bounds.left + bounds.right) / 2;
        if (kind === 'crush') {
          py = floor - Math.round((floor - y) * Math.max(0.12, 1 - index / 3));
          px = Math.round(middle + (x - middle) * Math.min(1.4, 1 + index / 8));
        } else if (kind === 'suction') {
          px = Math.round(middle + (x - middle) * (1 - progress * 0.8));
          py = y - Math.round(progress * (record.height + 3));
        } else if (kind === 'tentacle' || kind === 'bite') {
          const shrink = Math.max(0.05, 1 - progress * 1.3);
          px = Math.round(middle + (x - middle) * shrink);
          py = floor - Math.round((floor - y) * shrink);
        } else if (kind === 'electric') {
          px += index % 2 ? -1 : 1;
          color = symbol === '5' ? '1' : index % 2 ? 'A' : index > 7 ? '1' : symbol;
        } else if (kind === 'ice') {
          color = symbol === '5' ? '5' : (x + y) % 3 ? '9' : 'A';
          if (index > 7) {
            if ((x + y) % 3 === index % 3) return;
            py += Math.round((index - 7) * (0.2 + x % 3 * 0.15));
          }
        } else if (kind === 'slice' || kind === 'spikes') {
          if (index > 3) {
            px += y < (bounds.top + bounds.bottom) / 2 ? -Math.min(2, index - 3) : Math.min(2, index - 3);
            py += Math.floor((index - 3) / 3);
          }
        }
        dot(px, py, color);
      }));
    }
    if (kind === 'electric' && index < 11) {
      for (let y = bounds.top; y < floor; y++) dot((index % 2 ? 2 : 13) + y % 2, y, y % 2 ? '9' : 'A');
    }
    if (kind === 'crush' && index >= 3 && index < 13) line(4, 11, floor, '2');
    if (kind === 'ice' && index >= 12) for (const x of [4, 7, 11]) dot(x, floor, '9');
  }
  return pixels.map(row => row.join(''));
}

function particleLayers(manifest, pack, appearance, scale) {
  return [-1, 1].map(direction => {
    const record = manifest.animations.find(entry => entry.state === 'WALKING' && entry.direction === direction);
    const rows = record.frames[0], eyewearMask = new Set();
    if (appearance.eyewear && pack) {
      const strip = pack.animations.find(entry => entry.state === 'WALKING' && entry.direction === direction);
      const patch = pack.patches[strip?.items[appearance.eyewear]?.[0]];
      if (patch) patch[2].forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol !== '.') eyewearMask.add((patch[1] + y) * record.width + patch[0] + x);
      }));
    }
    const layers = {};
    for (const part of ['body', 'accessory', 'eyewear']) {
      const sparse = rows.map((row, y) => [...row].map((symbol, x) => {
        const category = eyewearMask.has(y * record.width + x) ? 'eyewear' : BODY.includes(symbol) ? 'body' : 'accessory';
        return category === part ? symbol : '0';
      }).join(''));
      layers[part] = transformRows(sparse, record, scale);
    }
    return { direction, width: record.width, height: record.height, offsetX: record.offsetX, offsetY: record.offsetY, ...layers };
  });
}

function refineCharacterPresentation(manifest, source, shapeId, pack = null, appearance = {}) {
  const neutral = source.animations.find(record => record.state === 'WALKING' && record.direction === 1);
  const bounds = bodyBounds(neutral.frames[0]);
  const scale = Math.min(1, 7 / Math.max(bounds.width, bounds.height));
  const gait = GAITS[shapeId] || GAITS.circle;
  const animations = manifest.animations.map(record => {
    const terminalBody = ['DROWNING', 'FRYING'].includes(record.state) ? deathBody(neutral, record, scale, shapeId) : null;
    const frames = record.frames.map((rows, index) => {
      if (record.state === 'EXPLODING') return rows;
      if (index > 0 && terminalBody) return deathFrame(terminalBody, record, index);
      if (index > 0 && record.state === 'SPLATTING') {
        const bare = source.animations.find(entry => entry.state === record.state && entry.direction === record.direction);
        rows = rows.map((row, y) => [...row].map((_, x) => {
          const symbol = bare.frames[index][y + record.offsetY - bare.offsetY]?.[x] || '0';
          return '23459A'.includes(symbol) ? symbol : '0';
        }).join(''));
      }
      let pose = {};
      if (record.state === 'WALKING') {
        rows = record.frames[0];
        pose = { hop: gait.hop[index], roll: (gait.roll?.[index] || 0) * record.direction };
      } else if (record.state === 'OHNO') {
        // A held beat, nervous double-take, then quick little panic hops.
        rows = manifest.animations.find(entry => entry.state === 'WALKING' && entry.direction === (index < 4 || index % 4 < 2 ? 1 : -1)).frames[0];
        pose = { hop: [0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1][index],
          shift: index < 4 ? 0 : index % 2 ? -1 : 1 };
      }
      const result = transformRows(rows, record, scale, pose);
      preserveEyes(rows, result, record, scale, pose);
      if (shapeId === 'donut') preserveAperture(rows, result, record, scale, pose);
      if (record.state === 'BUILDING' && index === 9) copyBrick(result, rows, record);
      if (record.state === 'OHNO') {
        const browY = Math.max(0, -record.offsetY - Math.ceil(bounds.height * scale) - pose.hop - 1);
        const sweatX = index < 8 ? 13 : 3;
        if (index >= 3 && index % 3 !== 2) {
          const y = Math.max(0, browY - index % 2);
          result[y] = result[y].slice(0, sweatX) + '9' + result[y].slice(sweatX + 1);
        }
      }
      return result;
    });
    return { ...record, frames };
  });
  const landing = manifest.cosmetics?.beretLanding;
  return { ...manifest, shapeId, animations,
    presentation: { version: 1, scale, targetBodyExtent: 7, gait: shapeId },
    particleParts: particleLayers(manifest, pack, appearance, scale),
    ...(landing ? { cosmetics: { ...manifest.cosmetics, beretLanding: { ...landing,
      variants: landing.variants.map(variant => ({ ...variant, frames: variant.frames.map((rows, index) => {
        const result = transformRows(rows, landing, scale);
        if (shapeId === 'donut') preserveAperture(rows, result, landing, scale, {});
        if (index === 6) {
          const walk = animations.find(record => record.state === 'WALKING' && record.direction === variant.direction);
          return result.map((row, y) => walk.frames[6][y + landing.offsetY - walk.offsetY] || '0'.repeat(landing.width));
        }
        return result;
      }) }))
    } } } : {})
  };
}

export { refineCharacterPresentation, transformRows, bodyBounds, GAITS, easeInExpo, drowningSink, deathBody, deathFrame };
