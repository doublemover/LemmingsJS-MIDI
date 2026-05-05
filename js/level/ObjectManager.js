import { getAppContext } from '../core/dependencies.js';
import {
  canMeasurePerformance,
  recordPerformanceMeasure
} from '../util/performanceInstrumentation.js';

const RENDER_MEASURE_DETAIL = Object.freeze({
  devtools: Object.freeze({
    track: 'ObjectManager',
    trackGroup: 'Render',
    color: 'secondary',
    tooltipText: 'render'
  })
});

class ObjectManager {
  constructor(gameTimer) {
    this.gameTimer = gameTimer;
    this.objects = [];
    this._bucketWidth = 128;
    this._xBuckets = new Map();
    this._bucketScratch = [];
    this._unknownWidthObjects = [];
    this._renderStamp = 0;
  }

  _bucketIndexForX(x) {
    return Math.floor(x / this._bucketWidth);
  }

  _frameSizeFromObject(obj) {
    const width = Number.isFinite(obj?._frameWidth) ? obj._frameWidth : NaN;
    const height = Number.isFinite(obj?._frameHeight) ? obj._frameHeight : NaN;
    if (Number.isFinite(width) && Number.isFinite(height)) {
      return { width, height };
    }
    const frame = obj?.animation?.frames?.[0] || null;
    if (Number.isFinite(frame?.width) && Number.isFinite(frame?.height)) {
      obj._frameWidth = frame.width;
      obj._frameHeight = frame.height;
      return { width: frame.width, height: frame.height };
    }
    return null;
  }

  _addObjectToBucket(obj) {
    if (!Number.isFinite(obj?.x)) return;
    const size = this._frameSizeFromObject(obj);
    if (!size || !Number.isFinite(size.width) || size.width <= 0) {
      this._unknownWidthObjects.push(obj);
      obj.__objectManagerBuckets = null;
      return;
    }
    const startBucket = this._bucketIndexForX(obj.x);
    const endBucket = this._bucketIndexForX(obj.x + Math.max(0, size.width - 1));
    const buckets = [];
    for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
      let list = this._xBuckets.get(bucket);
      if (!list) {
        list = [];
        this._xBuckets.set(bucket, list);
      }
      list.push(obj);
      buckets.push(bucket);
    }
    obj.__objectManagerBuckets = buckets;
  }

  _moveUnknownObjectToBuckets(obj, index) {
    const size = this._frameSizeFromObject(obj);
    if (!size || !Number.isFinite(size.width) || size.width <= 0) return false;
    const last = this._unknownWidthObjects.length - 1;
    if (index !== last) this._unknownWidthObjects[index] = this._unknownWidthObjects[last];
    this._unknownWidthObjects.length = last;
    this._addObjectToBucket(obj);
    return true;
  }

  _pushBucketObject(source, obj, stamp) {
    if (obj.__objectManagerRenderStamp === stamp) return;
    obj.__objectManagerRenderStamp = stamp;
    source.push(obj);
  }

  /** render all Objects to the GameDisplay */
  render(gameDisplay) {
    const app = getAppContext();
    const perfEnabled = !!app &&
      (app.performanceAPI === true || app.perfMetrics === true) &&
      canMeasurePerformance();
    const perfStart = perfEnabled ? performance.now() : 0;
    try {
      const objs = this.objects;
      const tick = this.gameTimer.getGameTicks();
      const view = gameDisplay?.stage?.getGameViewRect?.();
      let minX = -Infinity;
      let minY = -Infinity;
      let maxX = Infinity;
      let maxY = Infinity;
      if (view) {
        const pad = 32;
        minX = view.x - pad;
        minY = view.y - pad;
        maxX = view.x + view.w + pad;
        maxY = view.y + view.h + pad;
      }
      let source = objs;
      if (view) {
        const bucketPad = this._bucketWidth;
        const startBucket = this._bucketIndexForX(minX - bucketPad);
        const endBucket = this._bucketIndexForX(maxX + bucketPad);
        source = this._bucketScratch;
        source.length = 0;
        this._renderStamp = (this._renderStamp + 1) || 1;
        const stamp = this._renderStamp;
        for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
          const list = this._xBuckets.get(bucket);
          if (!list?.length) continue;
          for (let i = 0; i < list.length; i += 1) {
            this._pushBucketObject(source, list[i], stamp);
          }
        }
        for (let i = 0; i < this._unknownWidthObjects.length;) {
          const obj = this._unknownWidthObjects[i];
          if (this._moveUnknownObjectToBuckets(obj, i)) {
            const fw = obj._frameWidth;
            if ((obj.x + fw) >= minX && obj.x <= maxX) {
              this._pushBucketObject(source, obj, stamp);
            }
            continue;
          }
          this._pushBucketObject(source, obj, stamp);
          i += 1;
        }
      }
      for (let i = 0; i < source.length; i++) {
        const obj = source[i];
        const animation = obj?.animation;
        if (!animation?.getFrame) continue;
        let fw = Number.isFinite(obj._frameWidth) ? obj._frameWidth : NaN;
        let fh = Number.isFinite(obj._frameHeight) ? obj._frameHeight : NaN;
        if (view && Number.isFinite(fw) && Number.isFinite(fh)) {
          if ((obj.x + fw) < minX || obj.x > maxX || (obj.y + fh) < minY || obj.y > maxY) {
            continue;
          }
        }
        const frame = animation.getFrame(tick + 1);
        if (!frame) continue;
        if (!Number.isFinite(fw) || !Number.isFinite(fh)) {
          fw = frame.width ?? 0;
          fh = frame.height ?? 0;
          obj._frameWidth = fw;
          obj._frameHeight = fh;
          if (view && obj.__objectManagerBuckets == null) {
            const unknownIndex = this._unknownWidthObjects.indexOf(obj);
            if (unknownIndex >= 0) {
              this._moveUnknownObjectToBuckets(obj, unknownIndex);
            }
          }
        }
        if (view) {
          if ((obj.x + fw) < minX || obj.x > maxX || (obj.y + fh) < minY || obj.y > maxY) {
            continue;
          }
        }
        gameDisplay.drawFrameFlags(frame, obj.x, obj.y, obj.drawProperties);
      }
    } finally {
      if (perfEnabled) {
        recordPerformanceMeasure('ObjectManager render', {
          start: perfStart,
          detail: RENDER_MEASURE_DETAIL
        });
      }
    }
  }
  /** add map objects to manager */
  addRange(mapObjects) {
    for (let i = 0; i < mapObjects.length; i++) {
      const obj = mapObjects[i];
      this.objects.push(obj);
      this._addObjectToBucket(obj);
    }
  }

  dispose() {
    this.objects.length = 0;
    this._xBuckets.clear();
    this._bucketScratch.length = 0;
    this._unknownWidthObjects.length = 0;
    this.gameTimer = null;
  }
}

export { ObjectManager };
