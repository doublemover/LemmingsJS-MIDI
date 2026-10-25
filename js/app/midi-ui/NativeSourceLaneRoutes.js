import { createSmoothedAudioParameter } from './SmoothedAudioParameter.js';
import { createProcgenRetirementScope } from '../procgen/ProcgenRetirement.js';
import { releaseAudioResourceAfterRetirement } from './AudioResourceLeases.js';

const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 160;
export function createNativeSourceLaneRoutes({ context, resources, owner, generation, laneId, pre, post, start = context.currentTime,
  onAdd = () => {}, onRemove = () => {} }) {
  if (!context?.createGain || !resources?.reserve || !validId(laneId) || !pre?.connect || !post?.connect || !Number.isFinite(start) || start < 0 ||
      !Number.isFinite(context.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 384000 || typeof onAdd !== 'function' || typeof onRemove !== 'function') throw new TypeError('Invalid native source lane owner.');
  const paths = new Map(), fade = 0.008;
  let plannedLane = laneId, frontier = -Infinity, disposed = false;
  const retirePath = path => {
    const receipt = path.retirement.retire([
      { name: 'lane-consumers', run: () => onRemove(path.laneId) },
      { name: 'pre-source', run: () => { if (path.preConnected) { pre.disconnect(path.pre); path.preConnected = false; } } },
      { name: 'post-source', run: () => { if (path.postConnected) { post.disconnect(path.post); path.postConnected = false; } } },
      { name: 'pre-route', run: () => path.pre?.disconnect() }, { name: 'post-route', run: () => path.post?.disconnect() }
    ]);
    try { releaseAudioResourceAfterRetirement(path.lease, receipt); } catch (error) { error.retainedRoute = path; throw error; }
    if (receipt.outcome !== 'complete') throw new Error('Native lane route retirement remains unresolved.');
    paths.delete(path.laneId);
  };
  const prune = () => { for (const path of paths.values()) if (path.retireAfter <= context.currentTime) retirePath(path); };
  const add = (id, value) => {
    const lease = resources.reserve({ kind: 'native-source-lane-route', owner, generation, estimateBytes: 16384, consumerOwned: true });
    const path = { laneId: id, lease, retirement: createProcgenRetirementScope(), pre: null, post: null, preConnected: false, postConnected: false, retireAfter: Infinity };
    paths.set(id, path);
    try {
      path.pre = context.createGain(); path.post = context.createGain();
      path.preCurve = createSmoothedAudioParameter({ param: path.pre.gain, initialValue: value, startTime: start, maxEvents: 16 });
      path.postCurve = createSmoothedAudioParameter({ param: path.post.gain, initialValue: value, startTime: start, maxEvents: 16 });
      pre.connect(path.pre); path.preConnected = true; post.connect(path.post); path.postConnected = true; onAdd(id);
      return path;
    } catch (error) { try { retirePath(path); } catch (failure) { error.retirement = failure.retirement || failure; error.retainedRoute = path; } throw error; }
  };
  try { add(laneId, 1); } catch (error) { disposed = true; throw error; }
  return Object.freeze({
    pathFor: id => paths.get(id) || null,
    schedule(id, frame) {
      if (disposed || !validId(id) || !Number.isSafeInteger(frame) || frame < 0) return false;
      const now = context.currentTime, time = Math.max(start, now, frame / context.sampleRate);
      if (id === plannedLane) return true;
      prune();
      if (time < frontier || !paths.has(id) && paths.size >= 8 || [...paths.values()].some(path => !path.preCurve.canInsert(now) || !path.postCurve.canInsert(now))) return false;
      if (!paths.has(id)) add(id, 0);
      for (const path of paths.values()) {
        const target = path.laneId === id ? 1 : 0;
        if (!path.preCurve.insert(target, time, now, fade) || !path.postCurve.insert(target, time, now, fade)) throw new Error('Native lane route automation refused a preflighted transfer.');
        if (target) path.retireAfter = Infinity;
        else if (path.laneId === plannedLane) path.retireAfter = time + fade;
      }
      plannedLane = id; frontier = time + fade; return true;
    },
    dispose() { disposed = true; for (const path of [...paths.values()]) retirePath(path); }
  });
}
