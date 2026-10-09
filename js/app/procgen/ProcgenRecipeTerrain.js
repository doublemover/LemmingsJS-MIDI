import { composeRecipeChunk } from './ProcgenTerrainRecipes.js';
import { ProcgenTerrainZonePlanner } from './ProcgenTerrainZones.js';
import { createSourceGroupLibrary, placeSourceGroups } from './ProcgenTerrainGroups.js';
import { TriggerTypes } from '../../level/TriggerTypes.js';
import { createProcgenWordPlanner } from './ProcgenWords.js';
import { PROCGEN_INTRO_SAFE_END, PROCGEN_RECOVERY_GAP_END, progressionAt, introAssemblyEligible } from './ProcgenTerrainProgression.js';
import { compileAuthoredAssemblies } from './ProcgenAuthoredAssemblies.js';
import { placeAuthoredAssemblies } from './ProcgenAssemblyPlacement.js';
import { createTerrainGrowthPlan } from './ProcgenTerrainMaterialization.js';

const TERRAIN_CHUNK_WIDTH = 128;
const TERRAIN_HEIGHT = 96;
const PHASE_CHUNKS = 4;
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };
const keyFor = (seed, chunk) => `${seed}:${chunk}`;
const opaque = value => (value | 0xff000000) >>> 0;

