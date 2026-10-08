import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';

const $ = load(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));

describe('game page layout contract', function() {
  it('keeps tools and level selectors in top chrome rather than below the canvas', function() {
    for (const id of ['etc', 'midiWorkspaceToggle', 'levelName', 'levelSelects', 'gameTypeSelect', 'levelGroupSelect', 'levelIndexSelect', 'savedLevelSelect', 'savedLevelSave', 'savedLevelImport', 'savedLevelExport']) {
      expect($(`#${id}`).length, id).to.equal(1);
      expect($(`#${id}`).closest('#gameChrome').length, id).to.equal(1);
    }
    expect($('.game_container').children().map((i, el) => el.attribs.id).get()).to.deep.equal(['gameCanvas', 'midiSkillEventDock']);
  });

  it('keeps level tools secondary, master volume adjacent and appearance palettes visual', function() {
    expect($('#levelIndexSelect').next().is('.level-navigation')).to.equal(true);
    for (const id of ['savedLevelSave', 'savedLevelExport', 'savedLevelImport']) expect($(`#${id}`).closest('details').length).to.equal(1);
    expect($('#midiLocalListenButton').next().find('#midiMasterVolume').length).to.equal(1);
    expect($('#midiGamePresetSelect').closest('.midi-listen-row').length).to.equal(1);
    expect($('#midiGamePresetApply').closest('#midiProjectView').length).to.equal(0);
    expect($('#midiPanicButton').closest('#midiAudioControls').length).to.equal(1);
    expect($('#gameChrome strong').length).to.equal(0);
    expect($('input[type=color]').length).to.equal(0);
    expect($('.character-segments[role=radiogroup]').length).to.equal(6);
    for (const el of $('[data-icon]').toArray()) expect(readFileSync(new URL(`../assets/icons/lucide/${el.attribs['data-icon']}.svg`, import.meta.url), 'utf8')).to.include('<svg');
  });

  it('keeps accessible level arrows outside the measured canvas slot', function() {
    for (const id of ['levelPrevButton', 'levelNextButton']) {
      const arrow = $(`#${id}`);
      expect(arrow.closest('.level-navigation').length).to.equal(1);
      expect(arrow.closest('.game-stage-slot').length).to.equal(0);
      expect(arrow.is('button')).to.equal(true);
      expect(arrow.attr('type')).to.equal('button');
      expect(arrow.closest('#levelSelects').length).to.equal(1);
      expect(arrow.attr('aria-label')).to.match(/level/);
    }
  });

  it('keeps startup markup safe and detailed wiring collapsed', function() {
    expect($('#midiSequencerWorkspace').is('[hidden]')).to.equal(true);
    expect($('#midiExpertView').is('[hidden]')).to.equal(true);
    expect($('#midiGameEventList').closest('#studioLibrary').length).to.equal(1);
    expect($('#midiDevicesView').is('[hidden]')).to.equal(true);
    expect($('#midiGamePresetApply').closest('#midiAdvancedWorkspace').length).to.equal(0);
    expect($('#midiSourceList').closest('#midiAdvancedWorkspace').length).to.equal(1);
  });

  it('anchors the desktop canvas beside the left rail and keeps the right editor bounded', function() {
    const css = readFileSync(new URL('../css/midi-instrument.css', import.meta.url), 'utf8');
    expect(css).to.match(/\.game-stage-slot, \.studio-open \.game-stage-slot \{[^}]*justify-content: flex-start;/);
    expect(css).to.match(/\.game, \.studio-open \.game \{[^}]*padding: 6px;/);
    expect(css).not.to.include('42%');
    expect(css).to.include('grid-template-columns: 208px minmax(300px, 1fr) 328px;');
    expect(css).to.include('grid-template-columns: 220px minmax(300px, 1fr) 360px;');
    expect(css).to.include('.game-stage-slot, .studio-open .game-stage-slot { justify-content: center; }');
  });
});
