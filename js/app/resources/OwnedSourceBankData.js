import { createSampleReadBankSync } from './SampleReadBankComputation.js';
import { CHOIR_EXCITER_TABLE } from '../midi-ui/worklet/ChoirExciterTable.js';
import { SPECTRUM_TABLES, SPECTRUM_SINE, SPECTRUM_FRAME_GAINS } from '../midi-ui/worklet/SpectrumSourceTables.js';
import { GRAIN_WINDOW } from '../midi-ui/worklet/GrainWindow.js';

export function createOwnedSourceBankPlanes(id) {
  if (id === 'sample-read-v1') return [createSampleReadBankSync()];
  const data = id === 'choir-v1' ? [CHOIR_EXCITER_TABLE] : id === 'spectrum-v1' ? [SPECTRUM_TABLES, SPECTRUM_SINE, SPECTRUM_FRAME_GAINS] : id === 'grain-window-v1' ? [GRAIN_WINDOW] : null;
  if (!data) throw new TypeError('Unknown fixed source bank.');
  return data.map(plane => new Float32Array(plane));
}
