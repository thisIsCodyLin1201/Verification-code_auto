import { LocalProvider } from '/dist/provider.js';
import { defaults,checkLimits } from '/dist/core.js';
window.evaluation=(async()=>{
 const dataset=await (await fetch('/dataset.json')).json();
 const provider=new LocalProvider(()=>Tesseract.createWorker('eng',1,{workerPath:location.origin+'/dist/vendor/worker.min.js',corePath:location.origin+'/dist/vendor/core',langPath:location.origin+'/dist/vendor/lang',workerBlobURL:false,cacheMethod:'none',gzip:false}));
 async function recognize(canvas, sample){let timer;try{return await Promise.race([provider.recognize(canvas, undefined, sample.characterMode),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ocr_timeout')),60000)})])}finally{clearTimeout(timer)}}
 const times=[],quality=[],frameGaps=[];let last,tracking=true;
 function frame(t){if(last!==undefined)frameGaps.push(t-last);last=t;if(tracking)requestAnimationFrame(frame)}requestAnimationFrame(frame);
 async function load(sample){
  const response=await fetch(sample.file),blob=await response.blob();if(blob.size>defaults.maxBytes)throw Error('image_too_large');
  const bytes=new Uint8Array(await blob.arrayBuffer());if(!((bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71)||(bytes[0]===255&&bytes[1]===216)))throw Error('Only PNG/JPEG evaluation samples accepted');
  const bitmap=await createImageBitmap(blob);try{checkLimits(blob.size,bitmap.width,bitmap.height,defaults);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);return canvas}finally{bitmap.close()}
 }
 let coldMs;
 try{
  // Cold includes worker initialization + first 3-variant recognition, excludes image decode.
  const first=await load(dataset.samples[0]);const start=performance.now();await recognize(first, dataset.samples[0]);coldMs=performance.now()-start;first.width=first.height=0;
  for(let i=0;i<dataset.runs;i++){const c=await load(dataset.samples[i%dataset.samples.length]);const start=performance.now();await recognize(c, dataset.samples[i%dataset.samples.length]);times.push(performance.now()-start);c.width=c.height=0}
  for(let i=0;i<dataset.samples.length;i++){
   let c;
   try{c=await load(dataset.samples[i]);const r=await recognize(c, dataset.samples[i]);quality.push({index:i,exact:r.text===dataset.samples[i].label,empty:!r.text,review:r.status==='review'})}
   catch{quality.push({index:i,exact:false,failed:true})}finally{if(c)c.width=c.height=0}
  }
  const percentile=(a,q)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*q)-1)]??null;
  return {model:"tessdata_best/eng",coldMs,warm:{runs:times.length,p50Ms:percentile(times,.5),p95Ms:percentile(times,.95)},uiFrameGap:{p95Ms:percentile(frameGaps,.95),maxMs:frameGaps.length?Math.max(...frameGaps):null},quality:{samples:quality.length,exactMatchRate:quality.filter(x=>x.exact).length/quality.length,failureRate:quality.filter(x=>x.failed||x.empty).length/quality.length,reviewRate:quality.filter(x=>x.review).length/quality.length},cpuMemory:'Not measured; use Chrome Task Manager. Synthetic data cannot establish CAPTCHA accuracy.'};
 }finally{tracking=false;await provider.dispose()}
})();
