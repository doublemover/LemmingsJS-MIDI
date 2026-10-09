import { expect } from 'chai';
import fs from 'node:fs';
import { load } from 'cheerio';

const $ = load(fs.readFileSync('index.html', 'utf8'));

describe('compact MIDI pane hierarchy', () => {
  it('keeps direct Panic and Close together in the titlebar for every workspace', () => {
    expect($('#midiPanicButton').length).to.equal(1);
    expect($('#midiPanicButton').closest('#midiAudioControls').length).to.equal(1);
    expect($('#midiPanicButton').text()).to.equal('Panic');
    expect($('#midiPanicButton').attr('aria-label')).to.equal('Panic all MIDI notes');
    expect($('#midiWorkspaceClose').closest('#midiTransportStrip').length).to.equal(1);
    expect($('#midiTransportStrip').children().map((index, element) => element.attribs.id).get()).to.deep.equal(['midiEditScope', 'midiWorkspaceClose']);
    expect($('#midiTransportStrip').closest('.midi-editor-view').length).to.equal(0);
  });
  it('leaves only three secondary file operations in the menu while keeping all direct actions', () => {
    expect($('#midiInstrumentMenus button').map((index, element) => element.attribs.id).get()).to.deep.equal(['midiMenuImport', 'midiMenuExport', 'midiMenuSave']);
    for (const id of ['midiUndo', 'midiRedo', 'midiLayoutFocus', 'midiLayoutSplit', 'midiLayoutOverlay', 'midiViewProject', 'midiViewDevices']) expect($(`#${id}`).length, id).to.equal(1);
    expect($('#midiInstrumentMenus summary').attr('aria-label')).to.equal('Project files');
  });
  it('puts frequent sound/track views first, keeping references and global settings secondary', () => {
    expect($('.midi-view-tabs button').map((index, element) => element.attribs.id).get()).to.deep.equal(['midiViewSounds', 'midiViewExpert', 'midiViewProject', 'midiViewDevices']);
    expect($('#midiViewProject').hasClass('midi-view-tab--secondary')).to.equal(true);
    expect($('#midiViewDevices').hasClass('midi-view-tab--secondary')).to.equal(true);
    for (const id of ['midiInspectTrack', 'midiSoundRoute', 'midiSoundSnapshot', 'midiSoundRevert', 'midiSoundAdvanced']) expect($(`#${id}`).closest('.midi-sound-secondary').length, id).to.equal(1);
    expect($('.midi-sound-secondary').is('[open]')).to.equal(false);
    for (const id of ['midiSoundPitchDial', 'midiSoundDurationNumber', 'midiSoundPreview']) expect($(`#${id}`).closest('.midi-sound-secondary').length, id).to.equal(0);
    expect($('#midiGlobalPanMode').closest('.midi-event-context').length).to.equal(1);
    expect($('#midiActiveKeySummary').closest('.midi-event-context').length).to.equal(1);
    expect($('#midiEventSoundDock').next().hasClass('midi-event-context')).to.equal(true);
  });

});
