import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../assets/firebase-data.js',import.meta.url),'utf8');
function setup(){
  const buttons=[], parent={parentNode:{insertBefore:b=>buttons.push(b)},nextSibling:null};
  const window={};
  const context={window,TextEncoder,Map,Number,Array,Object,document:{querySelector:()=>parent,createElement:()=>({style:{},remove(){this.removed=true;}})},alert:()=>{}};
  vm.runInNewContext(source,context);
  return {api:window.HTData,buttons};
}
test('metadata strips message histories, ciphertext, scenes and private email',()=>{
  const {api}=setup();
  const meta=api.metadata({id:'abc',title:'Title',updated:1,messages:[{image:'secret'}],payload:{ct:'ciphertext'},ownerEmail:'private@example.test',scenes:['huge SVG'],theme:{background:'#000',slides:[{heading:'One'},{heading:'Two'}]},thumbnail:'x'.repeat(24577)});
  assert.equal(meta.title,'Title');
  for(const field of ['messages','payload','ownerEmail','scenes','thumbnail'])assert.equal(meta[field],undefined);
  assert.equal(meta.theme.slides.length,1);
});
test('atomic save and delete maintain detail and index without payload reads',async()=>{
  const {api}=setup(),writes=[];
  const db={ref:path=>{assert.equal(path,undefined);return{update:async value=>writes.push(value)};}};
  await api.save(db,'users/u/conversations/c','conversation_index/u/playground/c',{title:'Original',updated:1,messages:['hi']});
  await api.save(db,'users/u/conversations/c','conversation_index/u/playground/c',{updated:2,messages:['hi','reply']},true);
  assert.equal(writes[1]['conversation_index/u/playground/c'].title,'Original');
  assert.equal(writes[1]['conversation_index/u/playground/c'].messages,undefined);
  assert.deepEqual(Array.from(writes[1]['users/u/conversations/c/messages']),['hi','reply']);
  await api.remove(db,'users/u/conversations/c','conversation_index/u/playground/c');
  assert.equal(writes[2]['users/u/conversations/c'],null);assert.equal(writes[2]['conversation_index/u/playground/c'],null);
});
test('pagination enforces 50 rows and handles equal timestamp cursors without full scans',async()=>{
  const {api,buttons}=setup(),calls=[],renders=[];
  const db={ref:path=>{
    assert.equal(path,'conversation_index/u/playground');
    const q={orderByChild:f=>{assert.equal(f,'updated');return q;},endBefore:(value,key)=>{calls.push(['cursor',value,key]);return q;},limitToLast:n=>{assert.equal(n,50);return q;},once:async()=>{
      const batch=calls.some(c=>c[0]==='cursor')?[{key:'older',updated:0}]:Array.from({length:50},(_,i)=>({key:'c'+String(i).padStart(2,'0'),updated:1}));
      return{forEach:fn=>batch.forEach(row=>fn({key:row.key,val:()=>({title:row.key,updated:row.updated})}))};
    }};return q;
  }};
  await api.page(db,'conversation_index/u/playground','updated',v=>renders.push(v),'#list');
  assert.equal(renders[0].length,50);assert.equal(buttons[0].hidden,false);
  await buttons[0].onclick();
  // Event handler deliberately doesn't return the fetch promise, allow its microtask to finish.
  await new Promise(r=>setImmediate(r));
  assert.equal(calls[0][1],1);assert.equal(calls[0][2],'c00');
  assert.equal(renders.at(-1).length,51);assert.equal(buttons[0].hidden,true);
});
test('oversized saves fail explicitly instead of silently dropping old history',async()=>{
  const {api}=setup();
  await assert.rejects(()=>api.save({ref:()=>{throw Error('Must not write');}},'detail','index',{messages:['x'.repeat(8*1024*1024)]}),/8 MiB/);
});
test('detail cache avoids repeated payload reads and isolates mutable UI state',async()=>{
  const {api}=setup();let reads=0;
  const db={ref:()=>({get:async()=>{reads++;return{val:()=>({messages:['original']})};}})};
  const first=await api.detail(db,'private/u/chat');first.messages.push('local edit');
  const second=await api.detail(db,'private/u/chat');
  assert.equal(reads,1);assert.deepEqual(Array.from(second.messages),['original']);
});
