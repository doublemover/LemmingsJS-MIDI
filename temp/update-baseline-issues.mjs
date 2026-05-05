import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const raw = readFileSync('temp/bench-hotpaths-baseline.txt', 'utf8');
const first = raw.indexOf('{');
const last = raw.lastIndexOf('}');
if (first < 0 || last <= first) {
  throw new Error('Could not find JSON benchmark payload.');
}
const data = JSON.parse(raw.slice(first, last + 1));

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const node = execFileSync('node', ['-v'], { encoding: 'utf8' }).trim();
const npm = execSync('npm -v', { encoding: 'utf8' }).trim();
const os = execSync('powershell -NoProfile -Command "$PSVersionTable.OS"', { encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
const dirtyNote = status ? 'yes - pre-existing dirty worktree plus measurement harness changes' : 'no';
const command = 'npm run bench-hotpaths -- --repeats=6';
const profile = [
  `commit: ${commit}`,
  `worktree dirty: ${dirtyNote}`,
  `environment: ${os}; ${node}; npm ${npm}`,
  `command: \`${command}\``,
  'raw artifact: `temp/bench-hotpaths-baseline.txt`',
  'note: npm 11.13.0 emitted an unknown config warning for `--repeats`; the script invocation used its default 6 repeats.'
].join('\n');

const fixed = (value, digits = 2) => Number(value ?? 0).toFixed(digits);
const us = (summary) => fixed(summary?.usPerIteration, 4);
const p50 = (summary) => fixed(summary?.p50Ms, 2);

const sections = {
  919: `## Baseline Results
${profile}

Scenarios:
- historyReplayDelta.lemmings50: endTick p50 ${p50(data.historyReplayDelta.lemmings50.endTick)} ms (${us(data.historyReplayDelta.lemmings50.endTick)} us/tick), seek-window apply p50 ${p50(data.historyReplayDelta.lemmings50.seekWindowApply)} ms, retained deltas ${data.historyReplayDelta.lemmings50.retainedDeltaCount}, avg delta ${fixed(data.historyReplayDelta.lemmings50.avgDeltaBytes)} bytes, keyframes ${data.historyReplayDelta.lemmings50.keyframeBytes} bytes
- historyReplayDelta.lemmings200: endTick p50 ${p50(data.historyReplayDelta.lemmings200.endTick)} ms (${us(data.historyReplayDelta.lemmings200.endTick)} us/tick), seek-window apply p50 ${p50(data.historyReplayDelta.lemmings200.seekWindowApply)} ms, retained deltas ${data.historyReplayDelta.lemmings200.retainedDeltaCount}, avg delta ${fixed(data.historyReplayDelta.lemmings200.avgDeltaBytes)} bytes, keyframes ${data.historyReplayDelta.lemmings200.keyframeBytes} bytes
- historyReplayDelta.lemmings1000: endTick p50 ${p50(data.historyReplayDelta.lemmings1000.endTick)} ms (${us(data.historyReplayDelta.lemmings1000.endTick)} us/tick), seek-window apply p50 ${p50(data.historyReplayDelta.lemmings1000.seekWindowApply)} ms, retained deltas ${data.historyReplayDelta.lemmings1000.retainedDeltaCount}, avg delta ${fixed(data.historyReplayDelta.lemmings1000.avgDeltaBytes)} bytes, keyframes ${data.historyReplayDelta.lemmings1000.keyframeBytes} bytes`,

  920: `## Baseline Results
${profile}

Scenarios:
- terrainMasks.noSteelSteelCheck: p50 ${p50(data.terrainMasks.noSteelSteelCheck)} ms (${us(data.terrainMasks.noSteelSteelCheck)} us/call), hits ${data.terrainMasks.noSteelSteelCheck.truthy}
- terrainMasks.denseSteelCheck: p50 ${p50(data.terrainMasks.denseSteelCheck)} ms (${us(data.terrainMasks.denseSteelCheck)} us/call), hits ${data.terrainMasks.denseSteelCheck.truthy}
- terrainMasks.arrowCheck: p50 ${p50(data.terrainMasks.arrowCheck)} ms (${us(data.terrainMasks.arrowCheck)} us/call), hits ${data.terrainMasks.arrowCheck.truthy}
- terrainMasks.clearGroundWithMaskCount: p50 ${p50(data.terrainMasks.clearGroundWithMaskCount)} ms (${us(data.terrainMasks.clearGroundWithMaskCount)} us/call), removed ${data.terrainMasks.clearGroundWithMaskCount.removedPixels}, history records ${data.terrainMasks.clearGroundWithMaskCount.historyRecords}, minimap invalidations ${data.terrainMasks.clearGroundWithMaskCount.minimapInvalidations}
- terrainMasks.repeatedNoopClear: p50 ${p50(data.terrainMasks.repeatedNoopClear)} ms (${us(data.terrainMasks.repeatedNoopClear)} us/call), removed ${data.terrainMasks.repeatedNoopClear.removedPixels}, history records ${data.terrainMasks.repeatedNoopClear.historyRecords}
- terrainMasks.digRow: p50 ${p50(data.terrainMasks.digRow)} ms (${us(data.terrainMasks.digRow)} us/row), rows with removal ${data.terrainMasks.digRow.rowsWithRemoval}, history records ${data.terrainMasks.digRow.historyRecords}, minimap pixel updates ${data.terrainMasks.digRow.minimapPixelUpdates}`,

  921: `## Baseline Results
${profile}

Scenarios:
- midiRouter: p50 ${p50(data.midiRouter)} ms (${us(data.midiRouter)} us/event), alloc avg ${Math.round(data.midiRouter.allocBytesAvg)} bytes, alloc p95 ${Math.round(data.midiRouter.allocBytesP95)} bytes
- midiScheduler: p50 ${p50(data.midiScheduler)} ms (${us(data.midiScheduler)} us/note), alloc avg ${Math.round(data.midiScheduler.allocBytesAvg)} bytes, alloc p95 ${Math.round(data.midiScheduler.allocBytesP95)} bytes
- rate-limit behavior: baseline emitted scheduler throughput warnings during the saturated MIDI portions; final run must use the same command and warning-prone workload.`,

  922: `## Baseline Results
${profile}

Scenarios:
- dirtyRectUpload: p50 ${p50(data.dirtyRectUpload)} ms (${us(data.dirtyRectUpload)} us/iteration), alloc avg ${Math.round(data.dirtyRectUpload.allocBytesAvg)} bytes
- tileComposition: p50 ${p50(data.tileComposition)} ms (${us(data.tileComposition)} us/iteration), alloc avg ${Math.round(data.tileComposition.allocBytesAvg)} bytes
- marchingAnts: p50 ${p50(data.marchingAnts)} ms (${us(data.marchingAnts)} us/iteration), alloc avg ${Math.round(data.marchingAnts.allocBytesAvg)} bytes
- overlayPlane: p50 ${p50(data.overlayPlane)} ms (${us(data.overlayPlane)} us/iteration), alloc avg ${Math.round(data.overlayPlane.allocBytesAvg)} bytes
- scaledBlit: p50 ${p50(data.scaledBlit)} ms (${us(data.scaledBlit)} us/iteration), alloc avg ${Math.round(data.scaledBlit.allocBytesAvg)} bytes
- objectCulling.viewport100: p50 ${p50(data.objectCulling.viewport100)} ms (${us(data.objectCulling.viewport100)} us/render), candidates ${data.objectCulling.viewport100.candidatesConsidered}, drawn ${data.objectCulling.viewport100.drawn}
- objectCulling.viewport1000: p50 ${p50(data.objectCulling.viewport1000)} ms (${us(data.objectCulling.viewport1000)} us/render), candidates ${data.objectCulling.viewport1000.candidatesConsidered}, drawn ${data.objectCulling.viewport1000.drawn}
- objectCulling.viewport5000: p50 ${p50(data.objectCulling.viewport5000)} ms (${us(data.objectCulling.viewport5000)} us/render), candidates ${data.objectCulling.viewport5000.candidatesConsidered}, drawn ${data.objectCulling.viewport5000.drawn}
- objectCulling.fullBlit1000: p50 ${p50(data.objectCulling.fullBlit1000)} ms (${us(data.objectCulling.fullBlit1000)} us/render), candidates ${data.objectCulling.fullBlit1000.candidatesConsidered}, drawn ${data.objectCulling.fullBlit1000.drawn}`,

  923: `## Baseline Results
${profile}

Scenarios:
- guiOverlay: p50 ${p50(data.guiOverlay)} ms (${us(data.guiOverlay)} us/render), alloc avg ${Math.round(data.guiOverlay.allocBytesAvg)} bytes
- minimapIdle.pausedIdle: p50 ${p50(data.minimapIdle.pausedIdle)} ms (${us(data.minimapIdle.pausedIdle)} us/render), draw calls ${data.minimapIdle.pausedIdle.drawCalls}, composes ${data.minimapIdle.pausedIdle.composes}, reuses ${data.minimapIdle.pausedIdle.reuses}
- minimapIdle.manyLiveDots: p50 ${p50(data.minimapIdle.manyLiveDots)} ms (${us(data.minimapIdle.manyLiveDots)} us/render), draw calls ${data.minimapIdle.manyLiveDots.drawCalls}, composes ${data.minimapIdle.manyLiveDots.composes}, subarray fallbacks ${data.minimapIdle.manyLiveDots.subarrayFallbacks}
- minimapIdle.deathDots: p50 ${p50(data.minimapIdle.deathDots)} ms (${us(data.minimapIdle.deathDots)} us/render), draw calls ${data.minimapIdle.deathDots.drawCalls}, composes ${data.minimapIdle.deathDots.composes}
- minimapIdle.viewportMovement: p50 ${p50(data.minimapIdle.viewportMovement)} ms (${us(data.minimapIdle.viewportMovement)} us/render), draw calls ${data.minimapIdle.viewportMovement.drawCalls}, composes ${data.minimapIdle.viewportMovement.composes}
- gamepadIdle: p50 ${p50(data.gamepadIdle)} ms (${us(data.gamepadIdle)} us/frame), getGamepads calls ${data.gamepadIdle.getGamepadsCalls}, polls/frame ${data.gamepadIdle.pollsPerFrame}`
};

for (const [issue, section] of Object.entries(sections)) {
  const current = execFileSync('gh', ['issue', 'view', issue, '--json', 'body', '--jq', '.body'], {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  }).trimEnd();
  const marker = '## Baseline Results';
  const next = current.includes(marker)
    ? current.replace(new RegExp(`${marker}[\\s\\S]*$`), section)
    : `${current}\n\n${section}`;
  execFileSync('gh', ['issue', 'edit', issue, '--body', next], {
    stdio: 'inherit',
    maxBuffer: 2 * 1024 * 1024
  });
}
