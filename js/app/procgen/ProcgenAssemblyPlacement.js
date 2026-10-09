import { TriggerTypes as Types } from '../../level/TriggerTypes.js';

const readiness = new WeakMap(), footCache = new WeakMap();
const lethal = role => ['trap', 'hazard', 'liquid'].includes(role);
const roleFor = image => image.trigger_effect_id === Types.TRAP ? 'trap' : image.trigger_effect_id === Types.DROWN ? 'liquid' :
  [Types.KILL, Types.FRYING].includes(image.trigger_effect_id) ? 'hazard' : image.trigger_effect_id === Types.EXIT_LEVEL || image.animationLoop === false ? 'structure' : 'ambient';
const dimensions = member => member.image || member.piece.image;
const pixelsFor = member => member.pixels || member.piece.frame || dimensions(member).frames[0];
const opaqueAt = (member, x, y) => {
  const image = dimensions(member), pixels = pixelsFor(member), flip = member.orientation?.flipX ?? member.flip, flipY = member.orientation?.flipY ?? member.flipY;
  return x >= 0 && y >= 0 && x < image.width && y < image.height && !(pixels[(flipY ? image.height - 1 - y : y) * image.width + (flip ? image.width - 1 - x : x)] & 128);
};
const feetFor = (member, cacheKey = member) => {
  let cached = footCache.get(cacheKey);
  if (cached) return cached;
  const image = dimensions(member), feet = [], stride = Math.max(1, Math.ceil(image.width / 16));
  for (let x = 0; x < image.width; x += stride) for (let y = image.height - 1; y >= 0; y--) if (opaqueAt(member, x, y)) { feet.push({ x, y }); break; }
  footCache.set(cacheKey, feet); return feet;
};
const overlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
const placementBox = (placement, origin = 0) => ({ x1: placement.x - origin, x2: placement.x - origin + (placement.piece.width || placement.piece.image.width),
  y1: placement.y, y2: placement.y + (placement.piece.height || placement.piece.image.height) });

