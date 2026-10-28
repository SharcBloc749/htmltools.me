// One-time LOCAL admin operation. Reads each existing payload once; never run in a browser.
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const args=process.argv.slice(2);
if(args.some(a=>a!=='--apply'))throw Error('Usage: node backfill-indexes.mjs [--apply]');
const apply=args.includes('--apply');
const credential=applicationDefault();
const app=initializeApp({credential,projectId:'general-database-4cb1c',databaseURL:'https://general-database-4cb1c-default-rtdb.firebaseio.com'});
const db=getDatabase(app),context={window:{},TextEncoder};
vm.runInNewContext(await readFile(new URL('../assets/firebase-data.js',import.meta.url),'utf8'),context);
const metadata=context.window.HTData.metadata;
async function keys(path){
  const token=await credential.getAccessToken();
  const url='https://general-database-4cb1c-default-rtdb.firebaseio.com/'+path.split('/').map(encodeURIComponent).join('/')+'.json?shallow=true';
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token.access_token}});
  if(!response.ok)throw Error('Shallow enumeration failed: '+response.status+' at '+path);
  const value=await response.json();return value&&typeof value==='object'?Object.keys(value):[];
}
let inspected=0,copied=0,existing=0;
async function copy(detail,index,id){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)){console.warn('SKIP invalid item key at',index);return;}
  if((await db.ref(index).get()).exists()){existing++;return;}
  const value=(await db.ref(detail).get()).val();if(!value||typeof value!=='object')return;
  inspected++;
  const meta=metadata({...value,id});
  if(index.startsWith('conversation_index/'))meta.updated=Number(value.updated)||Number(value.created)||0;
  else meta.created=Number(value.created)||0;
  if(index.startsWith('art_museum_index/')){
    if(Number.isFinite(value.views))meta.views=value.views;
    var likers=Object.keys(value.likes||{});meta.likeCount=likers.length;
    if(apply)for(var start=0;start<likers.length;start+=500){var flags={};likers.slice(start,start+500).forEach(uid=>{flags['art_museum_likes/'+id+'/'+uid]=true;});await db.ref().update(flags);}
  }
  if(!apply){console.log('WOULD INDEX',index);return;}
  const result=await db.ref(index).transaction(current=>current===null?meta:undefined);
  if(result.committed)copied++;
}
try{
  for(const [root,suffix,kind] of [['users','conversations','playground'],['image_ai_conversations','','image_ai'],['image_gen_conversations','','image_gen'],['research_users','sessions','research']]){
    for(const uid of await keys(root)){
      const path=[root,uid,suffix].filter(Boolean).join('/');
      for(const id of await keys(path))await copy(path+'/'+id,'conversation_index/'+uid+'/'+kind+'/'+id,id);
    }
  }
  for(const [detail,index] of [['slidesai_library','slidesai_index'],['art_museum','art_museum_index']]){
    for(const id of await keys(detail))await copy(detail+'/'+id,index+'/'+id,id);
  }
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',inspected,copied,existing}));
}finally{await deleteApp(app);}
