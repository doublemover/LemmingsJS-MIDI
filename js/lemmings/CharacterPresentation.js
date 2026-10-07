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

function deathFrame(body, record, index) {
  const pixels = Array.from({ length: record.height }, () => Array(record.width).fill('0'));
  const bounds = bodyBounds(body), floor = -record.offsetY - 1;
  const dot = (x, y, color) => { if (pixels[y]?.[x] != null) pixels[y][x] = color; };
  const line = (x1, x2, y, color) => { for (let x = x1; x <= x2; x++) dot(x, y, color); };
  if (record.state === 'DROWNING') {
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
  } else {
    const hop = [0, 1, 0, 1, 2, 3, 2, 1, 0][index] || 0;
    const shift = [0, -1, 0, 1, 0, -1, 0, 1, 0][index] || 0;
    if (index < 9) {
      body.forEach((row, y) => [...row].forEach((symbol, x) => {
        if (symbol !== '0') dot(x + shift, y - hop, index === 8 ? (symbol === '5' ? 'A' : '1') : symbol);
      }));
    } else if (index < 12) {
      line(5, 10, floor - 1, '1'); line(6, 9, floor - 2, '1');
      if (index < 11) { dot(6, floor - 2, 'A'); dot(9, floor - 2, 'A'); }
    } else {
      for (const x of [5, 7, 10]) dot(x, floor - 1, '9');
    }
    // A little skillet, hot-foot sizzle, then a comically overdone puff of smoke.
    line(3, 12, floor, '9'); line(4, 11, floor + 1, '1');
    line(12, 15, floor - 1, '9'); dot(15, floor, '1');
    if (index < 9) {
      dot(index % 2 ? 2 : 3, floor - 2 - index % 3, 'A');
      dot(index % 2 ? 12 : 13, floor - 3 + index % 2, 'A');
    }
    if (index >= 4) {
      const smokeY = floor - 5 - (index - 4) % 4;
      dot(4 + index % 2, smokeY, '9'); dot(11 - index % 2, smokeY - 1, '9');
      if (index >= 9) dot(7 + index % 2, smokeY - 2, 'A');
    }
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

export { refineCharacterPresentation, transformRows, bodyBounds, GAITS, easeInExpo, drowningSink };
