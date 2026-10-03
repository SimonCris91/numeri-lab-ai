import test from 'node:test';
import assert from 'node:assert/strict';
import {romeDrawTime,aspectBin,ticket,evaluate,exactUpperP,holm} from './superenalotto-astronomy.mjs';
test('Rome clock summer/winter and aspect wraparound',()=>{
  assert.equal(romeDrawTime('2026-10-01').toISOString(),'2026-10-01T18:00:00.000Z');
  assert.equal(romeDrawTime('2026-01-01').toISOString(),'2026-01-01T19:00:00.000Z');
  assert.equal(aspectBin(359,1),0);assert.equal(aspectBin(0,120),2);assert.equal(aspectBin(0,40),4);
});
test('Deterministic constrained ticket and Holm',()=>{
  assert.deepEqual(ticket(Array(90).fill(1)),[1,2,3,11,12,13]);
  assert.deepEqual(holm([{rawP:.01},{rawP:.03},{rawP:.9}]).map(t=>t.holmP),[.03,.06,.9]);
  assert.ok(Math.abs(exactUpperP(1,1)-.347)<.005);
});
test('Changing evaluated outcome cannot change its prediction',()=>{
  const p={historyWindow:2,shrinkageDraws:30,models:[{features:['MoonPhase']}]};
  const draws=[{numbers:[1,2,3,11,12,13]},{numbers:[1,2,3,11,12,13]},{numbers:[1,2,3,11,12,13]}];
  const f=draws.map(()=>({bins:{MoonPhase:0}}));
  const a=evaluate(draws,f,p,0,true);
  const b=evaluate([...draws.slice(0,2),{numbers:[80,81,82,83,84,85]}],f,p,0,true);
  assert.deepEqual(a.rows[0].predictions,b.rows[0].predictions);
  assert.equal(a.totals[0],6);assert.equal(b.totals[0],0);
});
