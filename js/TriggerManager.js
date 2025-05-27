import { Lemmings } from './LemmingsNamespace.js';

/**
 * Spatial‑grid TriggerManager.
 * Drop‑in replacement for the original O(L×T) implementation.
 *
 * — Keeps the same public API (`add`, `addRange`, `removeByOwner`, `trigger`,
 *    `renderDebug`) so callers need no changes.
 * — Uses a lazily‑built uniform grid (32px cells by default) so the
 *    per‑frame cost becomes *lemmings ×~3* AABB tests instead of
 *    *lemmings × triggers*.
 */
class TriggerManager {
  /**
   * @param {Lemmings.GameTimer} gameTimer – global tick source
   * @param {number} [cellSize=32]          – grid cell in pixels (must be pwr‑of‑2)
   */
  constructor (gameTimer, cellSize = 32) {
    this.gameTimer = gameTimer;
    this.triggers  = [];          // flat list, kept for iteration / removal

    /* grid parameters – initialised lazily by _buildGrid() */
    this._grid     = null;        // Array<Trigger[]> | null
    this._cols     = 0;
    this._rows     = 0;
    this._cellSize = cellSize;
    this._shift    = Math.log2(cellSize) | 0; // for bit‑shift instead of division
  }

  /* ────────────────────────────────────────────────────────────────────── */
  /** Insert a single trigger */
  add (trigger) {
    this.triggers.push(trigger);
    if (this._grid) this._insertIntoGrid(trigger);
  }

  /** Bulk‑add – used by `Level.setMapObjects()` */
  addRange (newTriggers) {
    for (let i = 0; i < newTriggers.length; ++i) this.triggers.push(newTriggers[i]);
    // grid will be rebuilt lazily next frame
    this._grid = null;
  }

  /** Remove every trigger whose owner matches. */
  removeByOwner (owner) {
    for (let i = this.triggers.length - 1; i >= 0; --i) {
      if (this.triggers[i].owner === owner) this.triggers.splice(i, 1);
    }
    // easiest correctness: rebuild grid on next use
    this._grid = null;
  }

  /** Debug helper – unchanged. */
  renderDebug (gameDisplay) {
    for (let i = 0; i < this.triggers.length; ++i) this.triggers[i].draw(gameDisplay);
  }

  /**
   * Query the grid at (x,y). Returns a TriggerType enum value or
   * `NO_TRIGGER` when nothing fires.
   */
  trigger (x, y) {
    const tick = this.gameTimer.getGameTicks();

    if (!this._grid) this._buildGrid();

    const c = x >> this._shift;
    const r = y >> this._shift;
    if (c < 0 || c >= this._cols || r < 0 || r >= this._rows) return Lemmings.TriggerTypes.NO_TRIGGER;

    const cell = this._grid[r * this._cols + c];
    for (let i = 0; i < cell.length; ++i) {
      const t = cell[i].trigger(x, y, tick);
      if (t !== Lemmings.TriggerTypes.NO_TRIGGER) return t;
    }
    return Lemmings.TriggerTypes.NO_TRIGGER;
  }

  /* ───────────────────────────── helpers ─────────────────────────────── */
  _buildGrid () {
    // find extents – assumes all triggers are static once level is running
    let maxX = 0, maxY = 0;
    for (let i = 0; i < this.triggers.length; ++i) {
      const tr = this.triggers[i];
      if (tr.x2 > maxX) maxX = tr.x2;
      if (tr.y2 > maxY) maxY = tr.y2;
    }

    this._cols  = (maxX >> this._shift) + 1;
    this._rows  = (maxY >> this._shift) + 1;
    const slots = this._cols * this._rows;
    this._grid  = new Array(slots);
    for (let i = 0; i < slots; ++i) this._grid[i] = [];

    // populate
    for (let i = 0; i < this.triggers.length; ++i) this._insertIntoGrid(this.triggers[i]);
  }

  _insertIntoGrid (trigger) {
    const c0 = trigger.x1 >> this._shift;
    const c1 = trigger.x2 >> this._shift;
    const r0 = trigger.y1 >> this._shift;
    const r1 = trigger.y2 >> this._shift;

    for (let r = r0; r <= r1; ++r) {
      const rowBase = r * this._cols;
      for (let c = c0; c <= c1; ++c) {
        this._grid[rowBase + c].push(trigger);
      }
    }
  }
}

Lemmings.TriggerManager = TriggerManager;
export { TriggerManager };
