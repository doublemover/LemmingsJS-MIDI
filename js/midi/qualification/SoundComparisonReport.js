export function renderSoundComparisonHtml(report) {
  const data = JSON.stringify(report).replaceAll('<', '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>A/B spectral comparison</title>
<style>body{margin:24px auto;width:1800px;background:#10151e;color:#e5edf7;font:17px system-ui}h1{font-size:30px;margin:0 0 8px}h2{font-size:21px;margin:20px 0 4px}p{margin:6px 0 12px;color:#bbcadc}.facts{display:flex;gap:28px;flex-wrap:wrap}.fact{background:#1a2432;padding:10px 16px;border-radius:6px}.fact b{display:block;color:#fff}.key{color:#62c9ff}.keyB{color:#ffb66b}canvas{display:block;width:1800px;border:1px solid #33465d;border-radius:6px;background:#131c28}output{display:block;min-height:25px;color:#e8d794}small{color:#a9bbcf}</style>
<h1>A/B spectral comparison</h1><p id="intro"></p><div class="facts" id="facts"></div><p><label><input id="fullTimeline" type="checkbox"> Include the full silent remainder</label> · <span id="range"></span></p>
<h2>Clip A · frequency over time</h2><canvas id="a" width="1800" height="265"></canvas>
<h2>Clip B · same frequency and level scales</h2><canvas id="b" width="1800" height="265"></canvas>
<h2>A − B · active spectral differences</h2><p>Blue: more power in A. Orange: more power in B. Pale: similar power. Dark: both below the comparison floor.</p><canvas id="difference" width="1800" height="265"></canvas><output id="hover">Hover a spectrogram for aligned time, frequency and A/B power.</output>
<h2>Amplitude envelope · 10 ms RMS</h2><p><span class="key">A: blue solid</span> · <span class="keyB">B: orange dashed</span>. Note onsets, gaps and decay all contribute.</p><canvas id="envelope" width="1800" height="180"></canvas>
<h2>Envelope modulation spectrum · 0.5–20 Hz</h2><p>Compares rhythmic energy changes after removing mean RMS. A peak can come from the shared note pattern; it does not establish an extra oscillator.</p><canvas id="modulation" width="1800" height="180"></canvas>
<p id="method"></p><small id="source"></small>
<script>
const report=${data},p=report.profile,s=report.spectrogram;let displayEnd=report.display.activeEndSeconds;
const number=(x,d=3)=>x==null?'unavailable':Number(x).toFixed(d), db=x=>20*Math.log10(Math.max(1e-8,x));
document.querySelector('#intro').textContent=number(p.durationSeconds,2)+' s · '+p.sampleRate+' Hz · '+p.channels+' channels. Same rate and length; no alignment warp or pitch correction.';
const facts=[['Waveform correlation',number(report.summary.waveformCorrelation)],['Relative PCM RMS difference',number(report.summary.normalizedPcmRmsError)],['Active-band mean |A − B|',number(report.summary.meanAbsoluteActiveBandDifferenceDb,2)+' dB'],['Raw RMS A / B',number(report.measurements.a.rms,6)+' / '+number(report.measurements.b.rms,6)],['Envelope variation A / B',number(report.modulation.a.index)+' / '+number(report.modulation.b.index)]];
for(const [label,value]of facts){const node=document.createElement('div');node.className='fact';const b=document.createElement('b');b.textContent=value;node.append(b,document.createTextNode(label));document.querySelector('#facts').append(node)}
const interpolate=(a,b,t)=>a.map((x,i)=>Math.round(x+(b[i]-x)*t)), seq=[[10,15,24],[46,44,109],[13,141,150],[244,217,75]];
const palette=Array.from({length:256},(_,i)=>{const x=i/255*3,k=Math.min(2,Math.floor(x));return interpolate(seq[k],seq[k+1],x-k)});
const difference=Array.from({length:256},(_,i)=>i<128?interpolate([237,141,55],[225,232,242],i/127):interpolate([225,232,242],[43,147,221],(i-128)/127));
const box={x:72,y:30,w:1630,h:186};
function spectral(id,values,delta=false){
 const canvas=document.getElementById(id),c=canvas.getContext('2d'),image=c.createImageData(box.w,box.h),bytes=image.data; c.clearRect(0,0,canvas.width,canvas.height);
 const lastColumn=Math.max(0,s.centerSeconds.findLastIndex(time=>time<=displayEnd)),columns=lastColumn+1;
 for(let y=0;y<box.h;y++)for(let x=0;x<box.w;x++){
  const column=Math.min(lastColumn,Math.floor(x/box.w*columns)),band=Math.min(p.frequencyBands-1,Math.floor((box.h-1-y)/box.h*p.frequencyBands)),at=column*p.frequencyBands+band;
  const a=s.a[at]/10,b=s.b[at]/10,value=delta?a-b:values[at]/10;
  const index=Math.max(0,Math.min(255,Math.round(delta?(value/p.differenceDisplayLimitDb+1)*127.5:(value-p.displayMinimumDb)/(p.displayMaximumDb-p.displayMinimumDb)*255)));
  const rgb=delta&&Math.max(a,b)<p.differenceActiveFloorDb?[15,21,30]:(delta?difference:palette)[index],out=(y*box.w+x)*4;
  bytes[out]=rgb[0];bytes[out+1]=rgb[1];bytes[out+2]=rgb[2];bytes[out+3]=255;
 }
 c.putImageData(image,box.x,box.y);c.font='15px system-ui';c.fillStyle='#c5d6e8';c.strokeStyle='#7b8fa744';
 for(const hz of [30,60,120,250,500,1000,2000,4000,8000,16000]){const y=box.y+box.h*(1-Math.log(hz/p.frequencyMinimumHz)/Math.log(p.frequencyMaximumHz/p.frequencyMinimumHz));c.fillText(hz>=1000?hz/1000+'k':String(hz),8,y+5);c.beginPath();c.moveTo(box.x,y);c.lineTo(box.x+box.w,y);c.stroke()}
 for(let i=0;i<=8;i++){const x=box.x+box.w*i/8,time=s.centerSeconds[0]+(s.centerSeconds[lastColumn]-s.centerSeconds[0])*i/8;c.fillText(number(time,2)+' s',x-20,242)}
 const colors=delta?difference:palette;
 for(let y=0;y<box.h;y++){c.fillStyle='rgb('+colors[Math.round((box.h-1-y)/(box.h-1)*255)].join(',')+')';c.fillRect(1724,box.y+y,16,1)}
 c.fillStyle='#c5d6e8';c.fillText(delta?'+'+p.differenceDisplayLimitDb:p.displayMaximumDb,1746,40);c.fillText(delta?'-'+p.differenceDisplayLimitDb:p.displayMinimumDb,1746,216);c.fillText(delta?'dB delta':'dBFS',1716,19);if(delta)c.fillText('0',1746,128);
 canvas.onpointermove=event=>{const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*canvas.width/rect.width,y=(event.clientY-rect.top)*canvas.height/rect.height;if(x<box.x||x>=box.x+box.w||y<box.y||y>=box.y+box.h)return;const col=Math.min(lastColumn,Math.floor((x-box.x)/box.w*columns)),band=Math.min(p.frequencyBands-1,Math.floor((box.y+box.h-y)/box.h*p.frequencyBands)),at=col*p.frequencyBands+band;document.getElementById('hover').textContent='Window center '+number(s.centerSeconds[col],3)+' s · '+number(s.frequencyHz[band],1)+' Hz band · A '+number(s.a[at]/10,1)+' dBFS · B '+number(s.b[at]/10,1)+' dBFS · A − B '+number((s.a[at]-s.b[at])/10,1)+' dB'};canvas.onpointerleave=()=>{document.getElementById('hover').textContent='Hover a spectrogram for aligned time, frequency and A/B power.'};
}
function spectralPanels(){spectral('a',s.a);spectral('b',s.b);spectral('difference',null,true);document.querySelector('#range').textContent='Showing 0–'+number(displayEnd,2)+' s of '+number(p.durationSeconds,2)+' s; analysis retains every sample.'}
function lines(id,series,xMaximum,yMinimum,yMaximum,xLabel,yLabel){
 const canvas=document.getElementById(id),c=canvas.getContext('2d'),b={x:72,y:20,w:1630,h:112};c.clearRect(0,0,canvas.width,canvas.height);c.font='15px system-ui';c.strokeStyle='#73849b55';c.fillStyle='#c5d6e8';
 for(let i=0;i<=4;i++){const y=b.y+b.h*i/4;c.fillText(number(yMaximum-(yMaximum-yMinimum)*i/4,id==='envelope'?4:1),5,y+5);c.beginPath();c.moveTo(b.x,y);c.lineTo(b.x+b.w,y);c.stroke()}
 for(let i=0;i<=8;i++)c.fillText(number(xMaximum*i/8,2),b.x+b.w*i/8-15,157);
 for(const [index,row]of series.entries()){c.strokeStyle=index?'#ffb66b':'#62c9ff';c.lineWidth=2;c.setLineDash(index?[7,4]:[]);c.beginPath();for(let i=0;i<row.y.length;i++){if(row.x[i]>xMaximum)break;const x=b.x+b.w*row.x[i]/xMaximum,y=b.y+b.h*(1-(Math.max(yMinimum,Math.min(yMaximum,row.y[i]))-yMinimum)/(yMaximum-yMinimum));if(i)c.lineTo(x,y);else c.moveTo(x,y)}c.stroke()}c.setLineDash([]);c.fillStyle='#c5d6e8';c.fillText(xLabel,1720,177);c.fillText(yLabel,5,177);
}
const envMaximum=Math.max(...report.envelope.a,...report.envelope.b,1e-8)*1.05;
function envelopePanel(){lines('envelope',[report.envelope.a,report.envelope.b].map(y=>({x:y.map((_,i)=>(i+0.5)/100),y})),displayEnd,0,envMaximum,'seconds','RMS')}
spectralPanels();envelopePanel();document.querySelector('#fullTimeline').onchange=event=>{displayEnd=event.target.checked?p.durationSeconds:report.display.activeEndSeconds;spectralPanels();envelopePanel()};
lines('modulation',[report.modulation.a,report.modulation.b].map(row=>({x:row.frequencyHz,y:row.powerDb})),20,-80,10,'Hz','dB relative envelope');
document.querySelector('#method').textContent=p.fftSize+'-frame symmetric Hann window ('+number(p.fftSize/p.sampleRate*1000,1)+' ms), '+number(p.fftResolutionHz,2)+' Hz FFT spacing. Shared A/B color scale '+p.displayMinimumDb+' to '+p.displayMaximumDb+' dBFS. Log display averages FFT-bin power; narrow display bands use the nearest real FFT bin. Difference floor '+p.differenceActiveFloorDb+' dBFS. Digital differences do not decide audible relatedness or musical usefulness.';
document.querySelector('#source').textContent='Source SHA-256: A '+(report.inputs?.a?.sha256||'not supplied')+' · B '+(report.inputs?.b?.sha256||'not supplied');
window.__soundComparisonReady=true;
</script>`;
}
