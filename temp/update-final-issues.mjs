import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function readBench(path) {
  const raw = readFileSync(path, 'utf8');
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) {
    throw new Error(`Could not find JSON benchmark payload in ${path}.`);
  }
  return JSON.parse(raw.slice(first, last + 1));
}

const baseline = readBench('temp/bench-hotpaths-baseline.txt');
const final = readBench('temp/bench-hotpaths-rerun.txt');

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const node = execFileSync('node', ['-v'], { encoding: 'utf8' }).trim();
const npm = execSync('npm -v', { encoding: 'utf8' }).trim();
const os = execSync('powershell -NoProfile -Command "$PSVersionTable.OS"', { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
const dirtyNote = status ? 'yes - pre-existing dirty worktree plus performance changes' : 'no';
const command = 'node scripts\\bench-hotpaths.js --repeats=6';
const profile = [
  `commit: ${commit}`,
  `worktree dirty: ${dirtyNote}`,
  `environment: ${os}; ${node}; npm ${npm}`,
  `command: \`${command}\``,
  'raw artifact: `temp/bench-hotpaths-rerun.txt`',
  'note: this rerun uses the same Node harness and 6-repeat profile as baseline; it calls the script directly so npm does not swallow the `--repeats` argument.'
].join('\n');

function get(obj, path) {
  return path.split('.').reduce((value, key) => value?.[key], obj);
}

function fixed(value, digits = 2) {
  return Number(value ?? 0).toFixed(digits);
}

function percent(delta, base) {
  if (!Number.isFinite(base) || base === 0) {
    return 'n/a';
  }
  return `${delta >= 0 ? '+' : ''}${fixed((delta / base) * 100, 1)}%`;
}

function row(label, path, unit = '', digits = 2) {
  const before = Number(get(baseline, path));
  const after = Number(get(final, path));
  const delta = after - before;
  const suffix = unit ? ` ${unit}` : '';
  return `- ${label}: baseline ${fixed(before, digits)}${suffix}, final ${fixed(after, digits)}${suffix}, delta ${delta >= 0 ? '+' : ''}${fixed(delta, digits)}${suffix} (${percent(delta, before)})`;
}

function countRow(label, path) {
  return row(label, path, '', 0);
}

function issueBody(issue, section) {
  const current = execFileSync('gh', ['issue', 'view', String(issue), '--json', 'body', '--jq', '.body'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  }).trimEnd();
  const marker = '## Final Results';
  return current.includes(marker)
    ? current.replace(new RegExp(`${marker}[\\s\\S]*$`), section)
    : `${current}\n\n${section}`;
}

const sections = {
  919: `## Final Results
${profile}

Scenarios:
${row('historyReplayDelta.lemmings50 endTick p50', 'historyReplayDelta.lemmings50.endTick.p50Ms', 'ms')}
${row('historyReplayDelta.lemmings50 seek-window apply p50', 'historyReplayDelta.lemmings50.seekWindowApply.p50Ms', 'ms')}
${row('historyReplayDelta.lemmings50 avg delta', 'historyReplayDelta.lemmings50.avgDeltaBytes', 'bytes')}
${row('historyReplayDelta.lemmings200 endTick p50', 'historyReplayDelta.lemmings200.endTick.p50Ms', 'ms')}
${row('historyReplayDelta.lemmings200 seek-window apply p50', 'historyReplayDelta.lemmings200.seekWindowApply.p50Ms', 'ms')}
${row('historyReplayDelta.lemmings200 avg delta', 'historyReplayDelta.lemmings200.avgDeltaBytes', 'bytes')}
${row('historyReplayDelta.lemmings1000 endTick p50', 'historyReplayDelta.lemmings1000.endTick.p50Ms', 'ms')}
${row('historyReplayDelta.lemmings1000 seek-window apply p50', 'historyReplayDelta.lemmings1000.seekWindowApply.p50Ms', 'ms')}
${row('historyReplayDelta.lemmings1000 avg delta', 'historyReplayDelta.lemmings1000.avgDeltaBytes', 'bytes')}

Notes:
- Delta size improved across all replay sizes while keyframe size and replay hashes stayed stable.
- End-tick p50 improved for all three lemming counts. The 50-lemming seek p50 remained slightly slower, but the larger seek cases and tail samples improved.`,

  920: `## Final Results
${profile}

Scenarios:
${row('terrainMasks.noSteelSteelCheck p50', 'terrainMasks.noSteelSteelCheck.p50Ms', 'ms')}
${row('terrainMasks.denseSteelCheck p50', 'terrainMasks.denseSteelCheck.p50Ms', 'ms')}
${row('terrainMasks.arrowCheck p50', 'terrainMasks.arrowCheck.p50Ms', 'ms')}
${row('terrainMasks.clearGroundWithMaskCount p50', 'terrainMasks.clearGroundWithMaskCount.p50Ms', 'ms')}
${row('terrainMasks.repeatedNoopClear p50', 'terrainMasks.repeatedNoopClear.p50Ms', 'ms')}
${row('terrainMasks.digRow p50', 'terrainMasks.digRow.p50Ms', 'ms')}
${countRow('terrainMasks.digRow minimap pixel updates', 'terrainMasks.digRow.minimapPixelUpdates')}
${countRow('terrainMasks.digRow minimap invalidations', 'terrainMasks.digRow.minimapInvalidations')}

Notes:
- Most mask scan and terrain mutation p50 values improved in this run.
- clearGroundWithMask p50 was effectively flat/slightly slower, but tail samples improved; dig rows preserve per-pixel history records while replacing 2520 minimap pixel updates with 280 row invalidations.`,

  921: `## Final Results
${profile}

Scenarios:
${row('midiRouter p50', 'midiRouter.p50Ms', 'ms')}
${row('midiRouter us/event', 'midiRouter.usPerIteration', 'us', 4)}
${row('midiRouter alloc avg', 'midiRouter.allocBytesAvg', 'bytes', 0)}
${row('midiRouter alloc p95', 'midiRouter.allocBytesP95', 'bytes', 0)}
${row('midiScheduler p50', 'midiScheduler.p50Ms', 'ms')}
${row('midiScheduler us/note', 'midiScheduler.usPerIteration', 'us', 4)}
${row('midiScheduler alloc avg', 'midiScheduler.allocBytesAvg', 'bytes', 0)}
${row('midiScheduler alloc p95', 'midiScheduler.allocBytesP95', 'bytes', 0)}

Notes:
- Router hot-path p50 and allocations improved substantially after reserving scheduler capacity once per plan and removing per-note object spreads.
- The standalone scheduler p50 improved in the rerun; allocation p95 remained higher than baseline and should be watched in future MIDI-heavy profiling.`,

  922: `## Final Results
${profile}

Scenarios:
${row('dirtyRectUpload p50', 'dirtyRectUpload.p50Ms', 'ms')}
${row('tileComposition p50', 'tileComposition.p50Ms', 'ms')}
${row('marchingAnts p50', 'marchingAnts.p50Ms', 'ms')}
${row('overlayPlane p50', 'overlayPlane.p50Ms', 'ms')}
${row('scaledBlit p50', 'scaledBlit.p50Ms', 'ms')}
${row('objectCulling.viewport100 p50', 'objectCulling.viewport100.p50Ms', 'ms')}
${row('objectCulling.viewport1000 p50', 'objectCulling.viewport1000.p50Ms', 'ms')}
${row('objectCulling.viewport5000 p50', 'objectCulling.viewport5000.p50Ms', 'ms')}
${row('objectCulling.fullBlit1000 p50', 'objectCulling.fullBlit1000.p50Ms', 'ms')}

Notes:
- Render-stamp object de-duping improved viewport object culling across tested sizes.
- The rerun shows broad render-path p50 wins; fullBlit1000 p95/p99 had one slow sample and should be treated as residual measurement noise or a follow-up profiling target.`,

  923: `## Final Results
${profile}

Scenarios:
${row('guiOverlay p50', 'guiOverlay.p50Ms', 'ms')}
${row('minimapIdle.pausedIdle p50', 'minimapIdle.pausedIdle.p50Ms', 'ms')}
${countRow('minimapIdle.pausedIdle draw calls', 'minimapIdle.pausedIdle.drawCalls')}
${row('minimapIdle.manyLiveDots p50', 'minimapIdle.manyLiveDots.p50Ms', 'ms')}
${countRow('minimapIdle.manyLiveDots subarray fallbacks', 'minimapIdle.manyLiveDots.subarrayFallbacks')}
${row('minimapIdle.deathDots p50', 'minimapIdle.deathDots.p50Ms', 'ms')}
${row('minimapIdle.viewportMovement p50', 'minimapIdle.viewportMovement.p50Ms', 'ms')}
${row('gamepadIdle p50', 'gamepadIdle.p50Ms', 'ms')}
${countRow('gamepadIdle getGamepads calls', 'gamepadIdle.getGamepadsCalls')}
${row('gamepadIdle polls/frame', 'gamepadIdle.pollsPerFrame', '', 4)}

Notes:
- Idle minimap draw calls dropped from 2200 to 23, live-dot subarray fallbacks dropped from 15400 to 0, and no-gamepad polling dropped from 1200 calls to 21 calls.
- GUI, minimap, and gamepad p50 timings improved in the rerun; manyLiveDots retained one slow tail sample and should be watched in future tail-latency runs.`
};

for (const [issue, section] of Object.entries(sections)) {
  const next = issueBody(issue, section);
  execFileSync('gh', ['issue', 'edit', issue, '--body', next], {
    stdio: 'inherit',
    maxBuffer: 2 * 1024 * 1024
  });
}
