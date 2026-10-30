import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, buildAllocation, parseTotals, catalogIds, applyToEngagement, LIMITS } from '../../firebase/library/server/engagement.js';

function seeded(seed){let x=seed>>>0;return (min,max)=>{x=(1664525*x+1013904223)>>>0;return min+(x%(max-min));};}
test('totals are exact, bounded, and cover every book when possible',()=>{
  for(const count of [1,2,7,50,333]){
    const totals={views:1000,likes:100,hours:100};
    const a=buildAllocation(totals,Array.from({length:count},(_,i)=>'book'+i));
    for(const metric of ['views','likes','playtimeSeconds']){
      const values=Object.values(a).map(x=>x[metric]);
      const total=metric==='playtimeSeconds'?totals.hours*3600:totals[metric];
      assert.equal(values.reduce((x,y)=>x+y,0),total);
      assert.ok(values.every(v=>Number.isSafeInteger(v)&&v>=0));
      if(total>=count)assert.ok(values.every(v=>v>0));
      assert.ok(Math.max(...values)<=Math.ceil(total/count*2)+1);
    }
    Object.values(a).forEach(x=>assert.ok(x.likes<=x.views));
  }
});
test('small totals do not create negative or fractional shares',()=>{
  const a=allocate(3,10,seeded(42));assert.equal(a.reduce((x,y)=>x+y,0),3);assert.ok(a.every(v=>v===0||v===1));
  assert.deepEqual(allocate(0,5),[0,0,0,0,0]);
});
test('randomness changes the split but not the total',()=>{
  const ids=Array.from({length:20},(_,i)=>'b'+i);
  const a=buildAllocation({views:1000,likes:100,hours:10},ids);
  const b=buildAllocation({views:1000,likes:100,hours:10},ids);
  assert.notDeepEqual(a,b);
  assert.equal(Object.values(a).reduce((s,x)=>s+x.views,0),1000);
  assert.equal(Object.values(b).reduce((s,x)=>s+x.views,0),1000);
});
test('validation rejects fractional, negative, excessive and inconsistent totals',()=>{
  assert.throws(()=>parseTotals({views:1.5,likes:0,hours:0}));
  assert.throws(()=>parseTotals({views:-1,likes:0,hours:0}));
  assert.throws(()=>parseTotals({views:LIMITS.views+1,likes:0,hours:0}));
  assert.throws(()=>parseTotals({views:10,likes:11,hours:0}));
  assert.throws(()=>parseTotals({views:0,likes:0,hours:0}));
  assert.deepEqual(parseTotals({views:1000,likes:100,hours:100}),{views:1000,likes:100,hours:100});
});
test('catalog IDs are validated and sorted',()=>{
  assert.deepEqual(catalogIds({b:{title:'B'},a:{title:'A'},bad:{title:' '},'../x':{title:'X'}}),['a','b']);
  assert.throws(()=>catalogIds({}));
});
test('share application is idempotent per book and preserves existing counters',()=>{
  const current={views:10,likes:2,playtimeSeconds:60,adjustedViews:1,adjustedLikes:1,adjustedPlaytimeSeconds:1,likedBy:{u:true}};
  const delta={views:5,likes:1,playtimeSeconds:30};
  const next=applyToEngagement(current,delta,'share-1');
  assert.equal(next.views,15);assert.equal(next.likes,3);assert.equal(next.playtimeSeconds,90);assert.equal(next.adjustedViews,6);
  assert.deepEqual(next.likedBy,{u:true});
  assert.deepEqual(applyToEngagement(next,delta,'share-1'),next);
  const again=applyToEngagement(next,delta,'share-2');assert.equal(again.views,20);
});
