import { createMidiAutomationSpanControls } from '../midi-ui/midiAutomationSpanControls.js';
const createProcgenMidiSpanControls = options => createMidiAutomationSpanControls({ ...options, allowSpatialConversion: false, includeSpatial: true, ids: {
  list: 'procgenSpanList', add: 'procgenSpanAdd', preset: 'procgenSpanPreset', presetApply: 'procgenSpanPresetApply',
  domain: 'procgenSpanDomain', target: 'procgenSpanTarget', targetHelp: 'procgenSpanTargetHelp', presetStatus: 'procgenSpanPresetStatus'
} });
export { createProcgenMidiSpanControls };
