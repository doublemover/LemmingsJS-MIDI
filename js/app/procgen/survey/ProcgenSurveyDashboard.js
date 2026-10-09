import { createBrowserSurveyTrial } from './ProcgenSurveyBrowserAssets.js';
import { compareSurveyReplay, firstSurveyDivergence } from './ProcgenSurveyReplay.js';

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
const createSurveyDashboard = ({ document, window, fetch: fetchData = window.fetch.bind(window) }) => {
  const element = id => document.getElementById(id), url = new URL(window.location.href), token = url.searchParams.get('token') || new URLSearchParams(url.hash.slice(1)).get('token');
  const tiles = new Map();
  let report = null, selectedId = null, replay = null, disposed = false, polling = null, paused = false;
  const status = text => { element('surveyStatus').textContent = text; };
  const records = () => report?.results || [];
  const selected = () => records().find(result => result.trialId === selectedId);
  const baseline = result => records().find(other => other.scenarioId === result?.scenarioId && other.candidate?.kind === 'baseline' && other.policySeed === result?.policySeed);
  const finalTelemetry = result => (report?.telemetry || []).find(([id]) => id === result?.trialId)?.[1] || result?.telemetry;
  const milestoneAt = (result, tick) => [...(result?.milestones || [])].reverse().find(entry => entry.tick <= tick)?.telemetry || result?.telemetry;
  const publishFocus = () => {
    const result = selected(); if (!result) return;
    const index = Number(element('surveyScrub').value) || 0, milestone = result.milestones?.[index], tick = milestone?.tick ?? result.lastTick;
    const telemetry = tick === result.lastTick ? finalTelemetry(result) || milestone?.telemetry : milestone?.telemetry;
    element('surveyReplay').disabled = !!replay || !result.episodeComplete;
    const camera = renderSurveyPreview(element('surveyFocus'), telemetry, { height: result.scenario?.laneHeight || 144 });
    const paired = baseline(result), pairedTelemetry = tick === paired?.lastTick ? finalTelemetry(paired) || milestoneAt(paired, tick) : milestoneAt(paired, tick);
    renderSurveyPreview(element('surveyBaseline'), pairedTelemetry, element('surveyCamera').value === 'shared' ? camera : { height: paired?.scenario?.laneHeight || 144 });
    element('surveyTick').textContent = 'Tick ' + tick; element('surveyFocusTitle').textContent = result.candidate?.family + ' · ' + result.scenarioId;
    const archive = report.exemplars?.selected?.find(entry => entry.trialId === result.trialId);
    element('surveyDetails').textContent = JSON.stringify({ status: result.status, policy: result.candidate?.configuration, accounting: result.accounting, skills: result.metrics?.skills,
      excavation: result.metrics?.excavatedPixels, pairedBaseline: paired?.trialId || null, selectionReason: archive?.reasons || null,
      exactReplay: archive?.qualification?.exactReplay || report.verification?.find(entry => entry.originalTrialId === result.trialId) || null,
      successQualification: report.successQualification?.find(entry => entry.originalTrialId === result.trialId) || null, evidence: result.evidence, previewTick: telemetry?.preview?.tick ?? tick, previewScope: telemetry?.preview?.terrainScope || 'Declared controlled terrain' }, null, 2);
  };
  const select = (id, keepPosition = false) => {
    const previousPosition = Number(element('surveyScrub').value); selectedId = id; const result = selected(); element('surveyScrub').max = Math.max(0, (result?.milestones?.length || 1) - 1);
    element('surveyScrub').value = keepPosition ? Math.min(previousPosition, Number(element('surveyScrub').max)) : element('surveyScrub').max;
    for (const tile of element('surveyMosaic').children) tile.classList.toggle('selected', tile.dataset.trialId === id); publishFocus();
  };
  const render = () => {
    if (!report) return; const manifest = report.manifest;
    element('surveySummary').textContent = manifest.candidates.length + ' logical candidates · ' + manifest.budgetPolicy.executionWorkers + ' CPU worker(s) · ' + manifest.budgetPolicy.residentWorlds + ' resident worlds · ' + (report.status || 'running');
    element('surveyEvidence').textContent = JSON.stringify({ source: manifest.sourceManifest, criteria: manifest.criteria, storage: report.storage, analysis: report.analysis, rankingsTrusted: report.rankingsTrusted }, null, 2);
    const scenePicker = element('surveyScene'), previousScene = scenePicker.value;
    if (!scenePicker.children.length) for (const scene of manifest.scenarios) { const option = document.createElement('option'); option.value = scene.id; option.textContent = scene.id; scenePicker.append(option); }
    if (previousScene) scenePicker.value = previousScene;
    const sceneId = scenePicker.value || manifest.developmentScenarioIds[0];
    const mosaic = element('surveyMosaic'); mosaic.classList.toggle('dense', manifest.candidates.length > 16);
    const remarkable = new Set((report.exemplars?.selected || []).filter(entry => entry.kind === 'success').map(entry => entry.trialId));
    const filter = element('surveyFilter').value, sort = element('surveySort').value;
    const data = records().filter(result => result.scenarioId === sceneId).filter(result => filter === 'all' || filter === 'success' ? filter !== 'success' || remarkable.has(result.trialId) : filter === 'failure' ? result.status === 'failed' || result.status === 'timeout' : filter === 'interrupted' ? ['interrupted', 'cancelled', 'infrastructure-error'].includes(result.status) : result.status === filter);
    const visibleIds = new Set(data.map(result => result.trialId)); for (const [id, tile] of tiles) tile.hidden = !visibleIds.has(id);
    data.sort((a, b) => sort === 'survival' ? (b.accounting?.alive || 0) - (a.accounting?.alive || 0) : sort === 'skills' ? (a.metrics?.skillCount || 0) - (b.metrics?.skillCount || 0) : sort === 'completion' ? (b.accounting?.arrived || 0) - (a.accounting?.arrived || 0) : a.candidateId.localeCompare(b.candidateId));
    for (const [index, result] of data.entries()) {
      let tile = tiles.get(result.trialId);
      if (!tile) { tile = document.createElement('button'); tile.type = 'button'; tile.className = 'survey-tile'; tile.dataset.trialId = result.trialId; tile.addEventListener('click', () => select(result.trialId)); tiles.set(result.trialId, tile); mosaic.append(tile); }
      tile.hidden = false; tile.style.order = String(index); tile.replaceChildren();
      tile.classList.toggle('failed', result.status === 'failed'); tile.classList.toggle('remarkable', remarkable.has(result.trialId));
      const name = document.createElement('strong'); name.textContent = result.candidate?.kind === 'no-learning' ? 'No learned preferences' : (result.candidate?.family || 'Candidate') + ' · ' + result.candidateId.slice(-4);
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96;
      const detail = document.createElement('small'); detail.textContent = result.scenarioId + ' · tick ' + result.lastTick + ' · ' + result.status;
      const counts = document.createElement('small'); counts.textContent = (result.accounting?.alive ?? '?') + '/' + (result.accounting?.designated ?? '?') + ' alive · ' + (result.accounting?.arrived ?? '?') + ' arrived · ' + (result.accounting?.deaths ?? '?') + ' lost';
      tile.append(name, canvas, detail, counts);
      renderSurveyPreview(canvas, finalTelemetry(result) || milestoneAt(result, result.lastTick), { height: result.scenario?.laneHeight || 144 });
    }
    if (!selectedId || !data.some(result => result.trialId === selectedId)) selectedId = data[0]?.trialId; if (selectedId) select(selectedId, true);
  };
  const load = value => {
    const next = value.value || value;
    if (next.schemaVersion !== 1 || !next.manifest?.candidates || next.manifest.candidates.length > 64 || !Array.isArray(next.results) || next.results.length > 4096) throw new Error('Unsupported or oversized survey report');
    if (report?.manifest?.experimentId !== next.manifest.experimentId) { for (const tile of tiles.values()) tile.remove(); tiles.clear(); element('surveyScene').replaceChildren(); selectedId = null; }
    if (token && typeof next.controlState?.paused === 'boolean') { paused = next.controlState.paused; element('surveyPause').textContent = paused ? 'Resume all' : 'Pause all'; }
    report = next; render(); status('Recorded comparison loaded. Missing validity or truncated evidence stays explicit; no policy winner is claimed.');
  };
  const control = async command => {
    if (!token) { if (command === 'step') { element('surveyScrub').value = Math.min(Number(element('surveyScrub').max), Number(element('surveyScrub').value) + 1); publishFocus(); } return; }
    const response = await fetchData('/survey-api/control', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Survey-Token': token }, body: JSON.stringify({ command }) }); if (!response.ok) throw new Error('Survey control was rejected');
  };
  element('surveyFile').addEventListener('change', async event => { try { const file = event.target.files[0]; if (!file || file.size > 64 * 1048576) throw new Error('Report exceeds the 64 MiB view limit'); load(JSON.parse(await file.text())); } catch (error) { status(error.message); } });
  element('surveyScene').addEventListener('change', render); element('surveyFilter').addEventListener('change', render); element('surveySort').addEventListener('change', render); element('surveyScrub').addEventListener('input', publishFocus); element('surveyCamera').addEventListener('change', publishFocus);
  element('surveyPause').addEventListener('click', async () => { paused = !paused; element('surveyPause').textContent = paused ? 'Resume all' : 'Pause all'; await control(paused ? 'pause' : 'resume').catch(error => status(error.message)); });
  element('surveyStep').addEventListener('click', () => control('step').catch(error => status(error.message)));
  element('surveyCancel').disabled = !token; element('surveyCancel').addEventListener('click', () => control('cancel').catch(error => status(error.message)));
  element('surveyDivergence').addEventListener('click', () => { const result = selected(), pair = baseline(result); const divergence = result && pair && firstSurveyDivergence(pair, result);
    if (!divergence) { status('No physical/event divergence at retained common checkpoints.'); return; }
    element('surveyScrub').value = result.milestones.findIndex(entry => entry.tick === divergence.throughTick); publishFocus(); status('First recorded divergence between ticks ' + divergence.fromTick + ' and ' + divergence.throughTick + '. Exact localization needs detailed replay.'); });
  element('surveyExport').addEventListener('click', () => { if (!report) return; const href = window.URL.createObjectURL(new Blob([JSON.stringify(report)], { type: 'application/json' })); const link = document.createElement('a'); link.href = href; link.download = report.manifest.experimentId + '.json'; link.click(); window.setTimeout(() => window.URL.revokeObjectURL(href), 1000); });
  element('surveyReplay').addEventListener('click', async () => {
    const original = selected(); if (!original?.episodeComplete || replay) return;
    const button = element('surveyReplay'); button.disabled = true; element('surveyReplayStatus').textContent = 'Checking exact source and assets…';
    try {
      replay = await createBrowserSurveyTrial({ scenario: original.scenario, candidate: original.candidate, sourceManifest: report.manifest.sourceManifest });
      while (!disposed && !replay.done && replay.world.tickIndex < original.scenario.horizonTicks) {
        if (!paused) replay.step(Math.min(16, original.scenario.horizonTicks - replay.world.tickIndex));
        renderSurveyPreview(element('surveyFocus'), { ...replay.telemetry(), preview: replay.preview() }, { height: original.scenario.laneHeight });
        await new Promise(resolve => window.setTimeout(resolve, paused ? 30 : 0));
      }
      if (!disposed) { const receipt = compareSurveyReplay(original, replay.result()); element('surveyReplayStatus').textContent = receipt.matched ? 'Exact physics and event hashes match. This rerun is not an independent sample.' : 'Replay mismatch: ' + receipt.differences.join(', '); window.__procgenSurveyReplayReceipt = receipt; }
    } catch (error) { element('surveyReplayStatus').textContent = 'Could not verify: ' + error.message; }
    finally { replay?.dispose(); replay = null; button.disabled = false; }
  });
  if (token) polling = window.setInterval(async () => { if (disposed) return; try { const response = await fetchData('/survey-api/report'); if (response.ok) load(await response.json()); } catch (error) { status(error.message); } }, 1000);
  else if (url.searchParams.get('report')) {
    const target = new URL(url.searchParams.get('report'), window.location.href);
    if (target.origin !== url.origin || !target.pathname.startsWith('/temp/procgen-surveys/')) status('Report must be a local project survey.');
    else fetchData(target.href).then(response => response.json()).then(load).catch(error => status(error.message));
  }
  return { load, select, render, getReport: () => report, dispose() { disposed = true; if (polling) window.clearInterval(polling); replay?.dispose(); replay = null; } };
};
if (typeof document !== 'undefined') { const dashboard = createSurveyDashboard({ document, window }); window.__procgenSurveyDashboard = dashboard; window.addEventListener('pagehide', () => dashboard.dispose(), { once: true }); }
export { createSurveyDashboard, renderSurveyPreview };
