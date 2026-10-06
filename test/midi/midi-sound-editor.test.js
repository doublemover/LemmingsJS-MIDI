import { expect } from 'chai';
import { createEventBehaviorPatch, getEventBehavior, transposeEventPitch, soundNoteName, resolveGameSoundSource } from '../../js/app/midi-ui/midiSoundEditor.js';
import { SoundEffectIds } from '../../js/game/SoundEvents.js';
import { TriggerTypes } from '../../js/level/TriggerTypes.js';

describe('simple game sound editor', function() {
  it('recognizes custom pitch precedence and never converts on inspection', function() {
    for (const mapping of [{degree:2},{chord:{type:'triad'}},{notes:[60,64,67]}]) {
      const source={mode:'direct',mapping}; const before=JSON.stringify(source);
      expect(getEventBehavior(source)).to.equal('custom');
      expect(JSON.stringify(source)).to.equal(before);
      expect(createEventBehaviorPatch(source,'custom')).to.equal(null);
    }
  });
  it('preserves note arrangements when explicitly changing phrase direction', function() {
    const source={mode:'direct',mapping:{note:60,notes:[60,63,71],phrase:{enabled:true,mode:'up',spacingTicks:4}}};
    const patch=createEventBehaviorPatch(source,'falling');
    expect(patch.notes).to.deep.equal([60,63,71]);
    expect(patch.phrase).to.deep.equal({enabled:true,mode:'down',spacingTicks:4});
    expect(transposeEventPitch(source.mapping,62)).to.deep.equal({note:62,notes:[62,65,73]});
  });
  it('creates scale-fitting runs only for explicit behavior changes', function() {
    const patch=createEventBehaviorPatch({mode:'direct',mapping:{note:60}},'rising',{root:0,degrees:[0,2,3,5,7,8,10]});
    expect(patch.notes).to.deep.equal([60,62,63,65,67]);
    expect(soundNoteName(60)).to.equal('C4');
  });
  it('resolves trigger-precedence aliases as one readable event', function() {
    const source={id:'exit',kind:'sfx',sourceKey:String(SoundEffectIds.EXIT)};
    const trigger={id:'actual-exit',kind:'trigger',sourceKey:String(TriggerTypes.EXIT_LEVEL)};
    expect(resolveGameSoundSource({sources:[source,trigger]},{id:SoundEffectIds.EXIT})).to.equal(trigger);
    const fire={id:'fire',kind:'sfx',sourceKey:String(SoundEffectIds.TRAP_FIRE)};
    const frying={id:'actual-fire',kind:'trigger',sourceKey:String(TriggerTypes.FRYING)};
    expect(resolveGameSoundSource({sources:[fire,frying]},{id:SoundEffectIds.TRAP_FIRE})).to.equal(frying);
  });
});
