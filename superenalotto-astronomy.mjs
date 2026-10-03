import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mulberry32, sampleSix } from './superenalotto-integrated-walk-forward.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
export function romeDrawTime(date) {
  const noon = new Date(`${date}T12:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Rome',hour:'2-digit',hourCycle:'h23'}).format(noon));
  return new Date(`${date}T${String(20-(hour-12)).padStart(2,'0')}:00:00Z`);
}
export function aspectBin(a,b) {
  const diff = Math.abs(a-b)%360;
  const separation = Math.min(diff,360-diff);
  const index = [0,90,120,180].findIndex(angle => Math.abs(separation-angle)<=6);
  return index<0 ? 4:index;
}
export function ticket(scores) {
  const chosen=[], decades=Array(9).fill(0);
  const ranked=scores.map((score,i)=>({score,number:i+1})).sort((a,b)=>b.score-a.score||a.number-b.number);
  for(const item of ranked) {
    const decade=Math.floor((item.number-1)/10);
    if(decades[decade]>=3) continue;
    chosen.push(item.number); decades[decade]++;
    if(chosen.length===6) break;
  }
  return chosen.sort((a,b)=>a-b);
}
export function evaluate(draws, features, protocol, shift=0, keepRows=false) {
  const w=protocol.historyWindow, prior=protocol.shrinkageDraws;
  const names=[...new Set(protocol.models.flatMap(m=>m.features))];
  const binCount=name=>name==='MoonPhase'?8:name==='MercuryVenusAspect'?5:12;
  const counts=Object.fromEntries(names.map(n=>[n,Array.from({length:binCount(n)},()=>new Int32Array(90))]));
  const sizes=Object.fromEntries(names.map(n=>[n,new Int32Array(binCount(n))]));
  const global=new Int32Array(90), totals=protocol.models.map(()=>0), rows=[];
  let baselineTotal=0;
  const featureAt=i=>features[(i+shift)%features.length];
  const add=(i,delta)=>{
    for(const number of draws[i].numbers) global[number-1]+=delta;
    for(const name of names) {
      const bin=featureAt(i).bins[name]; sizes[name][bin]+=delta;
      for(const number of draws[i].numbers) counts[name][bin][number-1]+=delta;
    }
  };
  for(let i=0;i<w;i++) add(i,1);
  const predictionsAt=i=>protocol.models.map(model=>ticket(Array.from({length:90},(_,n)=>{
    let score=0;
    for(const name of model.features) {
      const bin=featureAt(i).bins[name];
      score+=(counts[name][bin][n]+prior*global[n]/w)/(sizes[name][bin]+prior);
    }
    return score/model.features.length;
  })));
  for(let i=w;i<draws.length;i++) {
    const predictions=predictionsAt(i);
    const overlaps=predictions.map(p=>p.filter(n=>draws[i].numbers.includes(n)).length);
    overlaps.forEach((h,j)=>totals[j]+=h);
    const baseline=ticket(Array.from(global));
    baselineTotal+=baseline.filter(n=>draws[i].numbers.includes(n)).length;
    if(keepRows) rows.push({date:draws[i].date,actual:draws[i].numbers,predictions,hits:overlaps,baseline});
    add(i-w,-1);add(i,1);
  }
  return {totals,baselineTotal,rows};
}
export function exactUpperP(trials,observed) {
  const choose=(n,k)=>{let value=1;for(let i=1;i<=k;i++)value=value*(n-k+i)/i;return value;};
  const one=Array.from({length:7},(_,k)=>choose(6,k)*choose(84,6-k)/choose(90,6));
  let distribution=[1];
  for(let i=0;i<trials;i++) {
    const next=Array(distribution.length+6).fill(0);
    distribution.forEach((p,n)=>one.forEach((q,k)=>next[n+k]+=p*q));distribution=next;
  }
  return distribution.reduce((sum,p,n)=>sum+(n>=observed?p:0),0);
}
export function holm(tests) {
  let maximum=0;
  [...tests].sort((a,b)=>a.rawP-b.rawP).forEach((t,i)=>{maximum=Math.max(maximum,Math.min(1,(tests.length-i)*t.rawP));t.holmP=maximum;});
  return tests;
}
async function main() {
  const protocolText=await readFile(new URL('./superenalotto-astronomy-protocol.json',import.meta.url),'utf8');
  const protocol=JSON.parse(protocolText);
  const protectedPaths=['D:/Super/superenalotto-integrated-forward-test.json','C:/Users/simon/Documents/Codex/superenalotto-forward-test.json','D:/Super/superenalotto-integrated-walk-forward.json'];
  const before=await Promise.all(protectedPaths.map(async path=>({path,sha256:hash(await readFile(path))})));
  const historical=JSON.parse(await readFile(protectedPaths[2],'utf8'));
  const source=historical.source;
  const response=await fetch(source.archiveUrl);if(!response.ok)throw Error(`CSV HTTP ${response.status}`);
  const csv=await response.text(), supplement=await readFile(source.supplementPath,'utf8');
  if(hash(csv)!==source.archiveSha256 || hash(supplement)!==source.supplementSha256) throw Error('Historical CSV snapshot changed; stop rather than alter dataset');
  const parse=text=>{const lines=text.trim().split(/\r?\n/);const header=lines.shift().replace(/^\uFEFF/,'').split(',');return lines.map(line=>{const cols=line.split(',');const row=Object.fromEntries(header.map((h,i)=>[h,cols[i]]));return {date:row.data,numbers:['n1','n2','n3','n4','n5','n6'].map(k=>Number(row[k]))};});};
  const byDate=new Map();
  for(const d of [...parse(csv),...parse(supplement)].filter(d=>d.date>=historical.coverage.firstDate && d.date<=historical.coverage.lastDate)) {
    if(new Set(d.numbers).size!==6 || d.numbers.some(n=>!Number.isInteger(n)||n<1||n>90))throw Error('Invalid numbers');
    if(byDate.has(d.date)&&JSON.stringify(byDate.get(d.date))!==JSON.stringify(d))throw Error('Conflicting duplicate');
    byDate.set(d.date,d);
  }
  const draws=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(draws.length!==796 || draws.at(-1).date!=='2026-09-29')throw Error('Coverage mismatch');
  const libResponse=await fetch(protocol.library.url);if(!libResponse.ok)throw Error('Library unavailable');
  const code=await libResponse.text();if(hash(code)!==protocol.library.sha256)throw Error('Library integrity failed');
  const astronomy={};new Function('exports',code)(astronomy);
  const features=draws.map(d=>{
    const time=romeDrawTime(d.date),angles={MoonPhase:astronomy.MoonPhase(time)};
    for(const body of ['Sun','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune']) angles[body]=astronomy.Ecliptic(astronomy.GeoVector(body,time,true)).elon;
    const bins=Object.fromEntries(Object.entries(angles).map(([name,angle])=>[name,Math.floor(angle/(name==='MoonPhase'?45:30))]));
    bins.MercuryVenusAspect=aspectBin(angles.Mercury,angles.Venus);
    return {date:d.date,utc:time.toISOString(),angles,bins};
  });
  const observed=evaluate(draws,features,protocol,0,true),trials=draws.length-protocol.historyWindow;
  const rng=mulberry32(protocol.seed),shifts=new Set();
  while(shifts.size<protocol.circularShiftReplicates)shifts.add(1+Math.floor(rng()*(draws.length-1)));
  const shifted=[...shifts].map(shift=>({shift,totals:evaluate(draws,features,protocol,shift).totals}));
  const tests=protocol.models.flatMap((m,i)=>[
    {model:m.name,test:'exact_uniform_upper',rawP:exactUpperP(trials,observed.totals[i])},
    {model:m.name,test:'circular_shift_upper',rawP:(1+shifted.filter(s=>s.totals[i]>=observed.totals[i]).length)/(shifted.length+1)},
  ]);holm(tests);
  const nullTotals=[];
  for(let sim=0;sim<protocol.nullReplicates;sim++) {
    let total=0;
    for(let j=0;j<trials;j++)total+=sampleSix(rng).filter(n=>n<=6).length;
    nullTotals.push(total);
  }
  nullTotals.sort((a,b)=>a-b);
  const after=await Promise.all(protectedPaths.map(async path=>({path,sha256:hash(await readFile(path))})));
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Protected file changed during run');
  const result={generatedAt:new Date().toISOString(),protocolSha256:hash(protocolText),protocol,
    coverage:historical.coverage,evaluation:{warmup:208,testedDraws:trials,firstDate:observed.rows[0].date,lastDate:draws.at(-1).date,independentHoldout:false,expectedTotalHits:trials*0.4},
    methods:protocol.models.map((m,i)=>({name:m.name,totalHits:observed.totals[i],meanHits:observed.totals[i]/trials,differenceFromFrequency208:observed.totals[i]-observed.baselineTotal,tests:tests.filter(t=>t.model===m.name)})),
    frequency208:{totalHits:observed.baselineTotal,meanHits:observed.baselineTotal/trials},
    randomArchives:{replicates:protocol.nullReplicates,description:'Independent uniform 6/90 archives: hit totals versus a fixed six-number ticket, equivalent marginal null for any no-lookahead predictor; not a full strategy refit.',meanTotalHits:nullTotals.reduce((a,b)=>a+b,0)/nullTotals.length,p05:nullTotals[Math.floor(.05*nullTotals.length)],p95:nullTotals[Math.floor(.95*nullTotals.length)]},
    shifted,features,rows:observed.rows,protectedFiles:after,
    limitations:['Historical data already explored: all p-values exploratory.','Circular shifts preserve much temporal dependence but introduce wrap-around; diagnostic only, not a causal test.','Sun and slow planets proxy season/date and are not isolated causal effects.','Nominal historical draw hour is a proxy; shifts are sensitivity controls, not validation of actual times.','Five numerical definitions do not cover every astrology system. No fixed-star or birth-chart test.','No monetary advantage measured. No model selected or prospective ticket changed.']};
  await writeFile(new URL('./superenalotto-astronomy-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({evaluation:result.evaluation,methods:result.methods,frequency208:result.frequency208,randomArchives:result.randomArchives,protectedFiles:result.protectedFiles},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e);process.exitCode=1;});
