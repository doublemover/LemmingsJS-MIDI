const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const text = (value, length = 120) => typeof value === 'string' ? value.slice(0, length) : '';

/** @param {Partial<import('./ProcgenBoundaryContracts.js').ReplacementReviewInput>} options @returns {import('./ProcgenBoundaryContracts.js').ReplacementReview} */
export function createProcgenReplacementReview({ identity, documentIdentity, name, dirty = false, physicalProgress = false, drafts = {}, take = {}, capture = {}, recording = {}, prelisten = {}, artifact = null, delivery = false, saving = false, preparingFile = false } = {}) {
  if (typeof identity !== 'string' || !identity || identity.length > 2048 || typeof documentIdentity !== 'string' || !documentIdentity || documentIdentity.length > 128) throw new Error('Invalid replacement review source.');
  const textDrafts = count(drafts.textDrafts), curveDrafts = count(drafts.curveDrafts), gestures = count(drafts.gestures), blockedCapture = capture.unresolved === true || ['preparing', 'recording', 'stopping'].includes(capture.state),
    blockedTake = take.recovering === true || take.finalizing === true, blocked = gestures > 0 || blockedCapture || blockedTake || recording.active === true || recording.learning === true || prelisten.active === true || prelisten.unresolved === true || delivery === true || saving === true || preparingFile === true;
  const reasons = [];
  if (dirty) reasons.push('The current project has unsaved changes.');
  if (physicalProgress) reasons.push('The current physical world will be replaced. A project save captures a checkpoint of its current state.');
  if (textDrafts) reasons.push(`${textDrafts} local text draft${textDrafts === 1 ? '' : 's'} cannot be included in a project save. Finish them or explicitly discard them.`);
  if (curveDrafts) reasons.push(`${curveDrafts} local curve draft${curveDrafts === 1 ? '' : 's'} cannot be included in a project save. Apply them or explicitly discard them.`);
  if (gestures) reasons.push('Finish the current gesture before replacing this project.');
  if (blockedCapture) reasons.push('Finish and keep the browser audio recording before replacing this project.');
  if (blockedTake) reasons.push('Finish or recover the pending physical take before replacing this project.');
  else if (take.recording === true) reasons.push('The physical take must be finalized before replacement.');
  if (recording.active === true) reasons.push('Stop MIDI recording before replacing this project.');
  if (recording.learning === true) reasons.push('Finish or cancel MIDI Learn before replacing this project.');
  if (count(recording.retained)) reasons.push('The retained MIDI recording stays separate from a project save. Its original source will be kept for export.');
  if (prelisten.unresolved === true) reasons.push('Resolve the unfinished Prelisten ownership before replacing this project.');
  else if (prelisten.active === true) reasons.push('Use the source’s Stop preview control to end Prelisten.');
  if (artifact) reasons.push('The prepared file is independent of the project and will remain available.');
  if (delivery) reasons.push('Finish or cancel the file write before replacing this project. The prepared file will be retained.');
  if (saving) reasons.push('Wait for the pending project Save to finish before replacing it.');
  if (preparingFile) reasons.push('Finish or cancel file preparation before replacing the project.');
  return Object.freeze({ identity, documentIdentity: text(documentIdentity, 128), name: text(name) || 'Untitled project', required: dirty || physicalProgress || textDrafts > 0 || curveDrafts > 0 || gestures > 0 || blockedCapture || blockedTake || take.recording === true || recording.active === true || recording.learning === true || count(recording.retained) > 0 || prelisten.active === true || prelisten.unresolved === true || !!artifact || delivery === true || saving === true || preparingFile === true,
    reasons: Object.freeze(reasons), textDrafts, curveDrafts, gestures, canReplace: !blocked, canSave: (dirty || physicalProgress) && !blocked && textDrafts === 0 && curveDrafts === 0 && take.recording !== true,
    finalizeTake: !blocked && take.recording === true,
    replaceLabel: take.recording === true ? 'Finalize take, discard changes and replace' : dirty || textDrafts || curveDrafts ? 'Discard changes and replace' : 'Replace project' });
}
