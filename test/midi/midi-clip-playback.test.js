import { expect } from 'chai';
import { getPlayableMidiClipSteps, describeMidiClipPlayback } from '../../js/midi/project/MidiClipPlayback.js';
import { createMidiProject, projectToMidiConfig } from '../../js/midi/project/MidiProject.js';

describe('clip playback explanation', function() {
  const steps = [
    { index: 4, note: 72, velocity: 100, durationTicks: 12, probability: 1 },
    { index: 0, note: 60, probability: 0 },
    { index: 1, note: 62, tie: true },
    { index: 2, note: null },
    { index: 3, note: 67, velocity: 80, durationTicks: 4, probability: 0.25, hold: true }
  ];

  it('describes the actual shared values and positive-probability/tie behavior without modifying stored data', function() {
    const clip = { id: 'clip', type: 'stepPattern', steps };
    const before = JSON.stringify(clip);
    expect(getPlayableMidiClipSteps(clip).map(step => step.note)).to.deep.equal([67, 72]);
    const description = describeMidiClipPlayback(clip);
    expect(description).to.include('2 notes together').and.include('Step 4 supplies base velocity and duration');
    expect(description).to.include('Hold is stored only').and.include('every positive value enables').and.include('Tie currently omits');
    expect(JSON.stringify(clip)).to.equal(before);
  });

  it('matches project lowering for chord and event-arpeggio modes', function() {
    for (const type of ['stepPattern', 'chord', 'arp']) {
      const project = createMidiProject({ tracks: [{ id: 'track' }], clips: [{ id: 'clip', type, lengthSteps: 8, steps }],
        sources: [{ id: 'source', kind: 'sfx', sourceKey: '20', trackId: 'track', mode: 'clip', clipId: 'clip' }] });
      const config = projectToMidiConfig(project), clip = project.clips[0];
      expect(config.sfx['20']).to.include({ velocity: 80, durationTicks: 4 });
      expect(config.sfx['20'].notes).to.deep.equal(getPlayableMidiClipSteps(clip).map(step => step.note));
      expect(describeMidiClipPlayback(clip)).to.include(type === 'arp' ? 'advances one' : 'notes together');
    }
  });

  it('explains absent, single-note and silent clips', function() {
    expect(describeMidiClipPlayback(null)).to.equal('Select a clip to inspect its playback.');
    expect(describeMidiClipPlayback({ steps: [{ index: 5, note: 60 }] })).to.include('plays one note').and.include('Step 6');
    expect(describeMidiClipPlayback({ steps: [{ index: 0, note: 60, probability: 0 }, { index: 1, note: null }] })).to.include('no playable notes');
  });
});
