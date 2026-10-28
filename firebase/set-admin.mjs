import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const [uid,flag]=process.argv.slice(2);
if(!uid||uid.length>128||(flag&&flag!=='--apply')||process.argv.length>4)throw Error('Usage: node set-admin.mjs FIREBASE_UID [--apply]');
const app=initializeApp({credential:applicationDefault(),projectId:'general-database-4cb1c'});
try{
  const auth=getAuth(app),user=await auth.getUser(uid);
  if(flag==='--apply'){await auth.setCustomUserClaims(uid,{...(user.customClaims||{}),admin:true});console.log('Admin claim added. Sign out and back in:',uid);}
  else console.log('DRY RUN: would add admin:true to',uid,'— use --apply after verifying the UID in Firebase Console.');
}finally{await deleteApp(app);}
