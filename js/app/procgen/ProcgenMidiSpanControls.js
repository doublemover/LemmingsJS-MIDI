import { createMidiAutomationSpanControls } from '../midi-ui/midiAutomationSpanControls.js';
const createProcgenMidiSpanControls = options => createMidiAutomationSpanControls({ ...options, allowSpatialConversion: false, ids: {
  list: 'procgenSpanList', add: 'procgenSpanAdd', preset: 'procgenSpanPreset', presetApply: 'procgenSpanPresetApply',
  domain: 'procgenSpanDomain', target: 'procgenSpanTarget', presetStatus: 'procgenSpanPresetStatus'
} });
export { createProcgenMidiSpanControls };
