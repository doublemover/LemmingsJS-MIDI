import { createBrowserSurveyTrial } from './ProcgenSurveyBrowserAssets.js';
import { compareSurveyCompatibilityReplay, compareSurveyBoundReplay, firstSurveyDivergence } from './ProcgenSurveyReplay.js';
import { createBrowserSurveyReplaySession } from './ProcgenSurveyReplaySession.js';
import { compareActiveExecutionIdentity } from '../../../runtime/ActiveExecutionIdentity.js';
import { requestBrowserDownload } from '../../export/BrowserDownload.js';

const renderSurveyPreview = (canvas, telemetry, { cameraX = null, cameraY = 0, width = 512, height = 144 } = {}) => {
  const context = canvas.getContext('2d'), preview = telemetry?.preview || {}, actors = preview.actors || [];
  const right = Math.max(36, ...actors.map(actor => actor.x)); const origin = cameraX ?? Math.max(0, right - width * 0.65);
  context.fillStyle = '#090e16'; context.fillRect(0, 0, canvas.width, canvas.height);
  const sx = canvas.width / width, sy = canvas.height / height;
  const box = (x, y, w, h, color) => { context.fillStyle = color; context.fillRect((x - origin) * sx, (y - cameraY) * sy, w * sx, h * sy); };
  for (const rectangle of preview.geometry?.solid || []) box(rectangle.x, rectangle.y, rectangle.width, rectangle.height, '#4a6175');
  for (const rectangle of preview.geometry?.steel || []) box(rectangle.x, rectangle.y, rectangle.width, rectangle.height, '#a4b4c5');
  for (const rectangle of preview.geometry?.hazards || []) box(rectangle.x, rectangle.y, rectangle.width, rectangle.height, '#a1455d');
  for (const chunk of preview.chunks || []) for (let cell = 0; cell < chunk.cells.length; cell++) {
    if (!chunk.cells[cell]) continue; const columns = Math.ceil(chunk.width / chunk.cellSize);
    box(chunk.x + cell % columns * chunk.cellSize, chunk.y + Math.floor(cell / columns) * chunk.cellSize, chunk.cellSize, chunk.cellSize, chunk.cells[cell] === 2 ? '#a4b4c5' : '#4a6175');
  }
  for (const actor of actors) box(actor.x - 2, actor.y - 7, 4, 7, actor.terminalReason ? '#e67788' : actor.scout ? '#c78fed' : ['build', 'bash', 'dig', 'mine'].includes(actor.action) ? '#f4ce7a' : '#b4edc6');
  return { cameraX: origin, cameraY, width, height };
};
const surveyReviewOutcome = result => {
  const gates = ['accountingComplete', 'deterministic', 'protectedTerrain', 'legitimateActions'];
  const validity = gates.some(key => result?.validity?.[key] === false) ? 'Validity check failed' : gates.every(key => result?.validity?.[key] === true) ? 'Validity checks passed' : 'Validity unknown';
  const outcome = !result?.episodeComplete ? 'Incomplete episode' : result.status === 'completed' ? 'Goal met at horizon' : ['failed', 'timeout', 'timed-out', 'timed_out'].includes(result.status) ? 'Goal not met at horizon' : 'Outcome unknown';
  return { outcome, validity, deaths: Number.isInteger(result?.accounting?.deaths) && result.accounting.deaths >= 0 ? result.accounting.deaths : null };
};
const describeSurveyStep = state => {
  const receipt = state?.stepReceipt;
  if (!receipt) return state?.queued || state?.stepPending ? 'Step queued; waiting for worker admission.' : 'No worker step requested.';
  const selected = Number.isSafeInteger(receipt.selectedCount) ? receipt.selectedCount : receipt.selected?.length || 0;
  if (receipt.status === 'pending') return receipt.phase === 'preparing' ?
    `Step preparing across ${receipt.expectedWorkers ?? 'unknown'} worker(s); no checkpoint confirmed.` :
    `Step in progress for ${selected} selected trial(s); no checkpoint confirmed.`;
  if (receipt.status === 'reached' && Number.isSafeInteger(receipt.reachedCheckpoint))
    return `Reached checkpoint tick ${receipt.reachedCheckpoint} for ${selected} selected trial(s).`;
  if (receipt.status === 'empty') return 'No eligible trial was selected for this step.';
  if (receipt.status === 'terminal-before-target') return `Selected trial ended before checkpoint tick ${receipt.targetTick ?? 'unknown'}.`;
  if (receipt.status === 'timed-out') return `Step timed out; ${receipt.unacknowledgedWorkerCount ?? 'some'} worker outcome(s) remain unconfirmed.`;
  if (receipt.status === 'failed') return 'Step failed before a confirmed checkpoint.';
  if (receipt.status === 'superseded') return 'Step was superseded before a confirmed checkpoint.';
  return `Step ${receipt.status || 'outcome unknown'}; no checkpoint confirmed.`;
};
const describeSurveyStepSelection = state => {
  const receipt = state?.stepReceipt;
  if (!receipt) return 'No trial selection receipt.';
  const selected = Array.isArray(receipt.selected) ? receipt.selected : [];
  const rows = selected.slice(0, 32).map(value =>
    `${String(value?.trialId || 'unknown trial').slice(0, 96)} · attempt ${String(value?.attemptId || 'unknown').slice(0, 96)} · ${String(value?.status || 'unknown progress').slice(0, 64)} · tick ${Number.isSafeInteger(value?.tick) ? value.tick : 'unconfirmed'}`);
  if (selected.length > 32) rows.push(`${selected.length - 32} more selected trials omitted from this view.`);
  if (!receipt.selectionComplete) rows.push('Selection is incomplete; some worker progress is unknown.');
  return rows.join('\n') || 'No eligible trial was selected.';
};
const createSurveyDashboard = ({ document, window, fetch: fetchData = window.fetch.bind(window) }) => {
  const element = id => document.getElementById(id), url = new URL(window.location.href), token = url.searchParams.get('token') || new URLSearchParams(url.hash.slice(1)).get('token');
  const tiles = new Map(), disposedTrials = new WeakSet();
  const releaseTrial = trial => { if (trial && !disposedTrials.has(trial)) { disposedTrials.add(trial); trial.dispose(); } };
  let report = null, selectedId = null, replay = null, disposed = false, polling = null, paused = false, replayPending = false, pausePending = false, stepPending = false, connected = !!token, loadEpoch = 0, replayEpoch = 0, replayAbort = null, manifestIdentity = null, filePending = null, preferredTrial = null, displayedStep = null;
  const replayHelp = 'Choose a current-runtime comparison, or exact replay when this application has the recorded immutable build installed.';
  const status = text => { if (!disposed) element('surveyStatus').textContent = text; };
  const publishStep = state => {
    if (disposed) return;
    const receipt = state?.stepReceipt, prior = displayedStep?.stepReceipt;
    if (!receipt && prior && connected && !state?.queued) return;
    if (receipt && prior && receipt.runGeneration === prior.runGeneration &&
        (receipt.controlId < prior.controlId || receipt.controlId === prior.controlId && prior.status !== 'pending' && receipt.status === 'pending')) return;
    displayedStep = state;
    element('surveyStepReceipt').textContent = describeSurveyStep(state);
    element('surveyStepSelection').textContent = describeSurveyStepSelection(state);
  };
  const syncPause = () => {
    const button = element('surveyPause');
    button.disabled = disposed || pausePending || (!connected && !replay);
    button.textContent = (paused ? 'Resume' : 'Pause') + (connected ? ' all' : ' replay');
  };
  const cancelReplay = () => {
    replayEpoch++; replayAbort?.abort(); replayAbort = null;
    releaseTrial(replay); replay = null; replayPending = false;
    if (!connected) paused = false;
    delete window.__procgenSurveyReplayReceipt;
    element('surveyReplayStatus').textContent = replayHelp; syncPause();
  };
  const records = () => report?.results || [];
  const selected = () => records().find(result => result.trialId === selectedId);
  const baseline = result => records().find(other => other.scenarioId === result?.scenarioId && other.candidate?.kind === 'baseline' && other.policySeed === result?.policySeed);
  const finalTelemetry = result => (report?.telemetry || []).find(([id]) => id === result?.trialId)?.[1] || result?.telemetry;
  const milestoneAt = (result, tick) => [...(result?.milestones || [])].reverse().find(entry => entry.tick <= tick)?.telemetry || (result?.lastTick <= tick ? finalTelemetry(result) : undefined);
  const publishOutcome = result => {
    const summary = element('surveyOutcomeSummary'), rows = element('surveyOutcomeRows'); summary.replaceChildren(); rows.replaceChildren();
    element('surveyOutcomeComparison').hidden = !result; if (!result) return;
    const review = surveyReviewOutcome(result);
    for (const [text, tone] of [[review.outcome, result.episodeComplete ? '' : 'caution'], [review.deaths === null ? 'Deaths unknown' : 'Recorded deaths: ' + review.deaths, review.deaths > 0 ? 'loss' : ''], [review.validity, review.validity === 'Validity checks passed' ? '' : 'caution']]) {
      const badge = document.createElement('span'); badge.className = 'survey-badge ' + tone; badge.textContent = text; summary.append(badge);
    }
    const count = value => Number.isInteger(value) && value >= 0 ? String(value) : 'Unknown';
    const cohortCount = (trial, key) => count(trial.accounting?.[key]) + ' / ' + count(trial.accounting?.designated);
    const gate = value => value === true ? 'Passed' : value === false ? 'Failed' : 'Unknown';
    const replayState = trial => {
      const receipt = window.__procgenSurveyReplayReceipt?.originalTrialId === trial.trialId ? window.__procgenSurveyReplayReceipt : report.verification?.find(entry => entry.originalTrialId === trial.trialId);
      if (receipt?.executionIdentity?.status === 'bound') return receipt.matched ? 'Exact replay matched · build verified' : 'Exact replay differs · build verified';
      if (receipt?.executionIdentity?.status === 'unbound') return receipt.compatibilityMatch ? 'Fields match · build unverified' : 'Comparison mismatch · build unverified';
      return receipt?.matched === true ? 'Archived match · build unverified' : receipt?.matched === false ? 'Mismatch' : 'Not recorded';
    };
    const measures = [
      ['Candidate / policy seed', trial => trial.candidateId + ' / ' + (trial.policySeed ?? 'Unknown')],
      ['Declared outcome', trial => surveyReviewOutcome(trial).outcome],
      ['Recorded tick / horizon', trial => count(trial.lastTick) + ' / ' + count(trial.scenario?.horizonTicks)],
      ['Physical arrivals / designated', trial => cohortCount(trial, 'arrived')],
      ['Qualified arrivals / designated', trial => cohortCount(trial, 'qualified')],
      ['Alive / designated', trial => cohortCount(trial, 'alive')],
      ['Recorded deaths', trial => count(trial.accounting?.deaths)],
      ['Unresolved crew', trial => count(trial.accounting?.unresolved)],
      ['Skills spent', trial => count(trial.metrics?.skillCount)],
      ['Complete accounting', trial => gate(trial.validity?.accountingComplete)],
      ['Protected terrain', trial => gate(trial.validity?.protectedTerrain)],
      ['Legitimate actions', trial => gate(trial.validity?.legitimateActions)],
      ['Recorded determinism validity', trial => gate(trial.validity?.deterministic)],
      ['Exact replay receipt', replayState],
      ['Evidence retention', trial => trial.evidence?.truncated === true ? 'Truncated' : trial.evidence?.truncated === false ? 'No truncation reported' : 'Unknown']
    ];
    const pair = baseline(result);
    for (const [label, value] of measures) {
      const row = document.createElement('tr'), heading = document.createElement('th'); heading.scope = 'row'; heading.textContent = label; row.append(heading);
      for (const trial of [result, pair]) { const cell = document.createElement('td'); cell.textContent = trial ? value(trial) : 'No paired trial'; row.append(cell); }
      rows.append(row);
    }
  };
  const publishFocus = () => {
    const result = selected();
    publishOutcome(result);
    element('surveyCamera').disabled = !result;
    element('surveyScrub').disabled = !result?.milestones?.length;
    element('surveyReplay').disabled = disposed || replayPending || !!replay || !result?.episodeComplete;
    element('surveyDivergence').disabled = !result || !baseline(result) || baseline(result)?.trialId === result.trialId;
    element('surveyStep').disabled = stepPending || report?.controlState?.stepPending === true ||
      !connected && (!result || Number(element('surveyScrub').value) >= Number(element('surveyScrub').max));
    if (replay) return;
    if (!result) {
      renderSurveyPreview(element('surveyFocus')); renderSurveyPreview(element('surveyBaseline'));
      element('surveyFocusTitle').textContent = 'No trial selected';
      element('surveyBaselineStatus').textContent = 'Select a trial to compare the same scene and policy seed.';
      element('surveyTick').textContent = 'No checkpoint'; element('surveyDetails').textContent = '';
      return;
    }
    const index = Number(element('surveyScrub').value) || 0, milestone = result.milestones?.[index], tick = milestone?.tick ?? result.lastTick;
    const telemetry = tick === result.lastTick ? finalTelemetry(result) || milestone?.telemetry : milestone?.telemetry;
    const camera = renderSurveyPreview(element('surveyFocus'), telemetry, { height: result.scenario?.laneHeight || 144 });
    const paired = baseline(result), pairedTelemetry = tick === paired?.lastTick ? finalTelemetry(paired) || milestoneAt(paired, tick) : milestoneAt(paired, tick);
    renderSurveyPreview(element('surveyBaseline'), pairedTelemetry, element('surveyCamera').value === 'shared' ? camera : { height: paired?.scenario?.laneHeight || 144 });
    element('surveyBaselineStatus').textContent = !paired ? 'No paired baseline is recorded for this scene and policy seed.' : !pairedTelemetry ? 'No baseline checkpoint is retained at or before tick ' + tick + '.' : paired.trialId === result.trialId ? 'This trial is the baseline; both views show the same recording.' : 'Baseline: ' + paired.candidateId + ' · same scene and policy seed · recorded at or before tick ' + tick;
    element('surveyScrub').setAttribute('aria-valuetext', 'Tick ' + tick);
    element('surveyTick').textContent = 'Tick ' + tick; element('surveyFocusTitle').textContent = result.candidate?.family + ' · ' + result.scenarioId;
    const archive = report.exemplars?.selected?.find(entry => entry.trialId === result.trialId);
    element('surveyDetails').textContent = JSON.stringify({ status: result.status, policy: result.candidate?.configuration, accounting: result.accounting, skills: result.metrics?.skills,
      excavation: result.metrics?.excavatedPixels, pairedBaseline: paired?.trialId || null, selectionReason: archive?.reasons || null,
      exactReplay: archive?.qualification?.exactReplay || report.verification?.find(entry => entry.originalTrialId === result.trialId) || null,
      successQualification: report.successQualification?.find(entry => entry.originalTrialId === result.trialId) || null, evidence: result.evidence, previewTick: telemetry?.preview?.tick ?? tick, previewScope: telemetry?.preview?.terrainScope || 'Declared controlled terrain' }, null, 2);
  };
  const select = (id, keepPosition = false) => {
    if (id !== selectedId) cancelReplay();
    const previousPosition = Number(element('surveyScrub').value); selectedId = id; const result = selected(); element('surveyScrub').max = Math.max(0, (result?.milestones?.length || 1) - 1);
    element('surveyScrub').value = keepPosition ? Math.min(previousPosition, Number(element('surveyScrub').max)) : element('surveyScrub').max;
    for (const tile of element('surveyMosaic').children) { const active = tile.dataset.trialId === id; tile.classList.toggle('selected', active); tile.setAttribute('aria-pressed', String(active)); } publishFocus();
  };
  const render = () => {
    if (!report) return; const manifest = report.manifest;
    for (const id of ['surveyExport', 'surveyScene', 'surveyFilter', 'surveySort', 'surveyPolicySeed']) element(id).disabled = false;
    element('surveySummary').textContent = manifest.candidates.length + ' logical candidates · ' + manifest.budgetPolicy.executionWorkers + ' CPU worker(s) · ' + manifest.budgetPolicy.residentWorlds + ' resident worlds · ' + (report.status || 'running');
    element('surveyEvidence').textContent = JSON.stringify({ source: manifest.sourceManifest, criteria: manifest.criteria, storage: report.storage, analysis: report.analysis, rankingsTrusted: report.rankingsTrusted }, null, 2);
    const scenePicker = element('surveyScene'), previousScene = scenePicker.value;
    if (!scenePicker.children.length) for (const scene of manifest.scenarios) { const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.id + ' · seed ' + (scene.environmentSeed ?? 'unknown'); scenePicker.append(option); }
    if (previousScene) scenePicker.value = previousScene;
    const sceneId = scenePicker.value || manifest.developmentScenarioIds[0];
    const scene = manifest.scenarios.find(item => item.id === sceneId), sceneIndex = manifest.scenarios.indexOf(scene), sceneRecords = records().filter(result => result.scenarioId === sceneId);
    element('surveyPreviousScene').disabled = sceneIndex <= 0; element('surveyNextScene').disabled = sceneIndex >= manifest.scenarios.length - 1;
    element('surveyScenarioContext').textContent = 'Environment seed ' + (scene?.environmentSeed ?? 'unknown') + ' · ' + (scene?.pack || 'pack unknown') + ' · ' + (scene?.mode || 'mode unknown') + ' · ' + (scene?.cohort?.size ?? scene?.designatedCohort?.length ?? 'unknown') + ' designated crew · horizon ' + (scene?.horizonTicks ?? 'unknown') + ' ticks · ' + (scene?.corpus || 'corpus unknown');
    const seedPicker = element('surveyPolicySeed'), previousSeed = seedPicker.value, seeds = [...new Set(sceneRecords.map(result => String(result.policySeed ?? 'unknown')))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (seedPicker.dataset.seeds !== JSON.stringify(seeds)) {
      seedPicker.replaceChildren(); for (const seed of ['all', ...seeds]) { const option = document.createElement('option'); option.value = seed; option.textContent = seed === 'all' ? 'All seeds' : seed === 'unknown' ? 'Unknown' : seed; seedPicker.append(option); }
      seedPicker.dataset.seeds = JSON.stringify(seeds); seedPicker.value = seeds.includes(previousSeed) ? previousSeed : 'all';
    }
    const mosaic = element('surveyMosaic'); mosaic.classList.toggle('dense', manifest.candidates.length > 16);
    const remarkable = new Set((report.exemplars?.selected || []).filter(entry => entry.kind === 'success').map(entry => entry.trialId));
    const filter = element('surveyFilter').value, sort = element('surveySort').value;
    const data = sceneRecords.filter(result => seedPicker.value === 'all' || String(result.policySeed ?? 'unknown') === seedPicker.value).filter(result => {
      if (filter === 'all') return true;
      if (filter === 'success') return remarkable.has(result.trialId);
      if (filter === 'failure') return result.status === 'failed' || result.status === 'timeout';
      if (filter === 'interrupted') return ['interrupted', 'cancelled', 'infrastructure-error'].includes(result.status);
      if (filter === 'casualties') return surveyReviewOutcome(result).deaths > 0;
      if (filter === 'incomplete') return !result.episodeComplete;
      if (filter === 'completed') return result.episodeComplete === true && result.status === 'completed';
      if (filter === 'invalid') return surveyReviewOutcome(result).validity === 'Validity check failed';
      if (filter === 'unknown') return surveyReviewOutcome(result).validity === 'Validity unknown';
      return result.status === filter;
    });
    const visibleIds = new Set(data.map(result => result.trialId)); for (const [id, tile] of tiles) tile.hidden = !visibleIds.has(id);
    data.sort((a, b) => sort === 'survival' ? (b.accounting?.alive || 0) - (a.accounting?.alive || 0) : sort === 'skills' ? (a.metrics?.skillCount || 0) - (b.metrics?.skillCount || 0) : sort === 'completion' ? (b.accounting?.arrived || 0) - (a.accounting?.arrived || 0) : a.candidateId.localeCompare(b.candidateId));
    element('surveyCount').textContent = data.length + ' of ' + records().filter(result => result.scenarioId === sceneId).length + ' trials shown';
    element('surveyEmpty').hidden = data.length > 0;
    element('surveyEmpty').textContent = 'No trials match this scene and filter. Choose another scene or show all trials.';
    const focusedTile = document.activeElement?.closest('.survey-tile');
    for (const [index, result] of data.entries()) {
      let tile = tiles.get(result.trialId);
      if (!tile) { tile = document.createElement('button'); tile.type = 'button'; tile.className = 'survey-tile'; tile.dataset.trialId = result.trialId; tile.addEventListener('click', () => select(result.trialId)); tiles.set(result.trialId, tile); mosaic.append(tile); }
      tile.hidden = false; tile.replaceChildren(); if (mosaic.children[index] !== tile) mosaic.insertBefore(tile, mosaic.children[index] || null);
      tile.classList.toggle('failed', result.status === 'failed'); tile.classList.toggle('remarkable', remarkable.has(result.trialId));
      const name = document.createElement('strong'); name.textContent = result.candidate?.kind === 'no-learning' ? 'No learned preferences' : (result.candidate?.family || 'Candidate') + ' · ' + result.candidateId.slice(-4);
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96; canvas.setAttribute('aria-hidden', 'true');
      const detail = document.createElement('small'); detail.textContent = 'Policy seed ' + (result.policySeed ?? 'unknown') + ' · tick ' + result.lastTick + ' · ' + result.status;
      const counts = document.createElement('small'); counts.textContent = (result.accounting?.alive ?? '?') + '/' + (result.accounting?.designated ?? '?') + ' alive · ' + (result.accounting?.arrived ?? '?') + ' arrived · ' + (result.accounting?.deaths ?? '?') + ' deaths';
      const review = surveyReviewOutcome(result), outcome = document.createElement('span'); outcome.className = 'survey-badge' + (!result.episodeComplete ? ' caution' : ''); outcome.textContent = review.outcome;
      const evidence = document.createElement('small'); evidence.textContent = review.validity + (result.evidence?.truncated ? ' · truncated' : '');
      tile.append(name, canvas, outcome, detail, counts, evidence);
      renderSurveyPreview(canvas, finalTelemetry(result) || milestoneAt(result, result.lastTick), { height: result.scenario?.laneHeight || 144 });
    }
    const keepPosition = !!selectedId && data.some(result => result.trialId === selectedId);
    const preferred = preferredTrial && data.find(result => result.candidateId === preferredTrial.candidateId && result.policySeed === preferredTrial.policySeed);
    if (preferredTrial) element('surveyNavigationStatus').textContent = preferred ? 'Kept candidate ' + preferred.candidateId + ' and policy seed ' + (preferred.policySeed ?? 'unknown') + '.' : 'The previous candidate and policy seed are not available with these filters. ' + (data.length ? 'Showing the first available trial.' : 'No trial selected.');
    select(preferred?.trialId || (keepPosition ? selectedId : data[0]?.trialId), keepPosition && !preferredTrial); preferredTrial = null;
    if (focusedTile && !focusedTile.hidden && document.activeElement !== focusedTile) focusedTile.focus({ preventScroll: true });
  };
  const load = (value, { refresh = false } = {}) => {
    if (disposed) return;
    const next = value?.value || value, manifest = next?.manifest;
    const validId = value => typeof value === 'string' && value.length > 0;
    if (next?.schemaVersion !== 1 || !validId(manifest?.experimentId) || !Array.isArray(manifest?.candidates) || manifest.candidates.length > 64 ||
      !Array.isArray(manifest.scenarios) || !manifest.scenarios.length || manifest.scenarios.length > 4096 || !manifest.budgetPolicy || !Array.isArray(manifest.developmentScenarioIds) ||
      (next.telemetry !== undefined && (!Array.isArray(next.telemetry) || next.telemetry.some(entry => !Array.isArray(entry) || entry.length !== 2))) ||
      !Array.isArray(next.results) || next.results.length > 4096 || manifest.scenarios.some(scene => !validId(scene?.id)) ||
      new Set(manifest.scenarios.map(scene => scene.id)).size !== manifest.scenarios.length ||
      next.results.some(result => !validId(result?.trialId) || !validId(result.candidateId) || !manifest.scenarios.some(scene => scene.id === result.scenarioId) || (result.milestones !== undefined && !Array.isArray(result.milestones))) ||
      new Set(next.results.map(result => result.trialId)).size !== next.results.length) throw new Error('Unsupported or oversized survey report');
    const identity = JSON.stringify(manifest), changed = identity !== manifestIdentity;
    loadEpoch++; filePending = null;
    if (!refresh) {
      connected = false; if (polling) window.clearInterval(polling); polling = null;
    }
    if (!refresh || changed) cancelReplay();
    if (changed) { for (const tile of tiles.values()) tile.remove(); tiles.clear(); element('surveyScene').replaceChildren(); element('surveyNavigationStatus').textContent = ''; selectedId = null; displayedStep = null; }
    manifestIdentity = identity;
    if (connected && typeof next.controlState?.paused === 'boolean') paused = next.controlState.paused;
    publishStep(next.controlState);
    syncPause(); element('surveyCancel').disabled = !connected;
    element('surveyMode').textContent = connected ? 'Connected local survey' : 'Saved report review';
    report = next; render(); status('Recorded comparison loaded. Missing validity or truncated evidence stays explicit; no policy winner is claimed.');
  };
  const control = async command => {
    if (!connected) { if (command === 'step') { cancelReplay(); element('surveyScrub').value = Math.min(Number(element('surveyScrub').max), Number(element('surveyScrub').value) + 1); publishFocus(); } return; }
    const response = await fetchData('/survey-api/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Survey-Token': token }, body: JSON.stringify({ command }) });
    if (!response.ok) throw new Error('Survey control was rejected');
    const receipt = await response.json();
    if (receipt?.accepted !== command) throw new Error('Survey control acknowledgement did not match the command.');
    if (command === 'step' && receipt?.accepted === 'step') publishStep(receipt.state);
    return receipt?.state;
  };
  element('surveyFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    const epoch = ++loadEpoch; filePending = epoch;
    try {
      if (file.size > 64 * 1048576) throw new Error('Report exceeds the 64 MiB view limit');
      const text = await file.text(); if (!disposed && epoch === loadEpoch) load(JSON.parse(text));
    } catch (error) { if (epoch === loadEpoch) status(error.message); }
    finally { if (filePending === epoch) filePending = null; }
  });
  const changeScene = () => { const result = selected(); preferredTrial = result ? { candidateId: result.candidateId, policySeed: result.policySeed } : null; render(); };
  element('surveyScene').addEventListener('change', changeScene);
  for (const [id, offset] of [['surveyPreviousScene', -1], ['surveyNextScene', 1]]) element(id).addEventListener('click', () => { element('surveyScene').selectedIndex += offset; changeScene(); });
  const changeFilter = () => { element('surveyNavigationStatus').textContent = ''; render(); };
  element('surveyPolicySeed').addEventListener('change', changeFilter); element('surveyFilter').addEventListener('change', changeFilter); element('surveySort').addEventListener('change', render); element('surveyScrub').addEventListener('input', () => { cancelReplay(); publishFocus(); }); element('surveyCamera').addEventListener('change', () => { cancelReplay(); publishFocus(); });
  syncPause();
  element('surveyMode').textContent = connected ? 'Connected local survey' : 'Saved report review';
  element('surveyPause').addEventListener('click', async () => {
    if (pausePending || (!connected && !replay)) return;
    const nextPaused = !paused, epoch = loadEpoch; pausePending = true; syncPause();
    try { await control(nextPaused ? 'pause' : 'resume'); if (!disposed && epoch === loadEpoch) paused = nextPaused; }
    catch (error) { if (epoch === loadEpoch) status(error.message); }
    finally { pausePending = false; syncPause(); }
  });
  element('surveyStep').addEventListener('click', async () => {
    if (stepPending) return;
    stepPending = true; element('surveyStep').disabled = true;
    try { await control('step'); } catch (error) { status(error.message); }
    finally { stepPending = false; publishFocus(); }
  });
  element('surveyCancel').disabled = !connected; element('surveyCancel').addEventListener('click', () => control('cancel').catch(error => status(error.message)));
  element('surveyDivergence').addEventListener('click', () => { const result = selected(), pair = baseline(result); const divergence = result && pair && firstSurveyDivergence(pair, result);
    if (!divergence) { status('No physical/event divergence at retained common checkpoints.'); return; }
    cancelReplay(); element('surveyScrub').value = result.milestones.findIndex(entry => entry.tick === divergence.throughTick); publishFocus(); status('First recorded divergence between ticks ' + divergence.fromTick + ' and ' + divergence.throughTick + '. Exact localization needs detailed replay.'); });
  element('surveyExport').addEventListener('click', () => {
    if (!report) return;
    try {
      const name = String(report.manifest?.experimentId || 'survey').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 140);
      const receipt = requestBrowserDownload({ document, windowRef: window, bytes: JSON.stringify(report),
        filename: `${name}.json`, mediaType: 'application/json' });
      status(receipt.state === 'delivery-requested' ? 'Survey report download requested.' : 'Survey report could not be downloaded.');
    } catch (error) { status(`Survey report download failed: ${error.message}`); }
  });
  element('surveyReplay').addEventListener('click', async () => {
    const original = selected(); if (disposed || !original?.episodeComplete || replay || replayPending) return;
    const epoch = ++replayEpoch, controller = new AbortController(); replayAbort = controller;
    const current = () => !disposed && epoch === replayEpoch;
    let trial = null;
    replayPending = true; delete window.__procgenSurveyReplayReceipt;
    const exact = element('surveyReplayMode')?.value === 'exact';
    element('surveyReplay').disabled = true; element('surveyReplayStatus').textContent = exact ? 'Checking saved source and asset integrity.' : 'Checking saved physical asset integrity.';
    try {
      const options = { scenario: original.scenario, candidate: original.candidate, sourceManifest: report.manifest.sourceManifest, signal: controller.signal };
      trial = exact ? await createBrowserSurveyReplaySession(options) : await createBrowserSurveyTrial({ ...options, mode: 'compatibility', artifactPolicy: 'saved-assets-only' });
      if (!current()) return;
      replay = trial; if (!connected) paused = false; syncPause();
      element('surveyReplayStatus').textContent = exact ? 'Replaying the matching build in an isolated, muted worker.' : 'Comparing with the current runtime in a muted local replay. Execution identity remains unverified.';
      while (current() && !trial.done && trial.world.tickIndex < original.scenario.horizonTicks) {
        if (!paused) await trial.step(Math.min(16, original.scenario.horizonTicks - trial.world.tickIndex));
        if (!current()) break;
        const tick = trial.world.tickIndex, pair = baseline(original), pairedTelemetry = milestoneAt(pair, tick);
        const camera = renderSurveyPreview(element('surveyFocus'), { ...trial.telemetry(), preview: trial.preview() }, { height: original.scenario.laneHeight });
        renderSurveyPreview(element('surveyBaseline'), pairedTelemetry, element('surveyCamera').value === 'shared' ? camera : { height: pair?.scenario?.laneHeight || 144 });
        element('surveyTick').textContent = 'Replay tick ' + tick;
        element('surveyBaselineStatus').textContent = pairedTelemetry ? 'Recorded baseline at or before replay tick ' + tick + '.' : 'No baseline checkpoint is retained at or before replay tick ' + tick + '.';
        await new Promise(resolve => window.setTimeout(resolve, paused ? 30 : 0));
      }
      if (current()) {
        const result = await trial.result(); if (!current()) return;
        const receipt = exact ? compareSurveyBoundReplay(original, result, trial.sourceVerification, report.manifest.sourceManifest?.executionIdentity) : compareSurveyCompatibilityReplay(original, result, trial.sourceVerification);
        element('surveyReplayStatus').textContent = exact ? receipt.matched ? 'Exact replay matched under the recorded build in a fresh worker. This checks consistency, not independent reliability.' :
          'Exact replay differs: ' + [...receipt.reasons, ...receipt.differences].join(', ') : receipt.compatibilityMatch ?
          'Recorded fields match under the current runtime. The active build is unverified; this is not an exact replay receipt or independent sample.' :
          'Current-runtime comparison differs: ' + [...receipt.reasons, ...receipt.differences].join(', ');
        window.__procgenSurveyReplayReceipt = receipt;
      }
    } catch (error) { if (current()) element('surveyReplayStatus').textContent = 'Could not verify: ' + error.message; }
    finally {
      releaseTrial(trial);
      if (current()) { replay = null; replayPending = false; replayAbort = null; if (!connected) paused = false; syncPause(); publishFocus(); }
    }
  });
  element('surveyReplayMode')?.addEventListener('change', () => {
    cancelReplay();
    const exact = element('surveyReplayMode').value === 'exact';
    element('surveyReplay').textContent = exact ? 'Replay matching build' : 'Compare with current runtime';
    if (exact && !compareActiveExecutionIdentity(report?.manifest?.sourceManifest?.executionIdentity).matched)
      element('surveyReplayStatus').textContent = 'Exact replay is unavailable for this report and application build. Choose current-runtime comparison to keep its execution guarantee explicit.';
  });
  let pollPending = false;
  const poll = async () => {
    if (disposed || !connected || pollPending || filePending !== null) return;
    pollPending = true; const epoch = loadEpoch;
    try {
      const response = await fetchData('/survey-api/report');
      if (!response.ok) throw new Error('Survey report request failed (' + response.status + ')');
      const value = await response.json(); if (!disposed && connected && epoch === loadEpoch) load(value, { refresh: true });
    } catch (error) { if (epoch === loadEpoch) status(error.message); }
    finally { pollPending = false; }
  };
  if (connected) polling = window.setInterval(poll, 1000);
  else if (url.searchParams.get('report')) {
    const target = new URL(url.searchParams.get('report'), window.location.href), epoch = ++loadEpoch;
    if (target.origin !== url.origin || !target.pathname.startsWith('/temp/procgen-surveys/')) status('Report must be a local project survey.');
    else fetchData(target.href).then(response => { if (!response.ok) throw new Error('Survey report request failed (' + response.status + ')'); return response.json(); })
      .then(value => { if (!disposed && epoch === loadEpoch) load(value); }).catch(error => { if (epoch === loadEpoch) status(error.message); });
  }
  return { load, select, render, getReport: () => report, dispose() { disposed = true; loadEpoch++; if (polling) window.clearInterval(polling); cancelReplay(); } };
};
if (typeof document !== 'undefined') { const dashboard = createSurveyDashboard({ document, window }); window.__procgenSurveyDashboard = dashboard; window.addEventListener('pagehide', () => dashboard.dispose(), { once: true }); }
export { createSurveyDashboard, renderSurveyPreview, surveyReviewOutcome, describeSurveyStep, describeSurveyStepSelection };
