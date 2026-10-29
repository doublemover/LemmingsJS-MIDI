import { MIN_DESKTOP_VIEWPORT } from '../e2e/helpers/desktopViewports.js';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const base = process.env.LEMMINGS_E2E_BASE_URL || 'http://127.0.0.1:8189';
const browser = await chromium.launch({ headless: true, executablePath: process.env.LEMMINGS_E2E_EXECUTABLE || undefined });
const sourceFiles = ['scripts/profile-procgen-editing.mjs', 'js/app/procgen/workstation/ProcgenWorkstation.js', 'js/app/procgen/workstation/ProcgenWorkstationView.js', 'js/app/procgen/workstation/LaneMixState.js', 'js/app/procgen/workstation/ProcgenStartupIntent.js', 'js/app/procgen/workstation/ProcgenPreferenceWriter.js', 'js/app/resources/BackgroundSnapshotPages.js', 'js/app/resources/BackgroundJobService.js'];
const report = { schema: 'procgen-edit-cost/v2', sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])),
  environment: { cpu: cpus()[0]?.model || null, node: process.version, browser: browser.version(), date: new Date().toISOString(), isolation: 'Shared local development host; not a dedicated reference-machine release gate.' }, cases: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: MIN_DESKTOP_VIEWPORT });
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(error.message));
  for (const laneCount of [8, 128, 1024]) {
    await page.goto(`${base}/procgen.html?e2e=1&seed=42&lanes=${laneCount}`);
    await page.waitForFunction(() => window.__PROCGEN_STUDIO__ && window.__PROCGEN_LANES__?.world?.workstationEnabled);
    report.cases.push(await page.evaluate(async laneCount => {
      const studio = window.__PROCGEN_STUDIO__, runtime = window.__PROCGEN_LANES__; studio.transport.pause(); runtime.pause();
      const { procgenIndexDiagnostics } = await import(new URL('./js/app/procgen/workstation/ProcgenProjectIndex.js', window.location.href).href);
      const { createProcgenPattern } = await import(new URL('./js/app/procgen/workstation/ProcgenWorkstationProject.js', window.location.href).href);
      for (const lane of studio.getProject().procgen.lanes) {
        const pattern = createProcgenPattern(lane.family, lane.role); pattern.length = 64; pattern.steps = Array.from({ length: 64 }, (_, index) => ({ ...pattern.steps[index % 16] }));
        studio.dispatch({ type: 'procgen/lane', laneId: lane.id, patch: { mode: 'pattern', patternPurpose: 'Performance harness: complementary control input', patterns: Array.from({ length: 4 }, () => pattern) } });
      }
      const samples = { step: [], gain: [], midiCapture: [], launchAcknowledgment: [], schedulingLateness: [] }, longTasks = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ type: 'longtask', buffered: false });
      const heapBefore = performance.memory?.usedJSHeapSize ?? null, indexesBefore = procgenIndexDiagnostics();
      const physical = () => JSON.stringify({ tick: runtime.world.tickIndex, generation: runtime.world.generation, terrain: runtime.world.terrainRevision,
        actors: runtime.world.actors.map(actor => [actor.id, actor.x, actor.y, actor.laneIndex]) });
      const physicalBefore = physical(), mixBefore = studio.getPhysicalOutputDiagnostics()?.laneMix;
      if (studio.handlers.record(true) !== true) throw new Error('The production recording owner did not arm.');
      const recordedBefore = studio.ports.getState().recordedEvents; let acceptedPackets = 0;
      const start = performance.now();
      for (let index = 0; index < 480; index++) {
        const deadline = start + index * 1000 / 120; await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - performance.now())));
        samples.schedulingLateness.push(Math.max(0, performance.now() - deadline));
        for (const [kind, operation] of [
          ['step', () => studio.dispatch({ type: 'procgen/step', laneId: 'lane-1', slot: 0, index: index % 64, patch: { note: 48 + index % 24 } })],
          ['gain', () => studio.dispatch({ type: 'procgen/lane', laneId: 'lane-1', patch: { gain: (index % 127) / 127 } })],
          ['midiCapture', () => { acceptedPackets += Number(studio.ports.receiveMidi([0x90, 60 + index % 12, 80], performance.now()) === true); acceptedPackets += Number(studio.ports.receiveMidi([0x80, 60 + index % 12, 0], performance.now() + 1) === true); }]
        ]) { const before = performance.now(); operation(); samples[kind].push(performance.now() - before); }
      }
      for (let index = 0; index < 64; index++) {
        const launches = studio.getProject().procgen.lanes.map(lane => ({ laneId: lane.id, slot: index % 4 })), before = performance.now();
        studio.dispatch({ type: 'procgen/launchedBatch', launches }); samples.launchAcknowledgment.push(performance.now() - before);
      }
      const recordedAfter = studio.ports.getState().recordedEvents; studio.handlers.record(false);
      await new Promise(resolve => setTimeout(resolve, 300));
      const persistenceDeadline = performance.now() + 5000;
      while (studio.getPreferenceState()?.pendingRevision != null && performance.now() < persistenceDeadline) await new Promise(resolve => setTimeout(resolve, 20));
      observer.disconnect();
      if (acceptedPackets !== 960 || recordedAfter - recordedBefore < 960) throw new Error('The production input/recording workload was incomplete.');
      if (physical() !== physicalBefore || studio.getPlaybackState().enabled) throw new Error('The edit benchmark changed physical state or activated output.');
      const summary = values => { values.sort((a, b) => a - b); return Object.fromEntries([['p50', .5], ['p95', .95], ['p99', .99]].map(([name, fraction]) => [name, values[Math.floor((values.length - 1) * fraction)] ?? null])); };
      const preferences = studio.getPreferenceState(), preferenceCurrent = preferences?.pendingRevision == null && preferences?.durableRevision === studio.getDocumentState().editRevision;
      return { laneCount, patternLength: 64, controllerHz: 120, samples: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, { count: values.length, ...summary(values) }])),
        longTasks, heapBefore, heapAfter: performance.memory?.usedJSHeapSize ?? null, indexesBefore, indexesAfter: procgenIndexDiagnostics(), preferences, preferenceCurrent,
        workload: { acceptedPackets, recordedDelta: recordedAfter - recordedBefore, physicalUnchanged: true, outputEnabled: false },
        mixBefore, mixAfter: studio.getPhysicalOutputDiagnostics()?.laneMix,
        taskBudgetMs: 16, tasksOverBudget: Object.fromEntries(Object.entries(samples).filter(([key]) => key !== 'schedulingLateness').map(([key, values]) => [key, values.filter(value => value > 16).length])),
        qualification: 'Actual controller/view/recording and coalesced preference writer, supplied valid MIDI packets at120Hz; no connected hardware, physical output or acoustic evidence. localStorage completion is not an OS durability claim.',
        userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
    }, laneCount));
  }
} catch (error) { report.errors.push(String(error?.stack || error)); }
finally { await browser.close(); }
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (report.errors.length) process.exitCode = 1;