// Replays a complete observed attachment, including its evidenced supporting
// asset. Ground placement aligns that anchor's opaque feet, never the flag/head.
const placeAuthoredAssemblies = ({ compiled = [], chunk, origin = chunk * 128, code = 0, progression = {}, baseSolid, baseSurface,
  occupied = [], existingObjects = [], chunkWidth = 128, height = 96, introSafeEnd = 256, gapX = -1, gapWidth = 0 } = {}) => {
  const terrainPlacements = [], objects = [], assemblies = [];
  if (!compiled.length || !baseSolid || !baseSurface || origin < introSafeEnd) return { terrainPlacements, objects, assemblies };
  const count = Math.min(4, compiled.length);
  for (let attempt = 0; attempt < count && assemblies.length < 2; attempt++) {
    const group = compiled[((code >>> 0) + chunk + attempt) % compiled.length], entry = group.entry;
    if (group.objects.some(member => [Types.ONEWAY_LEFT, Types.ONEWAY_RIGHT, Types.DROWN].includes(member.image.trigger_effect_id))) continue;
    for (const support of group.supportAnchors.filter(anchor => anchor.confidence >= 0.8 && anchor.anchor.kind === 'terrain' && anchor.anchor.piece && !anchor.anchor.piece.isSteel).slice(0, 4)) {
      const anchor = support.anchor, anchorMember = { ...anchor, image: anchor.image || anchor.piece.image, pixels: anchor.pixels || anchor.piece.frame,
        orientation: anchor.orientation || { flipX: !!(anchor.f & 8), flipY: !!(anchor.f & 2) } };
      const all = [...group.members, anchorMember], left = Math.min(...all.map(m => m.x)), top = Math.min(...all.map(m => m.y));
      const right = Math.max(...all.map(m => m.x + dimensions(m).width)), bottom = Math.max(...all.map(m => m.y + dimensions(m).height));
      const width = right - left, span = bottom - top;
      if (width > chunkWidth - 16 || span > height - 2 || group.members.length > 8) continue;
      const feet = feetFor(anchorMember, anchor); if (!feet.length) continue;
      const match = occupied.find(p => p.piece === anchor.piece && !!p.flip === anchorMember.orientation.flipX && !!p.flipY === anchorMember.orientation.flipY && !p.decor);
      const ox = match ? match.x - anchor.x : 8 - left + ((code >>> (attempt * 5)) % Math.max(1, chunkWidth - 16 - width + 1));
      let oy = match ? match.y - anchor.y : -Infinity;
      if (!match) for (const foot of feet) {
        const floor = baseSurface(ox + anchor.x + foot.x);
        if (!Number.isFinite(floor) || floor < 0) { oy = NaN; break; }
        oy = Math.max(oy, floor - anchor.y - foot.y - 1);
      }
      const box = { x1: ox + left, x2: ox + right, y1: oy + top, y2: oy + bottom };
      if (!Number.isFinite(oy) || box.x1 < 8 || box.x2 > chunkWidth - 8 || box.y1 < 1 || box.y2 > height - 1 ||
        gapWidth && box.x2 > gapX - 3 && box.x1 < gapX + gapWidth + 3 ||
        occupied.some(p => p !== match && overlap(box, placementBox(p))) || existingObjects.some(p => overlap(box, placementBox(p, origin))) ||
        assemblies.some(a => overlap(box, { ...a.bounds, x1: a.bounds.x1 - origin, x2: a.bounds.x2 - origin }))) continue;
      let supports = feet.map(foot => ({ x: origin + ox + anchor.x + foot.x, y: oy + anchor.y + foot.y + 1 }));
      if (match) {
        supports = [];
        const image = anchorMember.image;
        for (const [dx, dy, nx, ny] of [[0, 0, -1, 0], [image.width - 1, 0, 1, 0], [0, 0, 0, -1], [0, image.height - 1, 0, 1]]) {
          const horizontal = ny !== 0, length = horizontal ? image.width : image.height;
          for (let offset = 0; offset < length; offset += Math.max(1, Math.ceil(length / 4))) {
            const x = dx + (horizontal ? offset : 0), y = dy + (horizontal ? 0 : offset);
            if (!opaqueAt(anchorMember, x, y)) continue;
            const point = { x: origin + match.x + x + nx, y: match.y + y + ny };
            if (baseSolid(point.x - origin, point.y)) supports.push(point);
          }
        }
      }
      if (!supports.length || supports.some(point => !baseSolid(point.x - origin, point.y))) continue;
      let valid = true;
      for (const member of group.objects) {
        const image = member.image, x = origin + ox + member.x, y = oy + member.y, role = roleFor(image);
        const flip = member.orientation.flipX, flipY = member.orientation.flipY;
        if (lethal(role)) {
          const x1 = x + (flip ? image.width - image.trigger_left - image.trigger_width : image.trigger_left);
          const y1 = y + (flipY ? image.height - image.trigger_top - image.trigger_height : image.trigger_top);
          if (![x1, y1, image.trigger_width, image.trigger_height].every(Number.isFinite) || image.trigger_width <= 0 || image.trigger_height <= 0 ||
            Math.min(x, x1) < Math.max(origin + 8, introSafeEnd) || Math.max(x + image.width, x1 + image.trigger_width) > origin + chunkWidth - 8 ||
            y1 < 0 || y1 + image.trigger_height > height || ((code ^ Math.imul(member.id + 1, 0x9e3779b1)) >>> 0) % 1024 >= (progression.hazardThreshold ?? 1024)) valid = false;
        }
        // Hidden/buried decoration is not an attachment to a visible structure.
        let opaque = 0, buried = 0;
        for (let dy = 0; dy < image.height; dy++) for (let dx = 0; dx < image.width; dx++) if (opaqueAt(member, dx, dy)) { opaque++; if (baseSolid(x - origin + dx, y + dy)) buried++; }
        if (!opaque || buried > Math.max(2, opaque * 0.05)) valid = false;
      }
      if (!valid) continue;
      const contacts = entry.relations.flatMap(edge => [
        ...(entry.placements[edge.a].kind === 'terrain' ? [{ x: origin + ox + edge.x, y: oy + edge.y }] : []),
        ...(entry.placements[edge.b].kind === 'terrain' ? [{ x: origin + ox + edge.anchorX, y: oy + edge.anchorY }] : [])
      ]);
      contacts.push({ x: origin + ox + support.anchorX, y: oy + support.anchorY });
      const assembly = { id: entry.id, sourceRevision: group.sourceRevision, chunk, bounds: { ...box, x1: origin + box.x1, x2: origin + box.x2 },
        contacts, foundationSupports: supports, supportMember: support.member, memberCount: all.length };
      for (const member of all) if (member.kind === 'terrain' && (member !== anchorMember || !match)) terrainPlacements.push({ piece: member.piece,
        x: ox + member.x, y: oy + member.y, flip: member.orientation.flipX, flipY: member.orientation.flipY, decor: false,
        assembly, assemblyMemberIds: [member.id], sourceRevision: group.sourceRevision });
      for (const member of group.objects) {
        const image = member.image, role = roleFor(image);
        objects.push({ piece: member.piece, x: origin + ox + member.x, y: oy + member.y, flip: member.orientation.flipX, flipY: member.orientation.flipY,
          role, phase: 0, animation: image.trigger_effect_id === Types.TRAP || image.animationLoop === false ? 'idle' : 'loop', interactive: false, supportY: null, assembly });
      }
      assemblies.push(assembly); break;
    }
  }
  return { terrainPlacements, objects, assemblies };
};