// Source motifs are ingredients, not an endless repeating track. Only requested
// frontier chunks are composed; collision and display have separate bounded caches.
class ProcgenRecipeTerrain {
  constructor({ recipe, terrainPieces, objectPieces = [], sourceDescriptor = null, assemblyCatalog = null, packWidthLimit = sourceDescriptor?.widths.max }) {
    if (!recipe?.routes?.length) throw new Error('The selected theme has no sourced terrain recipes');
    this.recipe = recipe;
    this.pieces = terrainPieces.filter(p => p?.frame?.length && p.width && p.height);
    this.wordPlanner = createProcgenWordPlanner(recipe, this.pieces);
    this.assemblyCatalog = assemblyCatalog?.assetSha256 === recipe.assetSha256 && recipe.sources?.some(source => source.pack === assemblyCatalog.pack && source.groundSet === assemblyCatalog.groundSet) ? assemblyCatalog : null;
    this.associatedTerrainIds = new Set(this.assemblyCatalog?.associatedTerrainIds || []);
    this.associatedObjectIds = new Set(this.assemblyCatalog?.associatedObjectIds || []);
    this.excludedTerrainIds = new Set([...this.associatedTerrainIds, ...(this.wordPlanner?.ids || [])]);
    this.routes = recipe.routes.filter(route => route.placements.every(p => !this.excludedTerrainIds.has(p.id)));
    if (!this.routes.length) throw new Error('The selected theme has no independent sourced foundation');
    // Generic unconstrained decor has no authored attachment evidence. Only
    // actual source groups, words and complete supported assemblies are placed.
    const routeIds = new Set(this.routes.flatMap(route => route.placements.map(p => p.id)));
    this.ingredients = this.pieces.filter(piece => routeIds.has(piece.id));
    this.sourceDescriptor = sourceDescriptor?.assetSha256 === recipe.assetSha256 && recipe.sources?.some(source => source.pack === sourceDescriptor.pack && source.groundSet === sourceDescriptor.groundSet) ? sourceDescriptor : null;
    this.supportsFineGrowth = !!this.sourceDescriptor;
    this.zonePlanner = this.sourceDescriptor ? new ProcgenTerrainZonePlanner({ descriptor: this.sourceDescriptor, availableIds: this.pieces.map(piece => piece.id), excludedIds: this.excludedTerrainIds, packWidthLimit }) : null;
    this.sourceGroups = createSourceGroupLibrary(this.sourceDescriptor, this.pieces, this.excludedTerrainIds);
    this.descriptions = new Map(); this.growthPlans = new Map(); this.descriptionLimit = 256;
    this.objects = objectPieces.filter(p => p?.image?.frames?.[0]?.length && p.image.width && p.image.height);
    this.compiledAssemblies = compileAuthoredAssemblies(this.assemblyCatalog, this.pieces, this.objects);
    this.assemblySources = new Map(this.compiledAssemblies.map(group => [group.entry.id, group]));
    this.eligibleObjectIds = new Set(this.objects.filter(p => this._standaloneObjectEligible(p)).map(p => p.id));
    for (const group of this.compiledAssemblies) for (const member of group.objects) if (![TriggerTypes.ONEWAY_LEFT, TriggerTypes.ONEWAY_RIGHT, TriggerTypes.DROWN].includes(member.image.trigger_effect_id)) this.eligibleObjectIds.add(member.id);
    this.eligibleTerrainIds = new Set(routeIds);
    for (const group of this.sourceGroups.keys()) for (const member of group.placements) this.eligibleTerrainIds.add(member.id);
    for (const word of this.wordPlanner?.choices || []) for (const glyph of word.letters) this.eligibleTerrainIds.add(glyph.piece.id);
    for (const group of this.compiledAssemblies) { for (const member of group.terrain) this.eligibleTerrainIds.add(member.id); for (const support of group.supportAnchors) if (support.anchor.kind === 'terrain') this.eligibleTerrainIds.add(support.anchor.id); }
    this.patterns = this.routes.map((route, index) => composeRecipeChunk({ recipe: { ...recipe, routes: [route] }, terrainPieces,
      seed: index + 1, width: route.period * Math.ceil(TERRAIN_CHUNK_WIDTH / route.period), height: TERRAIN_HEIGHT, surfaceY: 72, decoration: false }));
    for (const pattern of this.patterns) {
      pattern.introColumns = new Uint16Array(pattern.width);
      for (let x = 0; x < pattern.width; x++) {
        let nearest = x;
        for (let offset = 0; offset < pattern.width && pattern.topProfile[nearest] < 0; offset++) nearest = (nearest + 1) % pattern.width;
        pattern.introColumns[x] = nearest;
      }
      pattern.columnColors = new Uint32Array(pattern.width * TERRAIN_HEIGHT);
      for (let x = 0; x < pattern.width; x++) {
        const top = pattern.topProfile[x]; if (top < 0) continue;
        let color = opaque(pattern.pixels[top * pattern.width + x]);
        for (let dy = 0; dy < TERRAIN_HEIGHT; dy++) {
          const y = top + dy % (TERRAIN_HEIGHT - top);
          if (pattern.mask[y * pattern.width + x]) color = opaque(pattern.pixels[y * pattern.width + x]);
          pattern.columnColors[x * TERRAIN_HEIGHT + dy] = color;
        }
      }
    }
    this.chunkWidth = TERRAIN_CHUNK_WIDTH;
    this.collision = new Map();
    this.rasters = new Map();
    this.collisionLimit = 256;
    this.rasterLimit = 96;
    this.stats = { generated: 0, rasterized: 0, evicted: 0, generationMs: 0, maxGenerationMs: 0, groundPlacements: 0, decorPlacements: 0, objectPlacements: 0, assemblyPlacements: 0, canonicalGroups: 0, canonicalSourcePlacements: 0 };
    this.generationSamples = new Float32Array(1024); this.generationSampleCount = 0;
    this.selectedTerrainIds = new Set();
    this.selectedObjectIds = new Set();
    this._lastKey = null; this._lastChunk = null;
  }
  configure(laneCount, maxActors = 16384) { this.collisionLimit = Math.max(256, Math.min(32768, maxActors + laneCount * 2)); }
  reset() { this.descriptions.clear(); this.growthPlans.clear(); this.zonePlanner?.reset(); this.collision.clear(); this.rasters.clear(); this._lastKey = null; this._lastChunk = null; }
  get memoryMB() {
    let bytes = [...this.sourceGroups.values()].reduce((n, group) => n + group.piece.rgba.byteLength + group.piece.frame.byteLength + group.columnTop.byteLength + group.columnBottom.byteLength, 0);
    bytes += this.patterns.reduce((n, p) => n + p.pixels.byteLength + p.mask.byteLength + p.topProfile.byteLength + p.columnColors.byteLength + p.introColumns.byteLength, 0);
    for (const p of this.collision.values()) bytes += p.solid.byteLength + p.steel.byteLength + p.topProfile.byteLength;
    for (const p of this.rasters.values()) bytes += p.byteLength;
    return bytes / 1048576;
  }
  _code(seed, chunk) { return mix(seed ^ Math.imul(chunk + 1, 0x85ebca6b)); }
  describe(seed, chunk) {
    const cacheKey = keyFor(seed, chunk), cached = this.descriptions.get(cacheKey); if (cached) return cached;
    const code = this._code(seed, chunk), phase = Math.floor(chunk / PHASE_CHUNKS), phaseCode = this._code(seed ^ 0x51ed270b, phase);
    const origin = chunk * TERRAIN_CHUNK_WIDTH;
    const progression = progressionAt(origin), gap = !progression.safeIntro && (code & 7) < 1 + Math.floor(progression.difficulty);
    const placements = [];
    const left = this._elevation(seed, chunk), right = this._elevation(seed, chunk + 1);
    const middle = progression.difficulty >= 1 ? 28 + (phaseCode >>> 9) % 47 : Math.round((left + right) / 2) + (phaseCode >>> 9) % (progression.localRise + 1) - progression.localRise;
    const descriptor = { code, phase, phaseCode, origin, placements, progression, left, right, middle,
      gapX: origin + 88 + (code >>> 5) % 8, gapWidth: gap ? 3 + (code >>> 10) % (progression.gapMaximum - 2) : 0,
      barrierX: origin + (placements[0]?.x || 0), barrierWidth: progression.safeIntro ? 0 : (placements[0]?.piece.width || 0) };
    // Early narrow gaps retain a real source-foundation recovery floor. Their
    // upper opening and optional bridge remain; later gaps keep full depth.
    descriptor.gapFloor = descriptor.gapWidth && progression.gapDepth != null ? Math.min(TERRAIN_HEIGHT - 2,
      Math.max(this._surface(seed, chunk, descriptor.gapX - origin - 1, descriptor), this._surface(seed, chunk, descriptor.gapX - origin + descriptor.gapWidth, descriptor)) + progression.gapDepth) : null;
    descriptor.objects = [];
    descriptor.zone = this.zonePlanner?.zoneAt(seed, origin) || null;
    const pattern = this.patterns[mix(phaseCode ^ code) % this.patterns.length];
    const baseSurface = x => pattern.topProfile[this._patternColumn(pattern, x + origin)] < 0 ? -1 : this._surface(seed, chunk, x, descriptor);
    descriptor.word = this.wordPlanner?.plan(seed, chunk, TERRAIN_CHUNK_WIDTH, x => {
      if (x + origin >= descriptor.gapX && x + origin < descriptor.gapX + descriptor.gapWidth) return 0;
      let surface = this._surface(seed, chunk, x, descriptor);
      for (const placement of placements) if (!placement.decor && x >= placement.x && x < placement.x + placement.piece.width) surface = Math.min(surface, placement.y);
      return surface;
    }) || null;
    if (descriptor.word) {
      const word = descriptor.word;
      descriptor.placements = placements.filter(p => !p.decor || p.x + p.piece.width <= word.x - 2 || p.x >= word.x + word.width + 2 || p.y + p.piece.height <= word.y - 2 || p.y >= word.baseline + 2);
      descriptor.placements.push(...word.placements);
    }
    const assembled = placeAuthoredAssemblies({ compiled: this.compiledAssemblies, seed, chunk, origin, code, progression,
      baseSolid: (x, y) => this.solidSample(seed, chunk, x, y, descriptor), baseSurface, occupied: descriptor.placements,
      gapX: descriptor.gapX - origin, gapWidth: descriptor.gapWidth });
    // Filter complete final groups before any member enters growth/collision.
    // Later source eligibility and every exact member transform stay intact.
    const admitted = new Set(); descriptor.deferredAssemblies = [];
    for (const assembly of assembled.assemblies) {
      const members = assembled.terrainPlacements.filter(p => p.assembly === assembly);
      if (this._introAssemblyEligible(seed, chunk, descriptor, assembly, members, baseSurface)) {
        admitted.add(assembly); descriptor.placements.push(...members);
      } else descriptor.deferredAssemblies.push({ id: assembly.id, sourceRevision: assembly.sourceRevision, reason: 'early-local-route-envelope' });
    }
    descriptor.objects = assembled.objects.filter(object => admitted.has(object.assembly));
    descriptor.assemblies = assembled.assemblies.filter(assembly => admitted.has(assembly));
    const occupied = [...descriptor.placements, ...descriptor.assemblies.map(assembly => ({ x: assembly.bounds.x1 - origin,
      y: assembly.bounds.y1, piece: { width: assembly.bounds.x2 - assembly.bounds.x1, height: assembly.bounds.y2 - assembly.bounds.y1 }, decor: false }))];
    descriptor.placements.push(...placeSourceGroups({ zone: descriptor.zone, library: this.sourceGroups, code, chunk, baseSurface,
      baseSolid: (x, y) => this.solidSample(seed, chunk, x, y, descriptor), occupied, gapX: descriptor.gapX - origin, gapWidth: descriptor.gapWidth }));
    descriptor.objects.push(...this._placeObjects(seed, chunk, descriptor));
    descriptor.placements = descriptor.placements.filter(p => !p.canonicalGroup || !descriptor.objects.some(object => p.x + p.piece.width > object.x - origin - 2 && p.x < object.x - origin + object.piece.image.width + 2 && p.y + p.piece.height > object.y - 2 && p.y < object.y + object.piece.image.height + 2));
    if (this.descriptions.size >= this.descriptionLimit) this.descriptions.delete(this.descriptions.keys().next().value);
    this.descriptions.set(cacheKey, descriptor);
    return descriptor;
  }
  _introAssemblyEligible(seed, chunk, descriptor, assembly, members, surface) {
    const left = assembly.bounds.x1 - descriptor.origin, right = assembly.bounds.x2 - descriptor.origin;
    if (descriptor.origin + left >= PROCGEN_RECOVERY_GAP_END) return true;
    const candidate = { ...descriptor, placements: [...descriptor.placements, ...members] };
    // Descriptor creation is bounded and cached; no partial-growth state or
    // runtime actor queries participate in this full source-alpha admission.
    const samples = new Uint8Array(TERRAIN_CHUNK_WIDTH * TERRAIN_HEIGHT);
    const solid = (x, y) => {
      if (x < 0 || x >= TERRAIN_CHUNK_WIDTH || y < 0 || y >= TERRAIN_HEIGHT) return false;
      const at = y * TERRAIN_CHUNK_WIDTH + x;
      if (!samples[at]) samples[at] = this.solidSample(seed, chunk, x, y, candidate) ? 2 : 1;
      return samples[at] === 2;
    };
    return introAssemblyEligible({ origin: descriptor.origin, left, right, surface, solid,
      steel: (x, y) => this.steelSample(seed, chunk, x, y, candidate) });
  }
  growthPlan(seed, chunk) {
    const key = keyFor(seed, chunk), cached = this.growthPlans.get(key); if (cached) return cached;
    const descriptor = this.describe(seed, chunk), pattern = this.patterns[mix(descriptor.phaseCode ^ descriptor.code) % this.patterns.length];
    const route = this.routes.find(route => route.id === pattern.routeId), pieces = new Map(this.pieces.map(piece => [piece.id, piece]));
    const plan = createTerrainGrowthPlan({ descriptor, pattern, route, pieces, assemblies: this.assemblySources, sourceRevision: this.sourceDescriptor?.sourceRevision || this.recipe.assetSha256 });
    if (this.growthPlans.size >= this.descriptionLimit) this.growthPlans.delete(this.growthPlans.keys().next().value);
    this.growthPlans.set(key, plan); return plan;
  }
  _activePlan(seed, chunk, state) { return state && !state.complete ? state.plan || this.growthPlan(seed, chunk) : null; }
  objectsAt(seed, chunk) { return this.describe(seed, chunk).objects; }
  _standaloneObjectEligible(piece) {
    return !this.associatedObjectIds.has(piece.id) && [TriggerTypes.TRAP, TriggerTypes.DROWN, TriggerTypes.KILL, TriggerTypes.FRYING].includes(piece.image.trigger_effect_id);
  }
  _placeObjects(seed, chunk, descriptor) {
    const { origin, code, phaseCode } = descriptor, objects = [];
    const objectCount = this.objects.length ? 1 + (phaseCode >>> 8) % 2 : 0;
    for (let i = 0; i < objectCount; i++) {
      const piece = this.objects[(chunk * 2 + i + seed % this.objects.length) % this.objects.length], image = piece.image;
      if (!this._standaloneObjectEligible(piece) || image.width > TERRAIN_CHUNK_WIDTH - 16 || image.height > TERRAIN_HEIGHT - 2) continue;
      const x = origin + 8 + ((code >>> (i * 3)) % Math.max(1, TERRAIN_CHUNK_WIDTH - image.width - 8));
      const trigger = image.trigger_effect_id;
      if (trigger === TriggerTypes.ONEWAY_LEFT || trigger === TriggerTypes.ONEWAY_RIGHT) continue;
      const role = trigger === TriggerTypes.ONEWAY_LEFT || trigger === TriggerTypes.ONEWAY_RIGHT ? 'terrain-overlay' :
        trigger === TriggerTypes.DROWN ? 'liquid' : trigger === TriggerTypes.TRAP ? 'trap' :
          trigger === TriggerTypes.KILL || trigger === TriggerTypes.FRYING ? 'hazard' :
            trigger === TriggerTypes.EXIT_LEVEL || image.animationLoop === false ? 'structure' : 'ambient';
      let floor = 0, supported = true;
      if (role !== 'ambient') for (let dx = -1; dx <= image.width; dx++) {
        const localX = x - origin + dx;
        if (localX + origin >= descriptor.gapX && localX + origin < descriptor.gapX + descriptor.gapWidth) { supported = false; break; }
        const pattern = this.patterns[mix(phaseCode ^ code) % this.patterns.length];
        if (pattern.topProfile[this._patternColumn(pattern, localX + origin)] < 0) { supported = false; break; }
        floor = Math.max(floor, this._surface(seed, chunk, localX, descriptor));
      }
      if (!supported) continue;
      const y = role === 'terrain-overlay' ? Math.min(TERRAIN_HEIGHT - image.height, floor + 4) :
        role === 'liquid' ? Math.min(TERRAIN_HEIGHT - image.height - 2, floor - 4) :
          role === 'ambient' ? 2 + (code >>> 12) % 18 : floor - image.height;
      if (y < 0) continue;
      if (['trap', 'liquid', 'hazard'].includes(role)) {
        const bounds = { x1: x + image.trigger_left, x2: x + image.trigger_left + image.trigger_width,
          y1: y + image.trigger_top, y2: y + image.trigger_top + image.trigger_height };
        const envelopeLeft = Math.min(x, bounds.x1), envelopeRight = Math.max(x + image.width, bounds.x2);
        if (![bounds.x1, bounds.x2, bounds.y1, bounds.y2].every(Number.isFinite) || bounds.x1 >= bounds.x2 || bounds.y1 >= bounds.y2 ||
            envelopeLeft < Math.max(origin + 8, PROCGEN_INTRO_SAFE_END) || envelopeRight > origin + TERRAIN_CHUNK_WIDTH - 8 ||
            bounds.y1 < 0 || bounds.y2 > TERRAIN_HEIGHT || mix(code ^ Math.imul(piece.id + 1, 0x9e3779b1)) % 1024 >= descriptor.progression.hazardThreshold) continue;
      }
      if (descriptor.assemblies.some(a => x + image.width > a.bounds.x1 - 2 && x < a.bounds.x2 + 2 && y + image.height > a.bounds.y1 - 2 && y < a.bounds.y2 + 2)) continue;
      const word = descriptor.word;
      if (word && x + image.width > origin + word.x - 2 && x < origin + word.x + word.width + 2 && y + image.height > word.y - 2 && y < word.baseline + 2) continue;
      objects.push({ piece, x, y, role, phase: code % image.frames.length, interactive: false,
        animation: trigger === TriggerTypes.TRAP || image.animationLoop === false ? 'idle' : 'loop',
        clipToTerrain: role === 'terrain-overlay', supportY: role === 'ambient' || role === 'terrain-overlay' ? null : y + image.height });
    }
    return objects;
  }
  solidSample(seed, chunk, x, y, descriptor = this.describe(seed, chunk), state = null) {
    if (x < 0 || x >= TERRAIN_CHUNK_WIDTH || y < 0 || y >= TERRAIN_HEIGHT) return false;
    const pattern = this.patterns[mix(descriptor.phaseCode ^ descriptor.code) % this.patterns.length];
    const active = this._activePlan(seed, chunk, state);
    let solid = (!active || !!state.active[active.foundationByColumn[x]]) && pattern.topProfile[this._foundationColumn(pattern, x + descriptor.origin, descriptor)] >= 0 && y >= this._surface(seed, chunk, x, descriptor);
    for (let index = 0; index < descriptor.placements.length; index++) {
      const placement = descriptor.placements[index]; if (placement.decor || active && !state.active[active.placementJobs[index]]) continue;
      const { piece } = placement, dx = x - placement.x, dy = y - placement.y;
      if (dx >= 0 && dx < piece.width && dy >= 0 && dy < piece.height && !(piece.frame[(placement.flipY ? piece.height - 1 - dy : dy) * piece.width + (placement.flip ? piece.width - 1 - dx : dx)] & 128)) solid = true;
    }
    if (this._gapVoid(descriptor, x + descriptor.origin, y)) solid = false;
    for (let index = 0; index < descriptor.objects.length; index++) {
      const object = descriptor.objects[index]; if (object.role !== 'liquid' || active && !state.active[active.objectJobs[index]]) continue;
      const dx = x + descriptor.origin - object.x, bottom = object.y + object.piece.image.height;
      if (dx >= 0 && dx < object.piece.image.width && y >= object.y) solid = y >= bottom;
      else if ((dx === -1 || dx === object.piece.image.width) && y >= object.y) solid = true;
    }
    return solid;
  }
  _patternColumn(pattern, worldX) {
    const x = worldX % pattern.width;
    return worldX < PROCGEN_INTRO_SAFE_END ? pattern.introColumns[x] : x;
  }
  _foundationColumn(pattern, worldX, descriptor) {
    const column = this._patternColumn(pattern, worldX);
    return descriptor.gapFloor != null && worldX >= descriptor.gapX && worldX < descriptor.gapX + descriptor.gapWidth && pattern.topProfile[column] < 0 ? pattern.introColumns[column] : column;
  }
  _gapVoid(descriptor, worldX, y) {
    return worldX >= descriptor.gapX && worldX < descriptor.gapX + descriptor.gapWidth && (descriptor.gapFloor == null || y < descriptor.gapFloor);
  }
  _elevation(seed, node) {
    const progression = progressionAt(node * TERRAIN_CHUNK_WIDTH), code = this._code(seed ^ 0xc2b2ae35, node);
    return progression.difficulty >= 1 ? 40 + code % 39 : 72 - code % (progression.elevationRange + 1);
  }
  _surface(seed, chunk, x, descriptor) {
    if (chunk === 0 && x < 64) return 72;
    const { left, right, middle } = descriptor;
    // Flat shelves, abrupt climbable faces and gentle connecting slopes all
    // share exact boundary elevations, including transitions between phases.
    if (x < 24) return left;
    if (x < 48) return descriptor.code & 4 ? middle : Math.round(left + (middle - left) * (x - 24) / 24);
    if (x < 88) return middle;
    if (x < 112) return descriptor.code & 8 ? right : Math.round(middle + (right - middle) * (x - 88) / 24);
    return right;
  }
  _compose(seed, chunk, raster) {
    const start = globalThis.performance?.now?.() || 0;
    const d = this.describe(seed, chunk), width = TERRAIN_CHUNK_WIDTH, height = TERRAIN_HEIGHT;
    const pattern = this.patterns[mix(d.phaseCode ^ d.code) % this.patterns.length];
    const solid = new Uint32Array(width * height / 32), steel = new Uint32Array(solid.length);
    const pixels = raster ? new Uint32Array(width * height) : null;
    const topProfile = new Int16Array(width); topProfile.fill(-1);
    const stamp = ({ piece, x: ox, y: oy, flip, flipY, decor }) => {
      const image = piece.image, source = piece.frame || image.frames[0], sw = image.width, sh = image.height;
      for (let y = Math.max(0, -oy); y < Math.min(sh, height - oy); y++) for (let x = Math.max(0, -ox); x < Math.min(sw, width - ox); x++) {
        const sourceIndex = (flipY ? sh - 1 - y : y) * sw + (flip ? sw - 1 - x : x), ci = source[sourceIndex];
        if (ci & 128) continue;
        const index = (y + oy) * width + x + ox, bit = 1 << (index & 31), at = index >>> 5;
        if (decor) { if (pixels && !(solid[at] & bit)) pixels[index] = piece.rgba?.[sourceIndex] || opaque(image.palette.getColor(ci)); }
        else {
          solid[at] |= bit;
          if (piece.isSteel) steel[at] |= bit;
          if (pixels) pixels[index] = piece.rgba?.[sourceIndex] || opaque(image.palette.getColor(ci));
        }
      }
    };
    // Column-shift an independently selected source motif onto this chunk's
    // elevation profile, extending its opaque columns into connected foundations.
    for (let x = 0; x < width; x++) {
      const px = this._foundationColumn(pattern, x + d.origin, d), top = pattern.topProfile[px];
      if (top < 0) continue;
      const surface = this._surface(seed, chunk, x, d);
      for (let y = surface; y < height; y++) {
        const index = y * width + x;
        solid[index >>> 5] |= 1 << (index & 31);
        if (pixels) pixels[index] = pattern.columnColors[px * height + y - surface];
      }
    }
    for (const placement of d.placements) if (!placement.decor) stamp(placement);
    if (d.gapWidth) for (let x = d.gapX - d.origin; x < d.gapX - d.origin + d.gapWidth; x++) for (let y = 0; y < (d.gapFloor ?? height); y++) {
      const index = y * width + x;
      solid[index >>> 5] &= ~(1 << (index & 31)); steel[index >>> 5] &= ~(1 << (index & 31));
      if (pixels) pixels[index] = 0;
    }
    for (const object of d.objects) if (object.role === 'liquid') {
      const left = object.x - d.origin, right = left + object.piece.image.width, bottom = object.y + object.piece.image.height;
      for (let x = left - 1; x <= right; x++) for (let y = object.y; y < height; y++) {
        const index = y * width + x, bit = 1 << (index & 31), at = index >>> 5;
        if (x >= left && x < right && y < bottom) { solid[at] &= ~bit; steel[at] &= ~bit; if (pixels) pixels[index] = 0; }
        else { solid[at] |= bit; if (pixels) pixels[index] = pattern.columnColors[this._patternColumn(pattern, x + d.origin) * height + Math.max(0, y - this._surface(seed, chunk, x, d))]; }
      }
    }
    if (pixels) for (const placement of d.placements) if (placement.decor) stamp(placement);
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const index = y * width + x;
      if (solid[index >>> 5] & (1 << (index & 31))) { topProfile[x] = y; break; }
    }
    const result = { ...d, solid, steel, topProfile, pixels };
    const ms = (globalThis.performance?.now?.() || start) - start;
    this.generationSamples[this.generationSampleCount++ % this.generationSamples.length] = ms;
    this.stats.generationMs += ms; this.stats.maxGenerationMs = Math.max(this.stats.maxGenerationMs, ms);
    return result;
  }
  rasterSample(seed, chunk, x, y, descriptor = this.describe(seed, chunk), state = null) {
    if (x < 0 || x >= TERRAIN_CHUNK_WIDTH || y < 0 || y >= TERRAIN_HEIGHT) return 0;
    const pattern = this.patterns[mix(descriptor.phaseCode ^ descriptor.code) % this.patterns.length];
    const px = this._foundationColumn(pattern, x + descriptor.origin, descriptor), surface = this._surface(seed, chunk, x, descriptor);
    const active = this._activePlan(seed, chunk, state);
    let solid = (!active || !!state.active[active.foundationByColumn[x]]) && pattern.topProfile[px] >= 0 && y >= surface;
    let color = solid ? pattern.columnColors[px * TERRAIN_HEIGHT + y - surface] : 0;
    const pieceColor = placement => {
      const piece = placement.piece, dx = x - placement.x, dy = y - placement.y;
      if (dx < 0 || dx >= piece.width || dy < 0 || dy >= piece.height) return 0;
      const ci = piece.frame[(placement.flipY ? piece.height - 1 - dy : dy) * piece.width + (placement.flip ? piece.width - 1 - dx : dx)];
      return ci & 128 ? 0 : piece.rgba?.[(placement.flipY ? piece.height - 1 - dy : dy) * piece.width + (placement.flip ? piece.width - 1 - dx : dx)] || opaque(piece.image.palette.getColor(ci));
    };
    for (let index = 0; index < descriptor.placements.length; index++) {
      const placement = descriptor.placements[index]; if (placement.decor || active && !state.active[active.placementJobs[index]]) continue;
      const stamped = pieceColor(placement); if (stamped) { color = stamped; solid = true; }
    }
    if (this._gapVoid(descriptor, x + descriptor.origin, y)) { color = 0; solid = false; }
    for (let index = 0; index < descriptor.objects.length; index++) {
      const object = descriptor.objects[index]; if (object.role !== 'liquid' || active && !state.active[active.objectJobs[index]]) continue;
      const dx = x + descriptor.origin - object.x, bottom = object.y + object.piece.image.height;
      if (y >= object.y && dx >= -1 && dx <= object.piece.image.width) {
        solid = dx < 0 || dx === object.piece.image.width || y >= bottom;
        color = solid ? pattern.columnColors[px * TERRAIN_HEIGHT + Math.max(0, y - surface)] : 0;
      }
    }
    if (!solid) for (let index = 0; index < descriptor.placements.length; index++) {
      const placement = descriptor.placements[index]; if (placement.decor && (!active || state.active[active.placementJobs[index]])) color = pieceColor(placement) || color;
    }
    return color;
  }
  steelSample(seed, chunk, x, y, descriptor = this.describe(seed, chunk), state = null) {
    if (x < 0 || x >= TERRAIN_CHUNK_WIDTH || y < 0 || y >= TERRAIN_HEIGHT || this._gapVoid(descriptor, x + descriptor.origin, y)) return false;
    const active = this._activePlan(seed, chunk, state);
    let steel = false;
    for (let index = 0; index < descriptor.placements.length; index++) {
      const p = descriptor.placements[index]; if (p.decor || !p.piece.isSteel || active && !state.active[active.placementJobs[index]]) continue;
      const dx = x - p.x, dy = y - p.y, piece = p.piece;
      if (dx >= 0 && dy >= 0 && dx < piece.width && dy < piece.height && !(piece.frame[(p.flipY ? piece.height - 1 - dy : dy) * piece.width + (p.flip ? piece.width - 1 - dx : dx)] & 128)) steel = true;
    }
    for (let index = 0; index < descriptor.objects.length; index++) {
      const object = descriptor.objects[index]; if (object.role !== 'liquid' || active && !state.active[active.objectJobs[index]]) continue;
      if (x + descriptor.origin >= object.x && x + descriptor.origin < object.x + object.piece.image.width && y >= object.y && y < object.supportY) return false;
    }
    return steel;
  }
  getChunk(seed, chunk, raster = false) {
    const key = keyFor(seed, chunk);
    let result = key === this._lastKey ? this._lastChunk : this.collision.get(key);
    let pixels = raster && this.rasters.get(key);
    if (!result || raster && !pixels) {
      const composed = this._compose(seed, chunk, raster), composedPixels = composed.pixels;
      if (!result) {
        result = composed; result.pixels = null;
        while (this.collision.size >= this.collisionLimit) { this.collision.delete(this.collision.keys().next().value); this.stats.evicted++; }
        this.collision.set(key, result); this.stats.generated++;
        const pattern = this.patterns[mix(result.phaseCode ^ result.code) % this.patterns.length];
        for (const p of pattern.placements) this.selectedTerrainIds.add(p.id);
        this.stats.assemblyPlacements += result.assemblies.length;
        for (const p of result.placements) {
          if (p.canonicalGroup) { this.stats.canonicalGroups++; this.stats.canonicalSourcePlacements += p.canonicalGroup.placements.length; for (const source of p.canonicalGroup.placements) this.selectedTerrainIds.add(source.id); }
          else this.selectedTerrainIds.add(p.piece.id);
          this.stats[p.decor ? 'decorPlacements' : 'groundPlacements']++;
        }
        for (const p of result.objects) { this.selectedObjectIds.add(p.piece.id); this.stats.objectPlacements++; }
      }
      if (raster) {
        pixels = composedPixels;
        while (this.rasters.size >= this.rasterLimit) this.rasters.delete(this.rasters.keys().next().value);
        this.rasters.set(key, pixels); this.stats.rasterized++;
      }
    }
    this._lastKey = key; this._lastChunk = result;
    return raster ? { ...result, pixels } : result;
  }
  collisionAt(seed, x, y, steel = false) {
    if (x < 0 || y < 0 || y >= TERRAIN_HEIGHT) return false;
    const p = this.getChunk(seed, Math.floor(x / TERRAIN_CHUNK_WIDTH));
    const index = y * TERRAIN_CHUNK_WIDTH + x % TERRAIN_CHUNK_WIDTH;
    return !!((steel ? p.steel : p.solid)[index >>> 5] & (1 << (index & 31)));
  }
  surface(seed, x) { return this.getChunk(seed, Math.floor(x / TERRAIN_CHUNK_WIDTH)).topProfile[x % TERRAIN_CHUNK_WIDTH]; }
  isFlat(seed, x) { const y = this.surface(seed, x); return y >= 0 && this.surface(seed, x + 8) === y; }
  sample(seed, x, y) {
    if (x < 0 || y < 0 || y >= TERRAIN_HEIGHT) return 0;
    const p = this.getChunk(seed, Math.floor(x / TERRAIN_CHUNK_WIDTH), true);
    return p.pixels[y * TERRAIN_CHUNK_WIDTH + x % TERRAIN_CHUNK_WIDTH];
  }
  barrier() { return 0; }
  getDebugState() {
    const samples = this.generationSamples.slice(0, Math.min(this.generationSampleCount, this.generationSamples.length)).sort();
    const percentile = fraction => samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))] || 0;
    return { ...this.stats, chunkMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) }, cachedCollisionChunks: this.collision.size, cachedRasterChunks: this.rasters.size,
      collisionLimit: this.collisionLimit, rasterLimit: this.rasterLimit, memoryMB: this.memoryMB,
      terrainVocabularyUsed: this.selectedTerrainIds.size, terrainVocabularyAvailable: this.eligibleTerrainIds.size, terrainCatalogAvailable: this.pieces.length,
      wordGlyphsAvailable: this.wordPlanner?.glyphs.size || 0, wordChoicesAvailable: this.wordPlanner?.choices.length || 0,
      canonicalDescriptor: this.sourceDescriptor?.id || null, canonicalGroupsAvailable: this.sourceGroups.size, cachedDescriptions: this.descriptions.size, cachedZones: this.zonePlanner?.cache.size || 0,
      objectVocabularyUsed: this.selectedObjectIds.size, objectVocabularyAvailable: this.eligibleObjectIds.size, assemblyCatalogRevision: this.assemblyCatalog?.sourceRevision || null, assembliesAvailable: this.compiledAssemblies.length, associatedTerrainIds: [...this.associatedTerrainIds], associatedObjectIds: [...this.associatedObjectIds], objectCatalogAvailable: this.objects.length, phaseChunks: PHASE_CHUNKS }; }
}
export { ProcgenRecipeTerrain, TERRAIN_CHUNK_WIDTH, TERRAIN_HEIGHT };
