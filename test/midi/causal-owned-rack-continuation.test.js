import { expect } from 'chai';
import { createCausalOwnedImageRack } from '../../js/app/midi-ui/CausalOwnedImageRack.js';
import { createCausalOwnedRackHistory } from '../../js/app/midi-ui/CausalOwnedRackHistory.js';
import { createOwnedEffectGraphKernel } from '../../js/app/midi-ui/OwnedEffectGraphKernel.js';
import { createRectangularMembraneRecipe } from '../../js/midi/content/RectangularMembraneRecipe.js';
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

const donorGraph = (sourceBusId, revision) => ({schema:'lemmings-effect-graph/v1',id:'fixture.replaced-donor-'+revision,revision,latencyPolicy:'align-declared',maximumLatencyFrames:0,maximumTailSeconds:0,
  nodes:[{id:'source',kind:'bus-in',parameters:{}},{id:'silent',kind:'gain',parameters:{gain01:0,gainMaximum01:1}},{id:'donor-'+revision,kind:'sidechain-in',parameters:{sourceBusId,tap:'post-fader',inputLayout:'audioStereo'}},{id:'return',kind:'gain',parameters:{gain01:.75,gainMaximum01:1}},{id:'output',kind:'bus-out',parameters:{}}],
  edges:[edge('source','silent'),edge('silent','output'),edge('donor-'+revision,'return'),edge('return','output')]});
const edge = (from,to) => ({from:{nodeId:from,port:'audio'},to:{nodeId:to,port:'audio'},gain01:1});
const publication = (definition, hash, sequence, revision, start, width, previousRevision, previousHash, previousTail=0) => packet(hash,sequence,activationAudioFrame+start,'graph',{ownerRouteRevision:revision,definition,
  routeTransition:{schema:'lemmings-effect-route-transition/v1',startFrame:activationAudioFrame+start,transitionFrames:width,previous:{ownerRouteRevision:previousRevision,graphDefinitionHash:previousHash,retireAtFrame:activationAudioFrame+start+width+previousTail,lastBodyDriveFrame:0}}});

describe('captured replacement source and body ownership',()=>{
  it('keeps each later graph on its exact donor while old input gates fade and tails retire',async()=>{
    const sampleRate=48000,frames=1800,fixture=await ownedRackFixture(gainGraph(0),{prefix:0}),a=donorGraph('lane:tools',2),b=donorGraph('lane:water',3),ah=await effectGraphHash(prepareEffectGraphRevision(a)),bh=await effectGraphHash(prepareEffectGraphRevision(b)),width=240;
    const driver=await createCausalOwnedRackHistory({rack:fixture.rack,sampleRate,activationAudioFrame,endFrame:frames,effectCoverage:coverage,effectEvents:[
      publication(a,ah,1,5,256,width,4,fixture.reference.hash),publication(b,bh,2,6,900,width,5,ah)]});
    try{
      expect(driver.sourceRoutes.map(route=>route.key)).to.deep.equal(['lane:tools','lane:water']);
      const donors=new Float32Array(4),presence=new Uint8Array([1,1]);
      for(let frame=0;frame<frames;frame++){
        if(frame>=driver.nextBoundary)await driver.advance(frame);
        const a=Math.fround(Math.sin(frame*.021)*.2),b=Math.fround(Math.cos(frame*.037)*.1);donors.set([a,-a,b,-b]);driver.sample(0,0,donors,presence);
        const first=Math.max(0,Math.min(1,(frame-256)/width)),second=Math.max(0,Math.min(1,(frame-900)/width)),old=Math.fround(Math.fround(a*first*(1-second))*.75),fresh=Math.fround(Math.fround(b*second)*.75);
        expect(driver.leftSample).to.equal(Math.fround(old+fresh));expect(driver.rightSample).to.equal(-driver.leftSample);
      }
      expect(driver.finish().peakGraphs).to.equal(2);
    }finally{driver.dispose();fixture.reference.panic();}
  });
  it('replays an acknowledged finite contact into a newly published membrane without inventing a source onset',async()=>{
    const sampleRate=48000,start=256,frames=1600,fixture=await ownedRackFixture(gainGraph(0),{prefix:0}),definition=createRectangularMembraneRecipe({gridSize:8,fundamentalHz:180,revision:2}).graph,
      reference=await createOwnedEffectGraphKernel({definition,sampleRate}),hash=reference.hash,width=240,target=start+64,nodeId='skin';
    const strike={intentId:'contact.intent',voiceId:'contact.voice',onsetId:'contact.onset',worldId:'fixture.world',generation:1,actorId:7,sourceEventIds:['contact.fact'],contactInstanceId:'contact.instance',
      surfaceId:'surface.skin',surfaceRevision:1,mapId:'surface.map',mapRevision:1,bodyInstanceId:'c'.repeat(64),pitchPolicy:'fixed-prepared-body',x01:.3,y01:.6,amplitude01:.4,pulseMilliseconds:4,applicationEvidence:'processor-frame-acknowledged'};
    const applied=packet(hash,2,activationAudioFrame+target,'body-strike',{ownerRouteRevision:5,nodeId,strike,sourceEventIds:strike.sourceEventIds,clockAnchor:{intentId:strike.intentId,sourceTargetFrame:activationAudioFrame+target,executionEpoch:'fixture.new-execution'}});
    const driver=await createCausalOwnedRackHistory({rack:fixture.rack,sampleRate,activationAudioFrame,endFrame:frames,effectCoverage:coverage,effectEvents:[publication(definition,hash,1,5,start,width,4,fixture.reference.hash),applied]});
    try{
      reference.enqueueBodyStrike(nodeId,{frame:64,token:1,pulseIndex:0,x01:strike.x01,y01:strike.y01,amplitude01:strike.amplitude01});
      const donors=new Float32Array(driver.sourceRoutes.length*2),presence=new Uint8Array(driver.sourceRoutes.length).fill(1);let peak=0;
      for(let frame=0;frame<frames;frame++){if(frame>=driver.nextBoundary)await driver.advance(frame);driver.sample(0,0,donors,presence);
        if(frame>=start)reference.sample(0,0,new Float32Array(2),new Uint8Array([1]));
        expect(driver.leftSample).to.equal(frame>=start?reference.leftSample:0);expect(driver.rightSample).to.equal(frame>=start?reference.rightSample:0);peak=Math.max(peak,Math.abs(driver.leftSample));
      }
      expect(peak).to.be.greaterThan(0);driver.finish();
    }finally{driver.dispose();reference.panic();fixture.reference.panic();}
  });
});
