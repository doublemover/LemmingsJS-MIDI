import { ColorPalette } from '../render/ColorPalette.js';
import { Frame } from '../render/Frame.js';
import { TriggerTypes } from './TriggerTypes.js';
import { getAppContext } from '../core/dependencies.js';
import {
  getRuntimeHistory,
  getRuntimePerformanceContext
} from '../game/GameRuntime.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../util/performanceInstrumentation.js';

const TRIGGER_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'TriggerManager',
    trackGroup: 'Game State',
    color: 'secondary-light',
    tooltipText: 'trigger'
  })
});

class TriggerManager {
  constructor(gameTimer, levelW = 1600, levelH = 160, cellSize = 16, runtime = null) {
    this.gameTimer = gameTimer;
    this.runtime = runtime;
    this._cellSize = cellSize;
    this._shift = Math.log2(cellSize) | 0;
    this._levelW = Math.max(1, Math.trunc(Number(levelW) || 1600));
    this._levelH = Math.max(1, Math.trunc(Number(levelH) || 160));

    this._cols = Math.max(1, Math.ceil(this._levelW / cellSize));
    this._rows = Math.max(1, Math.ceil(this._levelH / cellSize));
    const slots = this._cols * this._rows;

    this._grid = Array.from({ length: slots }, () => []);
    this._observerGrid = Array.from({ length: slots }, () => []);
    this._triggers = new Set();
    this._observerTriggers = new Set();
    this._ownerTriggers = new Map();
    this._ownerObserverTriggers = new Map();

    this._lastCheckTick = new Uint32Array(slots);
    this._lastHitTick = new Uint32Array(slots);

    this._maxX = this._levelW - 1;
    this._maxY = this._levelH - 1;
    this._debugFrame = null;
  }

  setRuntime(runtime = null) {
    this.runtime = runtime;
    for (const trigger of this._triggers || []) {
      trigger.runtime = runtime;
    }
    for (const trigger of this._observerTriggers || []) {
      trigger.runtime = runtime;
    }
  }

  add(trigger) {
    if (!trigger || this._triggers.has(trigger)) return;
    trigger.runtime = this.runtime;
    this._triggers.add(trigger);
    this.#addOwnerRecord(trigger, this._ownerTriggers);
    this.#insert(trigger);
    this._debugFrame = null;
    this.#recordTriggerAdd(trigger, false);
  }

