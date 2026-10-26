import { createPhysicalLessonSession } from './PhysicalLessonSession.js';
import { createPhysicalLessonProgress } from './PhysicalLessonProgress.js';
import { createProcgenRetirementScope } from '../ProcgenRetirement.js';

export function createPhysicalLessonView({ document, window, definitions, loadScene, cancelLoad = async () => {}, onStatus = () => {} } = {}) {
  if (!document?.createElement || !Array.isArray(definitions) || !definitions.length || definitions.length > 32 || typeof loadScene !== 'function') throw new TypeError('Lesson view needs installed definitions and the existing scene publication owner.');
  const retirement = createProcgenRetirementScope(), listeners = []; let disposed = false, serial = 0, active = null, index = 0, navigation = Promise.resolve();
  const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
  const root = node('section'), title = node('h2'), prompt = node('p'), instructions = node('p'), hint = node('details'), hintTitle = node('summary', 'Hint'), hintText = node('p'), evidence = node('output'), status = node('p'), actions = node('div');
  root.hidden = true; root.className = 'studio-physical-lesson'; root.setAttribute('aria-label', 'Learn physical music'); evidence.setAttribute('role', 'status'); status.setAttribute('role', 'status'); hint.append(hintTitle, hintText);
  const predictionLabel = node('label', 'Your prediction (written or dictated)'), prediction = node('textarea'); prediction.maxLength = 512; prediction.rows = 2; prediction.setAttribute('aria-label', 'Your prediction'); predictionLabel.append(prediction);
  const say = text => { if (disposed) return; status.textContent = text; try { onStatus(text); } catch {} };
  let storage = null; try { storage = window?.localStorage || null; } catch {}
  const session = createPhysicalLessonSession({ progress: createPhysicalLessonProgress({ storage }), onState: () => refresh() });
  const button = (text, handler) => { const value = node('button', text); value.type = 'button'; const run = () => { try { Promise.resolve(handler()).catch(error => say(error.message)); } catch (error) { say(error.message); } }; value.addEventListener('click', run); listeners.push(() => value.removeEventListener('click', run)); actions.append(value); return value; };
  const stop = () => { serial++; active?.controller.abort(new Error('Lesson navigation canceled this preparation.')); navigation = Promise.resolve().then(cancelLoad).catch(error => say(error.message)); };
  const load = async reference => {
    if (active || disposed) return; const operation = { controller: new AbortController(), serial: ++serial, promise: null }; active = operation; refresh();
    operation.promise = (async () => {
      await navigation; operation.controller.signal.throwIfAborted();
      const actual = await loadScene(reference, { signal: operation.controller.signal }); operation.controller.signal.throwIfAborted();
      if (disposed || serial !== operation.serial) return;
      session.bindScene(actual); say('Loaded paused. Use the existing Play control and physical actions; this lesson never enables audio or sends a gesture for you.');
    })().catch(error => { if (!operation.controller.signal.aborted && serial === operation.serial) throw error; }).finally(() => { if (active === operation) active = null; refresh(); });
    return operation.promise;
  };
  const control = button('Load empty control', () => load(definitions[index].zeroNoteScene));
  const setup = button('Load lesson setup', () => load(definitions[index].setupScene));
  const commitPrediction = button('Keep prediction · observe baseline', () => session.predict(prediction.value));
  const heard = button('I heard the difference · self report', () => session.reportHearing());
  const reset = button('Reset attempt', async () => { if (active) return; session.reset(); prediction.value = ''; await load(definitions[index].zeroNoteScene); });
  const choose = next => { stop(); index = next; prediction.value = ''; session.select(definitions[index]); };
  const back = button('Back', () => { if (index > 0) choose(index - 1); });
  const skip = button('Skip · explore freely', () => { stop(); session.skip(); say('Skipped without a completion grade. The current world remains yours to explore.'); });
  const next = button('Next lesson', () => { if (index + 1 < definitions.length) choose(index + 1); });
  button('Close lessons', () => { stop(); session.suspend(); root.hidden = true; });
  function refresh() {
    if (disposed) return; const state = session.state(), definition = state.definition; if (!definition) return;
    title.textContent = (index + 1) + '/' + definitions.length + ' · ' + definition.title; hintText.textContent = definition.hint;
    const captions = { 'load-zero-control': 'Load the empty control, then explicitly Play. A complete actor-free batch must produce no onset.', 'observe-zero-control': 'Observe the empty world. No actor means no physical onset; a display or transport tick is not a cause.', 'load-setup': 'The empty control passed. Load the exact lesson setup, which starts paused.', predict: definition.prediction, 'observe-baseline': 'Use Play to observe the unchanged physical baseline. Then pause before the intervention.', 'perform-intervention': definition.intervention, 'physical-evidence-observed': 'The declared physical difference was observed. Sound acceptance and reported hearing remain separate.', 'reset-required': 'This attempt cannot be graded. Reset to the exact empty control; your current world stays playable.', skipped: 'Free exploration; this lesson was skipped.', closed: 'Lessons closed.' };
    prompt.textContent = captions[state.phase] || state.phase; instructions.textContent = definition.expectedMusicalDifference + ' ' + definition.audibleEvidence;
    evidence.textContent = [state.reason, 'Baseline causes: ' + state.baseline.length + '; changed causes: ' + state.changed.length + '.', 'Physical evidence: ' + (state.physicalObserved ? 'observed' : 'pending') + '. Sound accepted: ' + (state.soundAccepted ? 'yes' : 'unverified') + '. Hearing: ' + (state.reportedHearing ? 'reported by you' : 'unverified') + '.', state.priorProgress ? 'A previous completed attempt is saved separately; this attempt still requires its own evidence.' : null, state.persistence].filter(Boolean).join(' ');
    const busy = !!active; control.disabled = busy || !['load-zero-control', 'reset-required'].includes(state.phase); setup.disabled = busy || state.phase !== 'load-setup'; prediction.disabled = commitPrediction.disabled = busy || state.phase !== 'predict'; predictionLabel.hidden = state.phase !== 'predict';
    heard.disabled = busy || !state.physicalObserved || !state.soundAccepted || state.reportedHearing; reset.disabled = busy; back.disabled = index === 0; next.disabled = index + 1 >= definitions.length; skip.disabled = state.phase === 'skipped';
  }
  root.append(title, prompt, predictionLabel, instructions, hint, evidence, actions, status); (document.getElementById('procgenPresentationRoot') || document.body).append(root);
  return Object.freeze({
    isObserving() { return !disposed && !root.hidden; },
    open(id) { if (disposed) return; const selected = definitions.findIndex(value => value.setupScene.id === id); if (selected < 0) throw new Error('This score has no installed observed lesson.'); choose(selected); root.hidden = false; title.tabIndex = -1; title.focus?.(); },
    observe(value) { if (!disposed && !root.hidden) { try { session.observe(value); } catch (error) { session.reset(); say('Lesson evidence was unavailable: ' + error.message); } } },
    observeReceipt(receipt, documentEpoch) { if (!disposed && !root.hidden) session.observeReceipt(receipt, documentEpoch); },
    dispose() { if (retirement.getReceipt()) return retirement.getReceipt(); disposed = true; stop(); session.dispose(); return retirement.retire([{ name: 'lesson-preparation', run: async () => { await active?.promise.catch(() => {}); await cancelLoad(); } }, { name: 'lesson-view', run: () => { for (const remove of listeners) remove(); root.remove(); } }]); }
  });
}
