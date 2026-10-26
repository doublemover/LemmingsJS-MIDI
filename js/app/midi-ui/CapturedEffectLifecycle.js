const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'EffectRenderError', code }); };
const modes = new Set(['neutral', 'tail', 'mute', 'panic']);
export function prepareCapturedEffectLifecycle(plan, events, graphStartFrame, transitionFrames) {
  const lifecycle = events.filter(event => event.kind === 'lifecycle');
  if (lifecycle.length && plan.nodes.some(node => node.membrane || node.network || node.pairedBody || node.spectral)) fail('effect-processor-lifecycle-unavailable', 'This processor-owned body/spectrum needs its applied lifecycle evidence; API bypass timing alone cannot reconstruct it.');
  let terminal = null; const canceledQueuedControls = [], retainedTailControls = [];
  for (const event of events) {
    if (terminal) {
      if (event.kind == null && Number.isSafeInteger(event.sequence) && event.sequence < terminal.sequence) {
        if (terminal.mode === 'tail' && event.frame < terminal.frame + transitionFrames + plan.maximumTailFrames) retainedTailControls.push(event.sequence); else canceledQueuedControls.push(event.sequence);
        continue;
      }
      fail('effect-lifecycle-after-detach', 'This history submits another graph command after its captured single graph detached.');
    }
    if (event.kind !== 'lifecycle') continue;
    if (!modes.has(event.mode)) fail('effect-lifecycle-replay-unavailable', 'Owner-stop has no explicit effect-tail disposition in this older capture profile.');
    if (!Number.isSafeInteger(event.frame) || event.frame < Math.max(0, graphStartFrame)) fail('effect-lifecycle-before-publication', 'Captured lifecycle timing precedes its admitted source/graph history.');
    if (event.mode !== 'mute') terminal = event;
  }
  return Object.freeze({ schema: 'lemmings-captured-owner-lifecycle/v1', canceledQueuedControls: Object.freeze(canceledQueuedControls), retainedTailControls: Object.freeze(retainedTailControls), transitions: lifecycle.length, transitionFrames, maximumTailFrames: plan.maximumTailFrames,
    timing: 'captured-native-API-frame;not-observed-device-application', memory: 'new-realization;clear-on-neutral/panic;declared-tail-deadline',
    returnTapScope: 'internal-effect-node-output-before-owner-lifecycle-output-gate', supportsProcessorOwnedLifecycle: false });
}
export function createCapturedEffectLifecycleDriver(replay, graph) {
  const width = replay.transitionFrames, maximumTail = replay.lifecycle?.maximumTailFrames ?? 0;
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(maximumTail) || maximumTail < 0 || replay.events.some(event => event.kind === 'lifecycle') && typeof graph.panic !== 'function') fail('effect-lifecycle-driver-contract', 'Owner lifecycle needs its exact bounded transition/tail and graph-clear contract.');
  let inputFrom = 0, inputTo = 1, inputFirst = replay.graphStartFrame, inputEnd = inputFirst + width, dryFrom = 1, dryTo = 0, dryFirst = inputFirst, dryEnd = inputEnd, outputGate = 1, retired = false, retirementFrame = Infinity, inputGain = 0, dryGain = 1;
  const at = (from, to, first, end, frame) => from + (to - from) * Math.max(0, Math.min(1, (frame - first) / (end - first)));
  const step = frame => {
    inputGain = at(inputFrom, inputTo, inputFirst, inputEnd, frame); dryGain = at(dryFrom, dryTo, dryFirst, dryEnd, frame);
    if (!retired && frame >= retirementFrame) { retired = true; outputGate = 0; graph.panic(); }
  };
  return Object.freeze({ step,
    validate(event) { if (!event || event.kind !== 'lifecycle' || !modes.has(event.mode) || !Number.isSafeInteger(event.frame) || event.frame < 0) fail('effect-lifecycle-driver-contract', 'Unsupported captured owner lifecycle event.'); },
    apply(event, frame) {
      if (event.frame !== frame) fail('effect-lifecycle-late-replay', 'An owner lifecycle event missed its exact revoice frontier.'); step(frame);
      dryFrom = dryGain; dryTo = event.mode === 'mute' ? 0 : 1; dryFirst = frame; dryEnd = frame + width;
      if (event.mode === 'mute') outputGate = 0;
      else { inputFrom = inputGain; inputTo = 0; inputFirst = frame; inputEnd = frame + width; if (event.mode === 'tail') retirementFrame = frame + width + maximumTail; else { outputGate = 0; retired = true; graph.panic(); } }
      step(frame);
    }, get inputGain() { return inputGain; }, get dryGain() { return dryGain; }, get outputGain() { return outputGate; }, get retired() { return retired; } });
}
