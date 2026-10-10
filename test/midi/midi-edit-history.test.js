import { expect } from 'chai';
import { createMidiEditHistory } from '../../js/app/midi-ui/midiEditHistory.js';
import { createMidiProjectFromMidiConfig, sanitizeMidiProject, reduceMidiProject } from '../../js/midi/project/MidiProject.js';
import { applyGameEventMidiPreset } from '../../js/midi/project/GameEventMidiPresets.js';

describe('musical edit history', () => {
  it('restores ensemble absence, roles, tension and assignments without restoring device routes', () => {
    const history = createMidiEditHistory();
    let project = createMidiProjectFromMidiConfig({ sfx: { 1: { note: 60 } } });
    const commit = next => { const clean = sanitizeMidiProject(next); history.record(project, clean); project = clean; };
    commit(applyGameEventMidiPreset(project, 'game-iron-ensemble'));
    const ensemble = project.ensemble;
    commit(reduceMidiProject(project, { type: 'ensemble.role.update', trackId: ensemble.roles[0].trackId, patch: { pan: -73 } }));
    commit(reduceMidiProject(project, { type: 'ensemble.tension.update', patch: { amount: 0.4 } }));
    commit(reduceMidiProject(project, { type: 'ensemble.assignment.set', lemmingId: 12, laneIndex: 0, trackId: ensemble.roles[0].trackId }));
    const edited = project.ensemble;
    commit({ ...project, ensemble: null });
    project = { ...project, enabled: true, devices: { ...project.devices, outputId: 'current' }, tracks: project.tracks.map(track => ({ ...track, outputId: 'current-track' })) };
    expect(history.undo(project, commit)).to.equal(true); expect(project.ensemble).to.deep.equal(edited);
    expect(project.devices.outputId).to.equal('current'); expect(project.enabled).to.equal(true);
    expect(project.tracks.every(track => track.outputId === 'current-track')).to.equal(true);
    expect(history.redo(project, commit)).to.equal(true); expect(project).not.to.have.property('ensemble');
    history.undo(project, commit); history.undo(project, commit); expect(project.ensemble.assignments).to.have.length(0);
    history.undo(project, commit); expect(project.ensemble.tension.amount).to.equal(ensemble.tension.amount);
    history.undo(project, commit); expect(project.ensemble.roles).to.deep.equal(ensemble.roles);
    history.undo(project, commit); expect(project).not.to.have.property('ensemble');
    commit({ ...project, name: 'Fresh edit' }); expect(history.state().canRedo).to.equal(false);
  });
});
