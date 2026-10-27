import { isSceneMacroAction } from './SceneMacroAction.js';
import { freezeData } from '../../../core/CanonicalData.js';

const performanceCommands = new Set(['stage', 'stageExit', 'stageGo', 'stagePlay', 'stagePause', 'scenes', 'stopOutput', 'panicOutput', 'transport', 'clearSolos', 'laneMixView',
  'performSceneMacro', 'beginMacroGesture', 'previewMacroGesture', 'finishMacroGesture', 'commitPerformedMacros', 'reconcileSoundPreview', 'cancelLearn',
  'openQuarryEcho', 'openCrossExcitation', 'openTravelColoration', 'openSpectralFreeze', 'openSympatheticMap', 'openRectangularMembrane', 'openPrelistenMonitor', 'openMasterCapture',
  'openReleaseGestures', 'performReleaseGesture', 'cancelReleaseGestures', 'openPhysicalJunctions', 'requestJunction', 'cancelJunctionRequest',
  'captureInterventionLayer', 'markCausalTake', 'rearmPhysicalMusic', 'retryDisplay', 'observe', 'disarmPhysicalFeedback', 'disarmCausalBranchFeedback',
  'cancelCausalWorkbench', 'cancelProjectPicker', 'cancelExportDelivery', 'discardExport', 'historyBusy', 'historyState', 'preferences']);
const mixFields = new Set(['gain', 'pan', 'mute', 'solo', 'instrumentControls']);
export function createPerformanceStageSession({ canEnter = () => true, getIdentity, setPresentation, getCandidate = () => null, applyCandidate, cancelCandidate = async () => {}, onStatus = () => {} } = {}) {
  if (typeof getIdentity !== 'function' || typeof setPresentation !== 'function' || typeof applyCandidate !== 'function') throw new TypeError('Stage mode needs the current document and the existing prepared scene owner.');
  let active = false, disposed = false, enteringIdentity = null, applying = false;
  const state = () => freezeData({ schema: 'lemmings-performance-stage/v1', active, disposed, enteringIdentity, applying,
    transitionPolicy: 'stopped-replacement', resumeChoice: 'paused;explicit-Play-required', prepared: getCandidate()?.prepared?.preflight?.sceneHash || null });
  const reject = () => { try { onStatus('Exit stage mode to change the score, world, file or routing configuration.'); } catch {} return false; };
  return Object.freeze({ state, active: () => active,
    enter() { if (disposed || active) return false; if (!canEnter()) { try { onStatus('Finish the current world or authoring operation before entering stage mode.'); } catch {} return false; }
      enteringIdentity = getIdentity(); setPresentation(true); active = true; return state(); },
    permitsCommand(name, args = []) { if (!active) return true;
      if (name === 'operationalState') return true;
      if (name === 'recoverOperational') return ['play', 'exit-stage', 'discover'].includes(args[0]);
      if (!performanceCommands.has(name)) return false;
      return name !== 'transport' || args[0] && Object.getPrototypeOf(args[0]) === Object.prototype && Object.keys(args[0]).every(key => ['bpm', 'gameSpeed', 'speedMode', 'linked'].includes(key)); },
    permitsEdit(action) { return !active || isSceneMacroAction(action) || action?.type === 'procgen/lane' && action.patch && Object.getPrototypeOf(action.patch) === Object.prototype && Object.keys(action.patch).length > 0 && Object.keys(action.patch).every(key => mixFields.has(key)); },
    reject,
    async go() { const candidate = getCandidate(); if (!active || disposed || applying || candidate?.canApply !== true || candidate?.phase !== 'ready') { try { onStatus('Prepare the exact NEXT scene against the current document before GO.'); } catch {} return false; }
      applying = true;
      try { const result = await applyCandidate(); if (result.status === 'committed') { enteringIdentity = getIdentity(); try { onStatus('NEXT loaded as a stopped replacement. Press Play explicitly to continue.'); } catch {} } return result; }
      finally { applying = false; }
    },
    async exit() { if (!active) return false; active = false; enteringIdentity = null; setPresentation(false); await cancelCandidate(); return state(); },
    async dispose() { if (disposed) return; disposed = true; if (active) { active = false; setPresentation(false); } await cancelCandidate(); }
  });
}
