import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { OwnedPcmCaptureKernel } from '../../js/app/midi-ui/worklet/OwnedPcmCaptureProcessor.js';
import { createPcmCaptureWavLayout } from '../../js/app/midi-ui/OwnedMasterCapture.js';
import { finalizeCausalRealtimePrint } from '../../js/app/midi-ui/CausalRealtimePrintFinalize.js';
import { inspectOwnedCueWave } from '../../js/app/midi-ui/OwnedPcmCue.js';
const applicationBuildId='c'.repeat(64),sourceCanonicalHash='a'.repeat(64),definitionHash='b'.repeat(64);
function actualCapture(sampleRate,quantum){
  const first=137,frames=513,kernel=new OwnedPcmCaptureKernel({sampleRate,maxFrames:frames,targetStartFrame:first,chunkFrames:1024}),chunks=[];
  const emit=(index,token,sequence,sourceStartFrame,firstFrame,count,buffer)=>{chunks.push(new Float32Array(buffer).slice(0,count*2));kernel.returnBuffer(index,token,buffer);};
  for(let at=0;!kernel.stopped;at+=quantum){const channels=[Float32Array.from({length:quantum},(_,index)=>Math.sin((at+index)*.01)*1.3),Float32Array.from({length:quantum},(_,index)=>Math.cos((at+index)*.03)*.7)];kernel.process(channels,quantum,at,emit);}
  const capture={schema:'lemmings-master-pcm/v1',ownerId:'fixture.private-print',sampleRate,timelineFrames:kernel.capturedFrames,capturedFrames:kernel.capturedFrames,sourceStartFrame:kernel.sourceStartFrame,endFrameExclusive:kernel.lastFrame,terminalAcknowledged:true,gaps:[],renderJob:{sourceCanonicalHash,definitionHash}},layout=createPcmCaptureWavLayout(capture),bytes=new Uint8Array(layout.byteLength),view=new DataView(bytes.buffer);
  bytes.set(layout.header);let offset=56;for(const chunk of chunks)for(const value of chunk){view.setFloat32(offset,value,true);offset+=4;}bytes.set(layout.suffix,offset);
  const expected=new Uint8Array(frames*8),expectedView=new DataView(expected.buffer);for(let index=0;index<frames;index++){expectedView.setFloat32(index*8,Math.fround(Math.sin((first+index)*.01)*1.3),true);expectedView.setFloat32(index*8+4,Math.fround(Math.cos((first+index)*.03)*.7),true);}
  const manifest={schema:'lemmings-causal-audio-render/v1',mode:'real-time-intent-print',applicationBuildId,sourceCanonicalHash,definitionHash,sampleRate,frames,capture,timelineZeroSourceFrame:first,exactEndSourceFrame:first+frames,fileState:'complete-private-digital-capture',originalRecordMutated:false,acousticReceipt:false};
  return{kernel,bytes,manifest,expected};
}
describe('exact future-frame private print capture and WAV finalization',()=>{
  for(const sampleRate of [44100,48000,96000])for(const quantum of [128,256])it('preserves the actual nonaligned crop and stereo Float32 headroom at '+sampleRate+' / '+quantum,async()=>{
    const capture=actualCapture(sampleRate,quantum);expect(capture.kernel).to.include({sourceStartFrame:137,lastFrame:650,capturedFrames:513,droppedFrames:0,gapCount:0,stopReason:'capacity-reached'});
    const result=await finalizeCausalRealtimePrint(capture,{applicationBuildId,yieldControl:async()=>{}}),file=result.files[0],data=inspectOwnedCueWave(file.bytes,file.manifest);
    expect(file.bytes.subarray(data.offset,data.offset+data.bytes)).to.deep.equal(capture.expected);expect(result.manifest.pcmHash).to.equal(createHash('sha256').update(capture.expected).digest('hex'));
    expect(result.manifest).to.include({channels:2,sampleFormat:'ieee-float32-le',timelineZeroSourceFrame:137,exactEndSourceFrame:650});expect(result.manifest.realization).to.include({normalization:'none',originalLivePCM:false,hardwareAudio:false});expect(result.manifest.realization.peak).to.be.greaterThan(1);
  });
  it('rejects mixing a complete PCM capture with a different take or definition receipt',async()=>{
    const capture=actualCapture(48000,128);let error;try{await finalizeCausalRealtimePrint({...capture,manifest:{...capture.manifest,sourceCanonicalHash:'d'.repeat(64)}},{applicationBuildId});}catch(caught){error=caught;}expect(error).to.be.instanceOf(Error);expect(error.message).to.include('selected source receipt differ');
  });
});