  addObserver(trigger) {
    if (!trigger || this._observerTriggers.has(trigger)) return;
    trigger.runtime = this.runtime;
    this._observerTriggers.add(trigger);
    this.#addOwnerRecord(trigger, this._ownerObserverTriggers);
    this.#insert(trigger, {
      grid: this._observerGrid,
      indicesProp: '__observerBucketIndices',
      positionsProp: '__observerBucketCellPositions'
    });
    this.#recordTriggerAdd(trigger, true);
  }

  addRange(arr) {
    for (let i = 0; i < arr.length; ++i) this.add(arr[i]);
    if (arr.length) this._debugFrame = null;
  }

  remove(trigger) {
    if (this._triggers?.has(trigger)) {
      this.#remove(trigger);
      return;
    }
    if (this._observerTriggers?.has(trigger)) {
      this.#removeObserver(trigger);
    }
  }

  removeByOwner(owner) {
    if (!this._triggers) return;
    const list = this._ownerTriggers.get(owner);
    if (list?.length) {
      const owned = list.slice();
      for (let i = 0; i < owned.length; i += 1) {
        this.#remove(owned[i]);
      }
      return;
    }
    for (const trigger of this._triggers) {
      if (trigger.owner === owner) {
        this.#remove(trigger);
      }
    }
    this._debugFrame = null;
  }

  removeObserverByOwner(owner) {
    if (!this._observerTriggers) return;
    const list = this._ownerObserverTriggers.get(owner);
    if (list?.length) {
      const owned = list.slice();
      for (let i = 0; i < owned.length; i += 1) {
        this.#removeObserver(owned[i]);
      }
      return;
    }
    for (const trigger of this._observerTriggers) {
      if (trigger.owner === owner) {
        this.#removeObserver(trigger);
      }
    }
  }

  trigger(x, y, lemming = null, tickOverride = null) {
    const app = getRuntimePerformanceContext(this.runtime) || getAppContext();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      if (x < 0 || y < 0 || x > this._maxX || y > this._maxY) {
        return TriggerTypes.NO_TRIGGER;
      }

      const bucket = ((y >> this._shift) * this._cols) + (x >> this._shift);
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
          this.#runObservers(bucket, x, y, lemming, tick);
          return val;
        }
      }
      this.#runObservers(bucket, x, y, lemming, tick);
      return TriggerTypes.NO_TRIGGER;
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('TriggerManager trigger', {
          start: perfStart,
          detail: TRIGGER_MEASURE_DETAIL
        });
      }
    }
  }

  renderDebug(g) {
    const cs = this._cellSize;
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

  #buildDebugFrame() {
    const frame = new Frame(this._levelW, this._levelH);
    const color = ColorPalette.colorFromRGB(255, 0, 0);
    for (const tr of this._triggers) {
      if (tr.type === 7 || tr.type === 8) continue;
      frame.drawRect(
        tr.x1,
        tr.y1,
        Math.max(0, tr.x2 - tr.x1 - 1),
        Math.max(0, tr.y2 - tr.y1 - 1),
        color
      );
    }
    this._debugFrame = frame;
  }

  #addOwnerRecord(trigger, ownerMap) {
    const owner = trigger.owner ?? null;
    if (!owner) return;
    let list = ownerMap.get(owner);
    if (!list) {
      list = [];
      ownerMap.set(owner, list);
    }
    list.push(trigger);
  }

  #removeOwnerRecord(trigger, ownerMap) {
    const owner = trigger.owner ?? null;
    if (!owner) return;
    const ownerList = ownerMap.get(owner);
    if (!ownerList?.length) return;
    for (let i = ownerList.length - 1; i >= 0; i -= 1) {
      if (ownerList[i] !== trigger) continue;
      const last = ownerList.length - 1;
      if (i !== last) ownerList[i] = ownerList[last];
      ownerList.length = last;
      break;
    }
    if (ownerList.length === 0) {
      ownerMap.delete(owner);
    }
  }

  #triggerSnapshot(trigger, observer) {
    return {
      type: trigger.type,
      x1: trigger.x1,
      y1: trigger.y1,
      x2: trigger.x2,
      y2: trigger.y2,
      disableTicksCount: trigger.disableTicksCount,
      soundIndex: trigger.soundIndex,
      ownerId: trigger.owner?.id ?? null,
      observer
    };
  }

  #recordTriggerAdd(trigger, observer) {
    const history = getRuntimeHistory(this.runtime);
    history?.recordTriggerAdd?.(trigger, this.#triggerSnapshot(trigger, observer));
  }

  #recordTriggerRemove(trigger, observer) {
    const history = getRuntimeHistory(this.runtime);
    history?.recordTriggerRemove?.(trigger, this.#triggerSnapshot(trigger, observer));
  }

  #insert(trigger, {
    grid = this._grid,
    indicesProp = '__bucketIndices',
    positionsProp = '__bucketCellPositions'
  } = {}) {
    const x0 = Math.max(0, Math.min(this._levelW, Math.min(trigger.x1, trigger.x2)));
    const x1 = Math.max(0, Math.min(this._levelW, Math.max(trigger.x1, trigger.x2)));
    const y0 = Math.max(0, Math.min(this._levelH, Math.min(trigger.y1, trigger.y2)));
    const y1 = Math.max(0, Math.min(this._levelH, Math.max(trigger.y1, trigger.y2)));
    if (x1 <= x0 || y1 <= y0) {
      trigger[indicesProp] = [];
      trigger[positionsProp] = [];
      return;
    }

    const c0 = x0 >> this._shift;
    const c1 = (x1 - 1) >> this._shift;
    const r0 = y0 >> this._shift;
    const r1 = (y1 - 1) >> this._shift;

    const bucketCount = (r1 - r0 + 1) * (c1 - c0 + 1);
    const buckets = new Array(bucketCount);
    const bucketPositions = new Array(bucketCount);
    let bucketIndex = 0;
    for (let r = r0; r <= r1; ++r) {
      const base = r * this._cols;
      for (let c = c0; c <= c1; ++c) {
        const idx = base + c;
        const cell = grid[idx];
        const insertPos = cell.length;
        cell.push(trigger);
        buckets[bucketIndex++] = idx;
        bucketPositions[bucketIndex - 1] = insertPos;
      }
    }
    trigger[indicesProp] = buckets;
    trigger[positionsProp] = bucketPositions;
  }

  #removeFromGrid(trigger, {
    grid = this._grid,
    indicesProp = '__bucketIndices',
    positionsProp = '__bucketCellPositions'
  } = {}) {
    const buckets = trigger[indicesProp];
    const bucketPositions = trigger[positionsProp];
    if (buckets) {
      for (let i = 0; i < buckets.length; i += 1) {
        const idx = buckets[i];
        const cell = grid[idx];
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
          const swapped = cell[last];
          cell[pos] = swapped;
          const swappedBuckets = swapped?.[indicesProp];
          const swappedPositions = swapped?.[positionsProp];
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
    delete trigger[indicesProp];
    delete trigger[positionsProp];
  }

  #remove(trigger) {
    this._triggers.delete(trigger);
    this.#removeFromGrid(trigger);
    this.#removeOwnerRecord(trigger, this._ownerTriggers);
    this.#recordTriggerRemove(trigger, false);
    trigger.runtime = null;
    this._debugFrame = null;
  }

  #removeObserver(trigger) {
    this._observerTriggers.delete(trigger);
    this.#removeFromGrid(trigger, {
      grid: this._observerGrid,
      indicesProp: '__observerBucketIndices',
      positionsProp: '__observerBucketCellPositions'
    });
    this.#removeOwnerRecord(trigger, this._ownerObserverTriggers);
    this.#recordTriggerRemove(trigger, true);
    trigger.runtime = null;
  }

  #runObservers(bucket, x, y, lemming, tick) {
    const cell = this._observerGrid?.[bucket];
    if (!cell?.length) return;
    for (let i = 0; i < cell.length; i += 1) {
      cell[i].trigger(x, y, tick, lemming);
    }
  }

  dispose() {
    this.gameTimer = null;
    this._grid = null;
    this._observerGrid = null;
    this._triggers = null;
    this._observerTriggers = null;
    this._ownerTriggers = null;
    this._ownerObserverTriggers = null;
    this._debugFrame = null;
    this.runtime = null;
  }
}

export { TriggerManager };
