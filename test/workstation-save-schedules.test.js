import { replaySaveSchedule } from './support/workstation-save-schedules.js';

describe('save resume leases across generated pending phases', function() {
  this.timeout(15000);
  for (const seed of [17, 101]) for (const phase of ['prompt', 'preferences', 'write']) for (const interruption of ['none', 'pause', 'stop', 'new', 'dispose']) for (const failWrite of [false, true]) {
    it(`preserves source and transport seed=${seed} phase=${phase} interruption=${interruption} failWrite=${failWrite}`, async () => {
      try { await replaySaveSchedule({ seed, phase, interruption, failWrite }); }
      catch (error) { error.message += '\nReplay: ' + JSON.stringify(error.saveSchedule); throw error; }
    });
  }
});
