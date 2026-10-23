const CELL_WIDTH = 80;
const DITHER = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
const mix = value => { let n = Math.imul(value ^ (value >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) >>> 0; };

// Rendering reads these records only. Their clock and deterministic selection
// are independent of camera, collision generation and musical randomness.
class ProcgenScenery {
  constructor({ terrain, laneSeeds, laneHeight = 96, solidLead = 84, retainBehind = 1024 } = {}) {
    this.terrain = terrain; this.laneSeeds = laneSeeds; this.laneHeight = laneHeight;
    this.lead = solidLead * 2; this.retainBehind = retainBehind; this.revision = 0;
    this.catalogs = new Map(); this.reset();
  }
  reset() {
    this.tick = 0; this.nextCell = new Uint32Array(this.laneSeeds.length);
    this.entries = Array.from({ length: this.laneSeeds.length }, () => []); this.revision++;
  }
  _catalog(lane) {
    const source = this.terrain.forSeed?.(this.laneSeeds[lane]) || this.terrain;
    if (!this.catalogs.has(source)) {
      const groups = [...(source.sourceGroups?.values() || [])].map(group => group.piece);
      const pieces = groups.length ? groups : source.ingredients || source.pieces || [];
      this.catalogs.set(source, pieces.filter(piece => !piece.isSteel && piece.width <= 112 && piece.height <= this.laneHeight - 12 && piece.frame?.length));
    }
    return this.catalogs.get(source);
  }
  _piece(lane, cell) {
    const catalog = this._catalog(lane), code = mix(this.laneSeeds[lane] ^ 0x67ad281b ^ Math.imul(cell + 1, 0x9e3779b1));
    if (!catalog.length) return null;
    const piece = catalog[code % catalog.length];
    return { piece, code, x: cell * CELL_WIDTH + (code >>> 8) % 25,
      y: 3 + (code >>> 16) % Math.max(1, this.laneHeight - piece.height - 18) };
  }
  update({ frontiers, tick, paused = false, reducedMotion = false }) {
    if (paused) return false;
    if (!Number.isFinite(tick) || tick < this.tick) return false;
    this.tick = tick; let changed = false;
    for (let lane = 0; lane < this.entries.length; lane++) {
      const frontier = frontiers[lane], entries = this.entries[lane];
      if (!Number.isFinite(frontier)) continue;
      const first = Math.max(0, Math.floor((frontier - this.retainBehind) / CELL_WIDTH));
      this.nextCell[lane] = Math.max(this.nextCell[lane], first);
      const last = Math.floor((frontier + this.lead) / CELL_WIDTH);
      // A jump/restore cannot allocate an unbounded history of invisible art.
      for (let cell = this.nextCell[lane]; cell <= last; cell++) {
        const art = this._piece(lane, cell);
        if (art && art.x <= frontier + this.lead) {
          entries.push({ cell, born: tick + art.code % 13, progress: reducedMotion ? 8 : 0 });
          changed = true;
        } else if (art && cell === last) break;
        this.nextCell[lane] = cell + 1;
      }
      while (entries.length && entries[0].cell < first) { entries.shift(); changed = true; }
      for (const entry of entries) {
        const progress = reducedMotion ? 8 : Math.max(0, Math.min(8, Math.floor((tick - entry.born) / 4)));
        if (progress > entry.progress) { entry.progress = progress; changed = true; }
      }
    }
    if (changed) this.revision++;
    return changed;
  }
  drawLane({ lane, left = 0, right = Infinity, top = 0, bottom = Infinity, drawPixel, reducedMotion = false }) {
    const offset = lane * this.laneHeight;
    for (const entry of this.entries[lane] || []) {
      const progress = reducedMotion ? 8 : entry.progress;
      if (!progress) continue;
      const art = this._piece(lane, entry.cell); if (!art) continue;
      const { piece, x, y } = art;
      for (let py = Math.max(0, Math.ceil(top - offset - y)); py < piece.height && offset + y + py < bottom; py++) {
        for (let px = Math.max(0, Math.ceil(left - x)); px < piece.width && x + px < right; px++) {
          const worldX = x + px, worldY = offset + y + py;
          if (DITHER[(worldY & 3) * 4 + (worldX & 3)] >= progress) continue;
          const color = piece.frame[py * piece.width + px] >>> 0; if (!(color >>> 24)) continue;
          const r = (color & 255) >>> 2, g = (color >>> 8 & 255) >>> 2, b = (color >>> 16 & 255) >>> 2;
          drawPixel(worldX, worldY, (0xff000000 | b << 16 | g << 8 | r) >>> 0);
        }
      }
    }
  }
  snapshot() { return { version: 1, tick: this.tick, revision: this.revision, laneSeeds: [...this.laneSeeds], nextCell: [...this.nextCell], entries: this.entries.map(entries => entries.map(entry => ({ ...entry }))) }; }
  restore(data) {
    if (data?.version !== 1 || data.laneSeeds?.length !== this.laneSeeds.length || data.laneSeeds.some((seed, lane) => seed !== this.laneSeeds[lane])) throw new Error('Incompatible scenery snapshot');
    this.tick = data.tick; this.revision = data.revision; this.nextCell.set(data.nextCell);
    this.entries = data.entries.map(entries => entries.map(entry => ({ ...entry })));
  }
  dispose() { this.entries.forEach(entries => { entries.length = 0; }); this.catalogs.clear(); }
}
export { ProcgenScenery, CELL_WIDTH, DITHER };