const assemblyPlacementReady = (world, lane, object, descriptor) => {
  const assembly = object?.assembly;
  if (!assembly || lane < 0 || lane >= world.laneCount) return false;
  const objectIndex = descriptor.objects?.indexOf(object);
  if (Number.isInteger(objectIndex) && objectIndex >= 0 && world.terrainGrowth && !world.terrainGrowth.objectReady(lane, assembly.chunk, objectIndex)) return false;
  const revision = world.terrainTileRevisions?.get(lane * 0x800000 + assembly.chunk) || 0, through = world.generatedThrough[lane], cached = readiness.get(assembly);
  if (cached?.world === world && cached.lane === lane && cached.generation === world.generation && cached.revision === revision && cached.through === through) return cached.ready;
  const height = world.laneHeight, top = lane * height, bounds = assembly.bounds, chunkWidth = world.terrain.chunkWidth;
  const state = world.terrainGrowth?.stateFor(lane, assembly.chunk);
  const solid = point => {
    if (point.y < 0 || point.y >= height || point.x < assembly.chunk * chunkWidth || point.x >= (assembly.chunk + 1) * chunkWidth) return false;
    const edits = world.editChunks.get(world._editKey(point.x, top + point.y)), edit = edits?.[point.y * 32 + point.x % 32] || 0;
    return edit ? edit > 1 : world.terrain.solidSample(world.laneSeeds[lane], assembly.chunk, point.x - assembly.chunk * chunkWidth, point.y, descriptor, state);
  };
  const ready = bounds.x1 >= world.leftEdgeX && bounds.x2 <= through && bounds.y1 >= 0 && bounds.y2 <= height &&
    assembly.contacts.length > 0 && assembly.contacts.length <= 57 && assembly.foundationSupports.length > 0 && assembly.foundationSupports.length <= 16 &&
    [...assembly.contacts, ...assembly.foundationSupports].every(solid);
  readiness.set(assembly, { world, lane, generation: world.generation, revision, through, ready }); return ready;
};
export { placeAuthoredAssemblies, assemblyPlacementReady };
