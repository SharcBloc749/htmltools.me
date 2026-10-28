import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import targaryen from 'targaryen';
const now=1000000;
const originalNow=Date.now;Date.now=()=>now;after(()=>{Date.now=originalNow;});
const rules=JSON.parse(readFileSync(new URL('database.rules.json',import.meta.url),'utf8'));
const seed={users:{alice:{conversations:{chat:{updated:1,messages:[{role:'user',content:'private'}]}}}},conversation_index:{alice:{playground:{chat:{title:'Private',updated:1}}}},art_rooms:{room:{owner:'alice',name:'Room',created:1,locked:false,joinCode:'ABCDE',members:{alice:{name:'Alice',joinedAt:1}}}},art_joincodes:{ABCDE:'room'},art_user_rooms:{alice:{room:true}},art_museum:{piece:{publisherUid:'alice',name:'Art',created:1,roomId:'room'}},art_museum_index:{piece:{publisherUid:'alice',created:1,name:'Art'}},slidesai_library:{deck:{id:'deck',ownerUid:'alice',created:1,theme:{slides:[{heading:'Slide'}]}}},slidesai_index:{deck:{id:'deck',ownerUid:'alice',created:1,name:'Deck'}}};
function db(uid='alice'){return targaryen.database(rules,seed,now).as(uid?{uid,token:{}}:null);}
function yes(result){assert.equal(result.allowed,true,result.info);return result.newDatabase;}
function no(result){assert.equal(result.allowed,false,result.info);}
test('offline rules compiler accepts all expressions; root and cross-user history access denied',()=>{
  no(db(null).read('/'));no(db('bob').read('/users/alice/conversations/chat'));
  yes(db().read('/users/alice/conversations/chat'));no(db().read('/users/alice/conversations'));
});
test('private metadata requires correct indexed query and max 50 results',()=>{
  no(db().read('/conversation_index/alice/playground'));
  yes(db().read('/conversation_index/alice/playground',{query:{orderByChild:'updated',limitToLast:50}}));
  no(db().read('/conversation_index/alice/playground',{query:{orderByChild:'updated',limitToLast:51}}));
  no(db('bob').read('/conversation_index/alice/playground',{query:{orderByChild:'updated',limitToLast:50}}));
});
test('payload schema rejects unknown data, oversized text, excess message keys and forged owners',()=>{
  no(db().write('/users/alice/conversations/new',{updated:2,injected:{secret:'bad'}}));
  no(db().write('/users/alice/conversations/new',{updated:2,messages:[{role:'user',content:'x'.repeat(262145)}]}));
  no(db().write('/users/alice/conversations/new',{updated:2,messages:{200:{role:'user',content:'overflow'}}}));
  no(db().write('/users/alice/conversations/new',{updated:2,owner:'bob'}));
  yes(db().write('/users/alice/conversations/new',{updated:2,owner:'alice',messages:[{role:'user',content:'Hello'}]}));
});
test('room invites require correct code, not locked/banned; members cannot steal room',()=>{
  no(db('bob').read('/art_rooms/room'));
  no(db('bob').write('/art_rooms/room/members/bob',{name:'Bob',code:'WRONG'}));
  const joined=yes(db('bob').write('/art_rooms/room/members/bob',{name:'Bob',code:'ABCDE',joinedAt:now}));
  yes(joined.read('/art_rooms/room'));no(joined.write('/art_rooms/room/owner','bob'));
  const locked=yes(db().write('/art_rooms/room/locked',true)).as({uid:'bob'});
  no(locked.write('/art_rooms/room/members/bob',{name:'Bob',code:'ABCDE'}));
});
test('pixel writes are membership scoped and author validated; bulk chunk reads denied to members',()=>{
  const joined=yes(db('bob').write('/art_rooms/room/members/bob',{name:'Bob',code:'ABCDE'}));
  yes(joined.write('/art_pixels/room/chunks/p0_p0/0_0',{c:'#ff0000',uid:'bob',ts:now}));
  no(joined.write('/art_pixels/room/chunks/p0_p0/1_0',{c:'#ff0000',uid:'alice',ts:now}));
  no(joined.read('/art_pixels/room/chunks'));yes(joined.read('/art_pixels/room/chunks/p0_p0'));
  const banned=yes(joined.as({uid:'alice'}).write('/art_rooms/room/banned/bob',{name:'Bob',bannedAt:now})).as({uid:'bob'});
  no(banned.read('/art_pixels/room/chunks/p0_p0'));
});
test('presence has server-side cooldown and chat requires atomic timestamp cooldown',()=>{
  const first=yes(db().write('/art_presence/room/alice',{name:'Alice',ts:now}));
  no(first.write('/art_presence/room/alice',{name:'Alice',ts:now}));
  yes(first.with({now:now+250}).write('/art_presence/room/alice',{name:'Alice',ts:now+250},{now:now+250}));
  const chat={'art_chat/room/m1':{uid:'alice',text:'Hi',ts:now},'art_chat_last/room/alice':now};
  const after=yes(db().update('/',chat));
  no(after.update('/',{'art_chat/room/m2':{uid:'alice',text:'Spam',ts:now},'art_chat_last/room/alice':now}));
  no(db().write('/art_chat/room/m1',{uid:'alice',text:'No atomic cooldown',ts:now}));
});
test('public galleries require bounded authenticated metadata reads; details cannot be stolen',()=>{
  for(const collection of ['slidesai_index','art_museum_index']){
    no(db().read('/'+collection));yes(db().read('/'+collection,{query:{orderByChild:'created',limitToLast:50}}));
    no(db(null).read('/'+collection,{query:{orderByChild:'created',limitToLast:50}}));
  }
  yes(db('bob').read('/slidesai_library/deck'));
  no(db('bob').write('/slidesai_library/deck/ownerUid','bob'));
  no(db('bob').write('/slidesai_index/forged',{id:'forged',ownerUid:'bob',created:now}));
  yes(db().update('/',{'slidesai_library/newdeck':{id:'newdeck',ownerUid:'alice',created:now,theme:{slides:[{heading:'Hello'}]}},'slidesai_index/newdeck':{id:'newdeck',ownerUid:'alice',created:now,name:'New'}}));
});
test('views are unique per UID; likes cannot be written on behalf of another user',()=>{
  no(db('bob').write('/art_museum_likes/piece/bob',true));
  yes(db('bob').update('/',{'art_museum_likes/piece/bob':true,'art_museum_index/piece/likeCount':1,'art_museum_like_last/piece/bob':now}));
  no(db('bob').write('/art_museum_likes/piece/alice',true));
  const after=yes(db('bob').update('/',{'art_museum_index/piece/views':1,'art_museum_views/piece/bob':true}));
  no(after.update('/',{'art_museum_index/piece/views':2,'art_museum_views/piece/bob':true}));
});
