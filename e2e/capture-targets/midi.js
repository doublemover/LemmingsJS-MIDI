const config = {
  name: 'midi',
  route: '/',
  async setup(page) {
    await page.waitForSelector('#midiEnabledToggle', { state: 'visible' });
    await page.locator('#midiEnabledToggle').check();
    await page.waitForSelector('#midiSequencerWorkspace', { state: 'visible' });
    await page.waitForSelector('#midiSourceList .midi-source-row');
    await page.evaluate(() => {
      if (!window.__E2E__?.midiGetProject?.().clips.length) {
        window.__E2E__?.midiDispatchProjectIntent?.({
          type: 'clip.add',
          clip: { id: 'capture-clip', name: 'Capture Clip', lengthSteps: 8 }
        });
      }
      window.__E2E__?.midiSaveProjectTemplate?.({
        id: 'capture-template',
        name: 'Capture Template',
        now: 1
      });
      window.__E2E__?.midiDispatchProjectIntent?.({
        type: 'clip.step.update',
        clipId: 'capture-clip',
        stepIndex: 0,
        patch: { note: 64, velocity: 90 }
      });
      window.__E2E__?.midiDispatchProjectIntent?.({
        type: 'source.clip.assign',
        sourceId: 'sfx-1',
        clipId: 'capture-clip'
      });
      const project = window.__E2E__?.midiGetProject?.();
      const source = project?.sources?.find(entry => entry.id === 'sfx-1');
      if (source) {
        const ensureLane = (lanes, lane) => (
          lanes.some(entry => entry.id === lane.id) ? lanes : [...lanes, lane]
        );
        let automation = project.automation || [];
        automation = ensureLane(automation, { id: 'capture-note-lane', name: 'Capture Note', target: 'note', axis: 'x', min: -7, max: 7, enabled: true });
        automation = ensureLane(automation, { id: 'capture-pan-lane', name: 'Capture Pan', target: 'pan', axis: 'x', min: -80, max: 80, enabled: true });
        automation = ensureLane(automation, { id: 'capture-duration-lane', name: 'Capture Duration', target: 'duration', axis: 'y', min: 3, max: 18, enabled: true });
        window.__E2E__?.midiDispatchProjectIntent?.({
          type: 'project.set',
          project: {
            ...project,
            global: {
              ...project.global,
              velocityRange: { ...project.global.velocityRange, default: 96 },
              density: { ...project.global.density, velocityBoost: 0.8 },
              position: { ...project.global.position, viewPan: true }
            },
            tracks: project.tracks.map(track => (
              track.id === 'track-1' ? { ...track, velocityScale: 0.75 } : track
            )),
            sources: project.sources.some(entry => entry.id === 'capture-sfx-conflict')
              ? project.sources
              : [
                ...project.sources,
                {
                  ...source,
                  id: 'capture-sfx-conflict',
                  label: 'Capture Conflict'
                }
              ],
            automation,
            ui: {
              ...project.ui,
              selectedSourceId: 'sfx-1',
              selectedClipId: 'capture-clip'
            }
          }
        });
      }
    });
    await page.waitForSelector('#midiClipList .midi-clip-row');
    await page.waitForSelector('#midiStepPatternGrid .midi-step-cell');
    await page.waitForSelector('#midiSourceList .midi-conflict-badge');
  },
  targets: [
    { name: 'midi-transport', type: 'selector', selector: '#midiTransportStrip' },
    { name: 'midi-canvas', type: 'runtimeRect', id: 'canvas' },
    { name: 'midi-viewport', type: 'viewport' },
    { name: 'midi-source-browser', type: 'selector', selector: '#midiSourceBrowser' },
    { name: 'midi-track-workspace', type: 'selector', selector: '#midiTrackWorkspace' },
    { name: 'midi-clip-library', type: 'selector', selector: '#midiClipLibrary' },
    { name: 'midi-inspector', type: 'selector', selector: '#midiInspector' },
    { name: 'midi-conflict-summary', type: 'selector', selector: '#midiConflictSummary' },
    { name: 'midi-modulation', type: 'selector', selector: '#midiModulationInspector' },
    { name: 'midi-step-pattern', type: 'selector', selector: '#midiStepPatternGrid' },
    { name: 'midi-output-status', type: 'selector', selector: '#midiOutputStatus' }
  ],
  probes: [
    {
      name: 'midi-source-browser',
      selector: '#midiSourceBrowser',
      checks: ['horizontalOverflow']
    },
    {
      name: 'midi-track-workspace',
      selector: '#midiTrackWorkspace',
      checks: ['horizontalOverflow']
    },
    {
      name: 'midi-clip-library',
      selector: '#midiClipLibrary',
      checks: ['horizontalOverflow']
    },
    {
      name: 'midi-inspector',
      selector: '#midiInspector',
      checks: ['horizontalOverflow']
    },
    {
      name: 'midi-conflict-summary',
      selector: '#midiConflictSummary',
      checks: ['horizontalOverflow', 'clippedText']
    },
    {
      name: 'midi-modulation',
      selector: '#midiModulationInspector',
      checks: ['horizontalOverflow']
    },
    {
      name: 'midi-step-pattern',
      selector: '#midiStepPatternGrid',
      checks: ['horizontalOverflow']
    }
  ]
};

export default config;
