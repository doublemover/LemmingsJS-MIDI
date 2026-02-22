import { ColorPalette } from '../render/ColorPalette.js';
import { Frame } from '../render/Frame.js';
import { TriggerTypes } from './TriggerTypes.js';
import { getAppContext } from '../core/dependencies.js';
const canMeasurePerformance = () => (typeof performance !== 'undefined' &&
  typeof performance.now === 'function' &&
  typeof performance.measure === 'function');

const TRIGGER_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'TriggerManager',
    trackGroup: 'Game State',
    color: 'secondary-light',
    tooltipText: 'trigger'
  })
});

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
   * @param {GameTimer} gameTimer
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

    this._grid   = Array.from({length: slots}, () => []);

    this._triggers = new Set();
    this._ownerTriggers = new Map();

    /* debug bookkeeping */
    this._lastCheckTick = new Uint32Array(slots);
    this._lastHitTick   = new Uint32Array(slots);

    /* handy bounds */
    this._maxX = levelW;
    this._maxY = levelH;

    /** @type {Frame|null} prebuilt debug overlay */
    this._debugFrame = null;
  }

  /* ───────────────────────── public API ───────────────────────── */

  /** Register a single trigger */
  add (trigger) {
    if (this._triggers.has(trigger)) return;
    this._triggers.add(trigger);
    const owner = trigger.owner ?? null;
    if (owner) {
      let list = this._ownerTriggers.get(owner);
      if (!list) {
        list = [];
        this._ownerTriggers.set(owner, list);
      }
      list.push(trigger);
    }
    this.#insert(trigger);
    this._debugFrame = null;
    const history = getAppContext()?.game?.history ?? null;
    if (history?.recordTriggerAdd) {
      history.recordTriggerAdd(trigger, {
        type: trigger.type,
        x1: trigger.x1,
        y1: trigger.y1,
        x2: trigger.x2,
        y2: trigger.y2,
        disableTicksCount: trigger.disableTicksCount,
        soundIndex: trigger.soundIndex,
        ownerId: trigger.owner?.id ?? null
      });
    }
  }

  /** Bulk-add (used by Level on load) */
  addRange (arr) {
    for (let i = 0; i < arr.length; ++i) this.add(arr[i]);
    if (arr.length) this._debugFrame = null;
  }

  /** Remove every trigger that belongs to `owner` */
  removeByOwner (owner) {
    if (!this._triggers) return;
    const list = this._ownerTriggers.get(owner);
    if (list?.length) {
      // #remove uses swap-pop on owner buckets; iterate over a stable snapshot
      // so owners with multiple triggers cannot skip entries mid-removal.
      const owned = list.slice();
      for (let i = 0; i < owned.length; i += 1) {
        this.#remove(owned[i]);
      }
      return;
    }
    for (const tr of this._triggers) {
      if (tr.owner === owner) {
        this.#remove(tr);
      }
    }
    this._debugFrame = null;
  }

  /**
   * Query at pixel (x,y).  Returns a value from TriggerTypes
   */
  trigger (x, y, lemming = null, tickOverride = null) {
    const app = getAppContext();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (x < 0 || y < 0 || x > this._maxX || y > this._maxY) {
        return TriggerTypes.NO_TRIGGER;
      }

      const bucket =
        ((y >> this._shift) * this._cols) +
        (x >> this._shift);

      const cell = this._grid[bucket];
      const tick = Number.isFinite(tickOverride)
        ? Math.trunc(tickOverride)
        : this.gameTimer.getGameTicks();

      this._lastCheckTick[bucket] = tick;

      for (let i = 0; i < cell.length; i += 1) {
        const trig = cell[i];
        const val = trig.trigger(x, y, tick, lemming);
        if (val !== TriggerTypes.NO_TRIGGER) {
          this._lastHitTick[bucket] = tick;
          return val;
        }
      }
      return TriggerTypes.NO_TRIGGER;
    } finally {
      if (perfEnabled) {
        try {
          performance.measure('TriggerManager trigger', {
            start: perfStart,
            detail: TRIGGER_MEASURE_DETAIL
          });
        } catch {
          /* ignored */
        }
      }
    }
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
        } else if (this._grid[idx].length === 0) {
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
    const frame = new Frame(this._levelW, this._levelH);
    const color = ColorPalette.colorFromRGB(255, 0, 0);
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

    const bucketCount = (r1 - r0 + 1) * (c1 - c0 + 1);
    const buckets = new Array(bucketCount);
    const bucketPositions = new Array(bucketCount);
    let bucketIndex = 0;
    for (let r = r0; r <= r1; ++r) {
      const base = r * this._cols;
      for (let c = c0; c <= c1; ++c) {
        const idx = base + c;
        const cell = this._grid[idx];
        const insertPos = cell.length;
        cell.push(trigger);
        buckets[bucketIndex++] = idx;
        bucketPositions[bucketIndex - 1] = insertPos;
      }
    }
    trigger.__bucketIndices = buckets;   // fast removal
    trigger.__bucketCellPositions = bucketPositions;
  }

  #remove (trigger) {
    this._triggers.delete(trigger);
    const buckets = trigger.__bucketIndices;
    const bucketPositions = trigger.__bucketCellPositions;
    if (buckets) {
      for (let i = 0; i < buckets.length; i += 1) {
        const idx = buckets[i];
        const cell = this._grid[idx];
        if (!cell?.length) continue;

        let pos = Number.isFinite(bucketPositions?.[i]) ? bucketPositions[i] : -1;
        const last = cell.length - 1;
        if (pos < 0 || pos > last || cell[pos] !== trigger) {
          pos = -1;
          for (let j = last; j >= 0; j -= 1) {
            if (cell[j] === trigger) {
              pos = j;
              break;
            }
          }
          if (pos < 0) continue;
        }

        if (pos !== last) {
          // Maintain O(1) removals by moving the tail trigger into the removed
          // slot and updating its cached position metadata for this bucket.
          const swapped = cell[last];
          cell[pos] = swapped;
          const swappedBuckets = swapped?.__bucketIndices;
          const swappedPositions = swapped?.__bucketCellPositions;
          if (swappedBuckets && swappedPositions) {
            for (let j = 0; j < swappedBuckets.length; j += 1) {
              if (swappedBuckets[j] !== idx) continue;
              if (swappedPositions[j] !== last) continue;
              swappedPositions[j] = pos;
              break;
            }
          }
        }
        cell.length = last;
      }
    }
    const owner = trigger.owner ?? null;
    if (owner) {
      const ownerList = this._ownerTriggers.get(owner);
      if (ownerList?.length) {
        for (let i = ownerList.length - 1; i >= 0; i -= 1) {
          if (ownerList[i] !== trigger) continue;
          const last = ownerList.length - 1;
          if (i !== last) ownerList[i] = ownerList[last];
          ownerList.length = last;
          break;
        }
        if (ownerList.length === 0) {
          this._ownerTriggers.delete(owner);
        }
      }
    }
    const history = getAppContext()?.game?.history ?? null;
    if (history?.recordTriggerRemove) {
      history.recordTriggerRemove(trigger, {
        type: trigger.type,
        x1: trigger.x1,
        y1: trigger.y1,
        x2: trigger.x2,
        y2: trigger.y2,
        disableTicksCount: trigger.disableTicksCount,
        soundIndex: trigger.soundIndex,
        ownerId: trigger.owner?.id ?? null
      });
    }
    delete trigger.__bucketIndices;
    delete trigger.__bucketCellPositions;
    this._debugFrame = null;
  }

  dispose() {
    this.gameTimer = null;
    this._grid   = null;
    this._triggers = null;
    this._ownerTriggers = null;
    this._debugFrame = null;
  }
}

export { TriggerManager };
