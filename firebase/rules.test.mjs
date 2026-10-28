// Integration tests: run against the Firebase RTDB Emulator, never production.
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, set, get, update, query, orderByChild, orderByKey, limitToLast, serverTimestamp, increment } from 'firebase/database';

test('RTDB authorization and bandwidth contract', {skip:!process.env.FIREBASE_DATABASE_EMULATOR_HOST}, async () => {
  const [host,port]=process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(':');
  const env=await initializeTestEnvironment({projectId:'demo-htmltools',database:{host,port:Number(port),rules:await readFile(new URL('database.rules.json',import.meta.url),'utf8')}});
  try {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(async context=>{
      await set(ref(context.database()),{
        users:{alice:{conversations:{chat:{updated:1,messages:[{role:'user',content:'private'}]}}}},
        conversation_index:{alice:{playground:{chat:{title:'Private',updated:1}}}},
        art_rooms:{room:{owner:'alice',name:'Room',created:1,locked:false,joinCode:'ABCDE',members:{alice:{name:'Alice',joinedAt:1}}}},
        art_joincodes:{ABCDE:'room'},art_user_rooms:{alice:{room:true}},
        art_museum:{piece:{publisherUid:'alice',name:'Art',created:1,roomId:'room'}},
        art_museum_index:{piece:{publisherUid:'alice',created:1,name:'Art'}},
        slidesai_library:{deck:{id:'deck',ownerUid:'alice',created:1,theme:{slides:[{heading:'Slide'}]}}},
        slidesai_index:{deck:{id:'deck',ownerUid:'alice',created:1,name:'Deck'}}
      });
    });
    const alice=env.authenticatedContext('alice').database(),bob=env.authenticatedContext('bob').database(),anon=env.unauthenticatedContext().database();
    await assertFails(get(ref(anon)));
    await assertFails(get(ref(bob,'users/alice/conversations/chat')));
    await assertSucceeds(get(ref(alice,'users/alice/conversations/chat')));
    await assertFails(get(ref(alice,'users/alice/conversations')));
    await assertFails(get(ref(alice,'conversation_index/alice/playground')));
    await assertSucceeds(get(query(ref(alice,'conversation_index/alice/playground'),orderByChild('updated'),limitToLast(50))));
    await assertFails(get(query(ref(alice,'conversation_index/alice/playground'),orderByChild('updated'),limitToLast(51))));
    await assertFails(get(query(ref(bob,'conversation_index/alice/playground'),orderByChild('updated'),limitToLast(50))));
    await assertFails(set(ref(alice,'users/alice/conversations/bad'),{updated:2,messages:[{role:'user',content:'x'.repeat(262145)}]}));
    await assertFails(set(ref(alice,'users/alice/conversations/bad'),{updated:2,injected:{secret:'unbounded'}}));
    await assertFails(get(ref(bob,'art_rooms/room')));
    await assertSucceeds(get(ref(bob,'art_joincodes/ABCDE')));
    await assertFails(set(ref(bob,'art_rooms/room/members/bob'),{name:'Bob',code:'WRONG'}));
    await assertSucceeds(set(ref(bob,'art_rooms/room/members/bob'),{name:'Bob',code:'ABCDE',joinedAt:1}));
    await assertSucceeds(get(ref(bob,'art_rooms/room')));
    await assertFails(set(ref(bob,'art_rooms/room/owner'),'bob'));
    await assertSucceeds(set(ref(bob,'art_pixels/room/chunks/p0_p0/0_0'),{c:'#ff0000',uid:'bob',ts:serverTimestamp()}));
    await assertFails(set(ref(bob,'art_pixels/room/chunks/p0_p0/1_0'),{c:'#ff0000',uid:'alice',ts:serverTimestamp()}));
    await assertFails(get(ref(bob,'art_pixels/room/chunks')));
    await assertSucceeds(get(ref(bob,'art_pixels/room/chunks/p0_p0')));
    await assertFails(get(ref(bob,'art_chat/room')));
    await assertSucceeds(get(query(ref(bob,'art_chat/room'),limitToLast(50))));
    await assertSucceeds(update(ref(bob),{'art_chat/room/message1':{uid:'bob',text:'Hi',ts:serverTimestamp()},'art_chat_last/room/bob':serverTimestamp()}));
    await assertFails(update(ref(bob),{'art_chat/room/message2':{uid:'bob',text:'Spam',ts:serverTimestamp()},'art_chat_last/room/bob':serverTimestamp()}));
    await assertSucceeds(set(ref(alice,'art_rooms/room/banned/bob'),{name:'Bob',bannedAt:1}));
    await assertFails(get(ref(bob,'art_pixels/room/chunks/p0_p0')));
    await assertFails(set(ref(bob,'art_pixels/room/chunks/p0_p0/1_0'),{c:'#ff0000',uid:'bob',ts:serverTimestamp()}));
    await assertFails(get(ref(alice,'art_user_rooms/alice')));
    await assertSucceeds(get(query(ref(alice,'art_user_rooms/alice'),orderByKey(),limitToLast(50))));
    for(const collection of ['slidesai_index','art_museum_index']){
      await assertFails(get(ref(alice,collection)));
      await assertSucceeds(get(query(ref(alice,collection),orderByChild('created'),limitToLast(50))));
      await assertFails(get(query(ref(anon,collection),orderByChild('created'),limitToLast(50))));
    }
    await assertSucceeds(get(ref(bob,'slidesai_library/deck')));
    await assertFails(set(ref(bob,'slidesai_library/deck/ownerUid'),'bob'));
    await assertFails(set(ref(bob,'slidesai_index/forged'),{id:'forged',created:1,ownerUid:'bob'}));
    await assertFails(get(ref(bob,'art_museum')));
    await assertFails(set(ref(bob,'art_museum_likes/piece/bob'),true));
    await assertSucceeds(update(ref(bob),{'art_museum_likes/piece/bob':true,'art_museum_index/piece/likeCount':increment(1),'art_museum_like_last/piece/bob':serverTimestamp()}));
    await assertFails(set(ref(bob,'art_museum_likes/piece/alice'),true));
    await assertSucceeds(update(ref(bob),{'art_museum_index/piece/views':increment(1),'art_museum_views/piece/bob':true}));
    await assertFails(update(ref(bob),{'art_museum_index/piece/views':increment(1),'art_museum_views/piece/bob':true}));
    await assertFails(set(ref(bob,'gemini_users/bob/anything'),'retired'));
    // Parent creation plus index must validate against the same atomic new state.
    await assertSucceeds(update(ref(alice),{'slidesai_library/newdeck':{id:'newdeck',ownerUid:'alice',created:1,theme:{slides:[{heading:'Hello'}]}},'slidesai_index/newdeck':{id:'newdeck',ownerUid:'alice',created:1,name:'New'}}));
  }finally{await env.cleanup();}
});
