import { expect } from 'chai';
import { createCausalOwnedImageRack } from '../../js/app/midi-ui/CausalOwnedImageRack.js';
import { createCausalOwnedRackHistory } from '../../js/app/midi-ui/CausalOwnedRackHistory.js';
import { createQuarryEcho } from '../../js/midi/content/DubQuarryRack.js';
import { prepareEffectGraphRevision,effectGraphHash } from '../../js/midi/content/EffectGraphRevision.js';
import { ownedRackFixture,gainGraph,cutAdapter } from '../helpers/ownedEffectCut.js';
const activationAudioFrame=32768,coverage={captured:true,gaps:[]};
const packet=(graphHash,sequence,targetFrame,operation,extra={})=>({schema:'lemmings-effect-performance/v1',status:'accepted',stage:'effect-performance-captured',streamId:'fixture.cut-history',sequence,operation,ownerRouteRevision:4,graphDefinitionHash:graphHash,sampleRate:48000,targetFrame,executionEpoch:'fixture.new-execution',clockAnchor:null,sourceEventIds:[],acousticReceipt:false,...extra});
describe('saved creative rack continuation and replacement PCM',()=>{
  for(const sampleRate of [44100,48000,96000])it('keeps an independently restored echo tail identical to uninterrupted owned rendering at '+sampleRate,async()=>{
    const definition=createQuarryEcho({delaySeconds:512/sampleRate,feedback:.25,send01:.5,return01:.25,feedbackLowpassHz:4000});
    const fixture=await ownedRackFixture(definition,{sampleRate}),snapshot=fixture.rack.components.map(row=>row.bytes.slice()),frames=1536;
    const driver=await createCausalOwnedImageRack({rack:fixture.rack,sampleRate,activationAudioFrame,endFrame:frames,effectCoverage:coverage});
    const restored=[],reference=[];for(let frame=0;frame<frames;frame++){driver.sample(0,0);fixture.reference.sample(0,0);restored.push(driver.leftSample,driver.rightSample);reference.push(fixture.reference.leftSample,fixture.reference.rightSample);}
    expect(restored).to.deep.equal(reference);expect(Math.max(...restored.map(Math.abs))).to.be.greaterThan(.001);expect(driver.finish().automation.renderedFrames).to.equal(frames);
    for(let index=0;index<snapshot.length;index++)expect(fixture.rack.components[index].bytes).to.deep.equal(snapshot[index]);driver.dispose();fixture.reference.panic();
  });
  it('joins retained native future ramps and later captured API controls without applying gain smoothing twice',async()=>{
    const sampleRate=48000,frameCount=1400,fixture=await ownedRackFixture(gainGraph(.5),{prefix:0,dry:.25,input:.5,configure:(adapters,time)=>{adapters.get('gain:gain').insert(.75,time+300/sampleRate,time,500/sampleRate);}});
    const original=fixture.rack.graphMetadata.controlState.curves[0].state,expected=cutAdapter({value:0,smoothingSeconds:.008});expected.restore(original,0);expected.insert(.125,700/sampleRate,0);
    const driver=await createCausalOwnedImageRack({rack:fixture.rack,sampleRate,activationAudioFrame,endFrame:frameCount,effectCoverage:coverage,effectEvents:[packet(fixture.reference.hash,1,activationAudioFrame+700,'control',{nodeId:'gain',values:{gain01:.125}})]});
    for(let frame=0;frame<frameCount;frame++){const input=Math.fround(Math.sin(frame*.017)*.2);driver.sample(input,-input);const gain=Math.fround(expected.valueAt(frame/sampleRate)),wet=Math.fround(Math.fround(input*.5)*gain),dry=Math.fround(input*.25);expect(driver.leftSample).to.equal(Math.fround(wet+dry));expect(driver.leftSample).to.equal(Math.fround(driver.dryLeftSample+driver.returnLeftSample));}
    expect(driver.finish().automation).to.include({retainedFutureControls:1,additionalControls:1});driver.dispose();fixture.reference.panic();
  });
  it('retains the initial graph through the recorded replacement ramp and retires it at the original deadline',async()=>{
    const sampleRate=48000,frames=1800,fixture=await ownedRackFixture(gainGraph(.5),{prefix:0}),definition=gainGraph(.75,2),plan=prepareEffectGraphRevision(definition),hash=await effectGraphHash(plan),start=800,width=240,retire=start+width;
    const publication=packet(hash,1,activationAudioFrame+start,'graph',{ownerRouteRevision:5,definition,routeTransition:{schema:'lemmings-effect-route-transition/v1',startFrame:activationAudioFrame+start,transitionFrames:width,previous:{ownerRouteRevision:4,graphDefinitionHash:fixture.reference.hash,retireAtFrame:activationAudioFrame+retire,lastBodyDriveFrame:0}}});
    const driver=await createCausalOwnedRackHistory({rack:fixture.rack,sampleRate,activationAudioFrame,endFrame:frames,effectCoverage:coverage,effectEvents:[publication]});
    for(let frame=0;frame<frames;frame++){if(frame>=driver.nextBoundary)await driver.advance(frame);const source=Math.fround(Math.sin(frame*.031)*.1);driver.sample(source,-source);const blend=Math.max(0,Math.min(1,(frame-start)/width)),expected=Math.fround(Math.fround(Math.fround(source*(1-blend))*.5)+Math.fround(Math.fround(source*blend)*.75));expect(driver.leftSample).to.equal(expected);expect(driver.leftSample).to.equal(Math.fround(driver.dryLeftSample+driver.returnLeftSample));}
    const receipt=driver.finish();expect(receipt.peakGraphs).to.equal(2);expect(receipt.completed).to.deep.equal([{revision:4,graphHash:fixture.reference.hash,retiredAtFrame:retire}]);driver.dispose();fixture.reference.panic();
  });
});
