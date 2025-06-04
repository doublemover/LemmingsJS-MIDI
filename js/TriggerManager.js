import { Lemmings } from './LemmingsNamespace.js';

/*  TriggerManager
 *  ───────────────
 *  Public API:
 *      constructor(gameTimer, [levelW, levelH, cellSize])
 *      add(trigger)
 *      addRange(triggerArray)
 *      removeByOwner(owner)
 *      trigger(x, y)           → TriggerTypes enum
 *      renderDebug(gameDisplay)
 *
 *  • Grid cell size defaults to 16 px (power-of-two → shift 4)
 *  • Grid columns/rows are computed from levelW / levelH on construction
 *  • All indices are clamped, so out-of-bounds writes are impossible
 */

class TriggerManager {
  /**
   * @param {Lemmings.GameTimer} gameTimer
   * @param {number}  [levelW=1600]   – level width in pixels (inclusive)
   * @param {number}  [levelH=160]    – level height in pixels (inclusive)
   * @param {number}  [cellSize=16]   – grid cell size, must be power of two
   */
  constructor (gameTimer, levelW = 1600, levelH = 160, cellSize = 16) {
    /* store basics */
    this.gameTimer = gameTimer;
    this._cellSize = cellSize;
    this._shift    = Math.log2(cellSize) | 0;   // integer shift
    this._levelW   = levelW;
    this._levelH   = levelH;

    /* derive grid */
    this._cols   = (levelW  >> this._shift) + 1;   // e.g. 1600 → 101
    this._rows   = (levelH  >> this._shift) + 1;   // e.g.  160 → 11
    const slots  = this._cols * this._rows;

    this._grid   = Array.from({length: slots}, () => new Set());

    this._triggers = new Set();

    /* debug bookkeeping */
    this._lastCheckTick = new Uint32Array(slots);
    this._lastHitTick   = new Uint32Array(slots);

    /* handy bounds */
    this._maxX = levelW;
    this._maxY = levelH;

    /** @type {Lemmings.Frame|null} prebuilt debug overlay */
    this._debugFrame = null;

    this._debugFrame = null;
    if (arr.length) this._debugFrame = null;
    this._debugFrame = null;
    if (!this._debugFrame) this.#buildDebugFrame();
    g.drawFrame(this._debugFrame, 0, 0);
  #buildDebugFrame() {
    const frame = new Lemmings.Frame(this._levelW, this._levelH);
    const color = Lemmings.ColorPalette.colorFromRGB(255, 0, 0);
    for (const tr of this._triggers) {
      if (tr.type === 7 || tr.type === 8) continue; // arrows handled elsewhere
      frame.drawRect(tr.x1, tr.y1, tr.x2 - tr.x1, tr.y2 - tr.y1, color);
    }
    this._debugFrame = frame;
  }


    this._debugFrame = null;
  }

    this._debugFrame = null;
  /* ───────────────────────── public API ───────────────────────── */

  /** Register a single trigger */
  add (trigger) {
    if (this._triggers.has(trigger)) return;
    this._triggers.add(trigger);
    this.#insert(trigger);
    this._debugFrame = null;
  }

  /** Bulk-add (used by Level on load) */
  addRange (arr) {
    for (let i = 0; i < arr.length; ++i) this.add(arr[i]);
    if (arr.length) this._debugFrame = null;
  }

  /** Remove every trigger that belongs to `owner` */
  removeByOwner (owner) {
    if (!this._triggers) return;
    for (const tr of this._triggers) {
      if (tr.owner === owner) this.#remove(tr);
    }
    this._debugFrame = null;
  }

  /**
   * Query at pixel (x,y).  Returns a value from Lemmings.TriggerTypes
   */
  trigger (x, y) {
    if (x < 0 || y < 0 || x > this._maxX || y > this._maxY) {
      return Lemmings.TriggerTypes.NO_TRIGGER;
    }

    const bucket =
      ( (y >> this._shift) * this._cols ) +
      (  x >> this._shift);

    const cell = this._grid[bucket];
    const tick = this.gameTimer.getGameTicks();

    this._lastCheckTick[bucket] = tick;

    for (const trig of cell) {
      const val = trig.trigger(x, y, tick);
      if (val !== Lemmings.TriggerTypes.NO_TRIGGER) {
        this._lastHitTick[bucket] = tick;
        return val;
      }
    }
    return Lemmings.TriggerTypes.NO_TRIGGER;
  }

  /** Draw rectangles in debug overlay */
  renderDebug (g) {
    const cs   = this._cellSize;
    const tick = this.gameTimer.getGameTicks();
    for (let r = 0; r < this._rows; ++r) {
      const base = r * this._cols;
      for (let c = 0; c < this._cols; ++c) {
        const idx = base + c;
        if (this._lastHitTick[idx] === tick) {
          g.drawRect(c * cs, r * cs, cs - 1, cs - 1, 255, 0, 0);
        } else if (this._lastCheckTick[idx] === tick) {
          g.drawRect(c * cs, r * cs, cs - 1, cs - 1, 255, 255, 255);
        } else if (this._grid[idx].size === 0) {
          g.drawRect(c * cs, r * cs, cs - 1, cs - 1, 128, 128, 128);
        } else {
          g.drawRect(c * cs, r * cs, cs - 1, cs - 1, 0, 0, 255);
        }
      }
    }
    if (!this._debugFrame) this.#buildDebugFrame();
    g.drawFrame(this._debugFrame, 0, 0);
  }

  /* ────────────────────── internal helpers ────────────────────── */

  #buildDebugFrame() {
    const frame = new Lemmings.Frame(this._levelW, this._levelH);
    const color = Lemmings.ColorPalette.colorFromRGB(255, 0, 0);
    for (const tr of this._triggers) {
      if (tr.type === 7 || tr.type === 8) continue; // arrows handled elsewhere
      frame.drawRect(tr.x1, tr.y1, tr.x2 - tr.x1, tr.y2 - tr.y1, color);
    }
    this._debugFrame = frame;
  }

  #insert (trigger) {
    /* normalise & clamp bounds */
    let x0 = Math.max(0, Math.min(this._maxX, Math.min(trigger.x1, trigger.x2)));
    let x1 = Math.max(0, Math.min(this._maxX, Math.max(trigger.x1, trigger.x2)));
    let y0 = Math.max(0, Math.min(this._maxY, Math.min(trigger.y1, trigger.y2)));
    let y1 = Math.max(0, Math.min(this._maxY, Math.max(trigger.y1, trigger.y2)));

    const c0 = x0 >> this._shift;
    const c1 = x1 >> this._shift;
    const r0 = y0 >> this._shift;
    const r1 = y1 >> this._shift;

    const buckets = new Set();
    for (let r = r0; r <= r1; ++r) {
      const base = r * this._cols;
      for (let c = c0; c <= c1; ++c) {
        const idx = base + c;
        this._grid[idx].add(trigger);
        buckets.add(idx);
      }
    }
    trigger.__bucketIndices = buckets;   // fast removal
  }

  #remove (trigger) {
    this._triggers.delete(trigger);
    const buckets = trigger.__bucketIndices;
    if (buckets) {
      for (const idx of buckets) {
        const arr = this._grid[idx];

        arr.delete(trigger);
      }
    }
    delete trigger.__bucketIndices;
    this._debugFrame = null;
  }

  dispose() {
    this.gameTimer = null;
    this._grid   = null;
    this._triggers = null;
    this._debugFrame = null;
  }
}

Lemmings.TriggerManager = TriggerManager;
export { TriggerManager };
