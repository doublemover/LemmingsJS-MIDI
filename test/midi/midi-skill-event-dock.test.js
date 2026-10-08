import { expect } from 'chai';
import { resolveSkillDockGeometry, SKILL_EVENT_GROUPS } from '../../js/app/midi-ui/midiSkillEventDock.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { parseClipNote } from '../../js/app/midi-ui/midiEventClipEditor.js';

describe('skill event canvas footer', function() {
  it('aligns cards beneath the real five selector slots at the rendered HUD scale', function() {
    const stage = { stageCav: { width: 800 }, hudMargin: 20, guiEnabled: true,
      guiImgProps: { x: 0, viewPoint: { scale: 2.5 }, display: { worldDataSize: { width: 320 } } } };
    expect(resolveSkillDockGeometry(stage, 800)).to.deep.equal({ compact: false, left: 200, width: 200, overlap: 20 });
    expect(resolveSkillDockGeometry(stage, 400)).to.deep.equal({ compact: true, left: 100, width: 100, overlap: 10 });
    stage.guiEnabled = false; expect(resolveSkillDockGeometry(stage, 800)).to.equal(null);
    expect(resolveSkillDockGeometry(null, 800)).to.equal(null);
  });
  it('docks only skill-specific events, preserving shared explosions, generic assignment and non-skill events', function() {
    const ids = SKILL_EVENT_GROUPS.flatMap(group => group.events.map(([id]) => id));
    expect(ids).to.have.length(7); expect(new Set(ids).size).to.equal(7);
    for (const id of [SoundEffectIds.EXPLOSION, SoundEffectIds.OHNO, SoundEffectIds.SKILL_ASSIGN, SoundEffectIds.SKILL_SELECT, SoundEffectIds.STEEL_HIT, SoundEffectIds.SPAWN, SoundEffectIds.LAND]) expect(ids).not.to.include(id);
  });
  it('accepts note-name accidental glyphs from the existing pitch display', function() {
    expect(parseClipNote('F\u266f4')).to.equal(66); expect(parseClipNote('E\u266d4')).to.equal(63);
  });
});
