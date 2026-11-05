import { expect, test } from '@playwright/test';

test('native browser input callbacks preserve accepted bytes and cannot resume a retiring owner', { tag: '@boundary' }, async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    globalThis.__ingressAudioOpens = 0; globalThis.__ingressPermissionRequests = 0;
    const NativeContext = globalThis.AudioContext;
    if (NativeContext) globalThis.AudioContext = class extends NativeContext { constructor(options) { globalThis.__ingressAudioOpens++; super(options); } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { globalThis.__ingressPermissionRequests++; throw new Error('Unexpected MIDI permission request'); } });
  });
  await page.route('**/__midi_ingress_fixture__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>MIDI ingress ownership</title>' }));
  await page.goto('/__midi_ingress_fixture__');
  const result = await page.evaluate(async () => {
    const [{ createProcgenMidiPorts }, { createResourceBudget }] = await Promise.all([import('/js/app/procgen/workstation/ProcgenMidiPorts.js'), import('/js/app/resources/ResourceBudget.js')]);
    const disposal = [], aliases = [];
    for (const selected of [false, true]) for (const boundary of ['monitor', 'transport', 'record', 'learn']) {
      const calls = []; let ports, retirement;
      const observe = name => { calls.push(name); if (name === boundary) retirement = ports.dispose(); };
      ports = createProcgenMidiPorts({ now: () => 1000, maxRecordedEvents: 512,
        transport: { panic() {}, pause() {}, getState: () => ({ beat: 2, bpm: 120 }), receiveMidi() { observe('transport'); } },
        onMonitor: () => observe('monitor'), onRecord: () => observe('record'), onLearn: () => observe('learn') });
      if (selected) ports.setInput({ id: 'native-input', state: 'connected' });
      ports.configure({ recording: true }); ports.learnNext();
      const accepted = ports.receiveMidi([0x90, 60, 90], 1000); await retirement.completion;
      const lateAccepted = ports.receiveMidi([0x90, 61, 90], 1000);
      disposal.push({ selected, boundary, accepted, lateAccepted, calls, outcome: retirement.outcome, resources: retirement.resources, learning: ports.getState().learning });
    }
    for (const typed of [false, true]) {
      const input = typed ? Uint8Array.of(0x90, 60, 90) : [0x90, 60, 90], transportRows = []; let immutable = false;
      const ports = createProcgenMidiPorts({ now: () => 1000, maxRecordedEvents: 512,
        transport: { panic() {}, pause() {}, getState: () => ({ beat: 2, bpm: 120 }), receiveMidi(data) { immutable = Object.isFrozen(data); transportRows.push([...data]); } }, onMonitor() { input.fill(255); } });
      ports.configure({ recording: true }); const accepted = ports.receiveMidi(input, 1000);
      const rows = ports.getRecording().map(row => ({ data: row.data, source: row.source })); const retirement = ports.dispose(); await retirement.completion;
      aliases.push({ typed, accepted, immutable, transportRows, rows, outcome: retirement.outcome, resources: retirement.resources });
    }
    const budget = createResourceBudget(), attempts = []; let ports, nested, cleanupCalls = 0;
    const cleanup = () => { cleanupCalls++; nested = ports.dispose(); attempts.push(ports.receiveMidi([0x90, 60, 90], 1000), ports.recordEvent({ type: 'noteOn', note: 60 })); };
    ports = createProcgenMidiPorts({ now: () => 1000, maxRecordedEvents: 512, resourceBudget: budget,
      transport: { getState: () => ({ beat: 2, bpm: 120 }), receiveMidi() {}, panic: cleanup, pause: cleanup } });
    ports.configure({ recording: true }); const retirement = ports.dispose(); await retirement.completion;
    ports.setClockOutput({ id: 'retired-clock', state: 'connected' });
    let standalone;
    standalone = createProcgenMidiPorts({ now: () => 1000, performanceCoordinator: null, transport: { panic() {}, getState: () => ({ beat: 2, bpm: 120 }), setClockOutput() { standalone.dispose(); } } });
    standalone.setClockOutput({ id: 'obsolete-clock' }); const standaloneRetirement = standalone.dispose(); await standaloneRetirement.completion;
    return { disposal, aliases, reentrant: { sameReceipt: nested === retirement, cleanupCalls, attempts, outcome: retirement.outcome, accountedBytes: budget.diagnostics().accountedBytes, clockOutputId: ports.getState().clockOutputId }, reentrantResources: retirement.resources,
      standaloneClock: { clockOutputId: standalone.getState().clockOutputId, outcome: standaloneRetirement.outcome },
      audioOpens: globalThis.__ingressAudioOpens, permissionRequests: globalThis.__ingressPermissionRequests };
  });
  await testInfo.attach('native-midi-ingress-ownership', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.disposal).toHaveLength(8);
  for (const row of result.disposal) {
    const order = ['monitor', 'transport', 'record', 'learn'];
    expect(row).toMatchObject({ accepted: false, lateAccepted: false, outcome: 'complete', learning: false });
    expect(row.calls).toEqual(order.slice(0, order.indexOf(row.boundary) + 1));
  }
  for (const row of result.aliases) expect(row).toMatchObject({ accepted: true, immutable: true, transportRows: [[0x90, 60, 90]], rows: [{ data: [0x90, 60, 90], source: 'input' }], outcome: 'complete' });
  expect(result.reentrant).toEqual({ sameReceipt: true, cleanupCalls: 1, attempts: [false, false], outcome: 'complete', accountedBytes: 0, clockOutputId: null });
  expect(result.standaloneClock).toEqual({ clockOutputId: null, outcome: 'complete' });
  expect(result.audioOpens).toBe(0); expect(result.permissionRequests).toBe(0);
});
