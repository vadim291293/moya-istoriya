const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const { expoCrypto, globals } = require('./capsule-crypto-mock.cjs');
const U='11111111-1111-4111-8111-111111111111', F='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333', A='44444444-4444-4444-8444-444444444444';
const B='55555555-5555-4555-8555-555555555555', KEY='a'.repeat(64);
const scope={userId:U,familyId:F}, permit={token:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'};
const copy=v=>JSON.parse(JSON.stringify(v));
function harness() {
  const state={user:U,calls:[],uploads:[],result:{configured:true},error:null,throw:false,after:null,read:new Uint8Array([0,1,255]),active:true,
    uploadAfter:null,isolated:[],verifiedUser:U,verificationError:null,signouts:0,fetches:[],responseBytes:new Uint8Array(31)};
  const client={auth:{getSession:async()=>({data:{session:state.user?{user:{id:state.user,email:'owner@example.test'},access_token:'synthetic:'+state.user}:null},error:null})},
    rpc:(name,args)=>{
      const request={name,args,headers:{}};
      const builder={setHeader:(key,value)=>{request.headers[key]=value;return builder;},then:(resolve,reject)=>Promise.resolve().then(()=>{
        state.calls.push(copy(request));state.after?.();if(state.throw)throw new Error('synthetic network failure');
        return {data:typeof state.result==='function'?state.result(args):state.result,error:state.error};
      }).then(resolve,reject)};return builder;
    }, storage:{from:bucket=>({upload:async(path,bytes,options)=>{state.uploads.push({bucket,path,bytes,options});state.uploadAfter?.();return {error:null};}})}};
  const createClient=(url,key,options)=>{state.isolated.push(options);return {auth:{
    signInWithPassword:async()=>({error:state.verificationError,data:{session:{user:{id:state.verifiedUser},access_token:'fresh-password-fixture'}}}),
    signOut:async()=>{state.signouts++;},
  }};};
  const service=loadTypescript('src/lib/capsule-service.ts',{
    './supabase':{supabase:client},'@supabase/supabase-js':{createClient},'expo-crypto':expoCrypto,
    './media-file':{readPickedMedia:async()=>state.read},
  },{...globals,process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://fixture.example.test',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key'}},
    fetch:async(url,options)=>{state.fetches.push({url,options});return {ok:true,headers:{get:()=>String(state.responseBytes.length)},arrayBuffer:async()=>state.responseBytes.buffer};}});
  return {state,s:service};
}
const file=()=>({id:A,storage_path:`${F}/${C}/${A}.bin`,media_type:'image',mime_type:'image/jpeg',file_size:3});
const meta=()=>({id:C,child_id:null,title:'Асе',version:0,archived:false,updated_at:'2026-10-12T00:00:00Z'});
test('capsule calls use a checked actor JWT and expose no password on list requests', async()=>{
  const {s,state}=harness();state.result=[meta()];const rows=await s.listCapsules(scope,permit);
  assert.equal(rows.length,1);assert.equal(state.calls[0].name,'family_capsule');
  assert.equal(state.calls[0].headers.Authorization,'Bearer synthetic:'+U);
  assert.equal(state.calls[0].args.p_data.password,undefined);assert.equal(state.calls[0].args.p_token,permit.token);
});
for(const phase of ['before','after']) test('capsule reads reject account switch '+phase+' the RPC',async()=>{
  const {s,state}=harness();if(phase==='before')state.user=B;else state.after=()=>{state.user=B;};
  await assert.rejects(s.capsuleConfigured(scope),e=>e.kind==='scope');assert.equal(state.calls.length,phase==='before'?0:1);
});
for(const [error,kind] of [[{message:'CAPSULE_LOCKED',code:'42501'},'locked'],[{code:'42501'},'scope'],[{message:'CAPSULE_CONFLICT',code:'P0001'},'conflict'],[{code:'22023'},'invalid'],[{code:'PGRST202'},'read']])
  test('capsule RPC safely classifies '+kind,async()=>{const {s,state}=harness();state.error=error;await assert.rejects(s.listCapsules(scope,permit),e=>e.kind===kind);});
test('password limits reject bcrypt truncation and setup does not replace an existing key',async()=>{
  const {s,state}=harness();assert.throws(()=>s.checkCapsulePassword('short'));assert.throws(()=>s.checkCapsulePassword('я'.repeat(40)));
  state.result={error:'already_configured'};await s.setupCapsuleVault(scope,'vault-password');
  assert.match(state.calls[0].args.p_data.key_hex,/^[0-9a-f]{64}$/);assert.equal(state.calls.length,1);
});
test('incorrect or blocked vault passwords never produce a permit',async()=>{
  const {s,state}=harness();state.result={error:'bad_password',remaining:0};await assert.rejects(s.unlockCapsuleVault(scope,'wrong'),e=>e.kind==='invalid');
  state.result={error:'blocked',retry_after:900};await assert.rejects(s.unlockCapsuleVault(scope,'correct'),/15 мин/);
  state.result={token:'bad',expires_at:'bad'};await assert.rejects(s.unlockCapsuleVault(scope,'correct'));
});
test('media uploads contain only encrypted bytes in the dedicated bucket and never overwrite',async()=>{
  const {s,state}=harness();const result=await s.uploadCapsuleFile(scope,permit,C,{uri:'file:///photo.jpg',mimeType:'image/jpeg',type:'image'},KEY,()=>state.active);
  const upload=state.uploads[0];assert.equal(upload.bucket,'family-capsules');assert.equal(upload.bytes.byteLength,31);
  assert.ok(upload.bytes instanceof ArrayBuffer,'RN upload must send raw ArrayBuffer');
  assert.equal(upload.options.upsert,false);assert.equal(upload.options.contentType,'application/octet-stream');
  assert.equal(upload.options.headers.Authorization,'Bearer synthetic:'+U);assert.equal(result.file_size,3);
  assert.ok(!Buffer.from(upload.bytes).equals(Buffer.from(state.read)));
});
test('unsupported MIME and oversized actual bytes are refused before Storage',async()=>{
  const {s,state}=harness();await assert.rejects(s.uploadCapsuleFile(scope,permit,C,{uri:'x',mimeType:'text/html'},KEY,()=>true));
  state.read=new Uint8Array(s.CAPSULE_MAX_BYTES+1);await assert.rejects(s.uploadCapsuleFile(scope,permit,C,{uri:'x.jpg',type:'image'},KEY,()=>true));
  assert.equal(state.uploads.length,0);
});
test('closed permits and switched accounts cannot keep or clean up another actor upload',async()=>{
  const {s,state}=harness();state.active=false;await assert.rejects(s.uploadCapsuleFile(scope,permit,C,{uri:'x.jpg'},KEY,()=>state.active),e=>e.kind==='locked');
  state.active=true;state.uploadAfter=()=>{state.user=B;};await assert.rejects(s.uploadCapsuleFile(scope,permit,C,{uri:'x.jpg'},KEY,()=>state.active),e=>e.kind==='scope');
  assert.equal(state.uploads.length,1);
});
test('unknown save retries the same capsule UUID, operation and ciphertext',async()=>{
  const {s,state}=harness();const attempt=await s.prepareCapsuleWrite({id:C,expectedVersion:-1,title:' Асе ',childId:null,letter:'Любим тебя',files:[],keyHex:KEY});
  assert.equal(attempt.title,'Асе');assert.equal(attempt.letter,undefined);state.throw=true;
  await assert.rejects(s.commitCapsuleWrite(scope,permit,attempt),e=>e.kind==='pending');state.throw=false;
  state.result={id:C,operation_id:attempt.operation_id,version:0};await s.commitCapsuleWrite(scope,permit,attempt);
  assert.deepEqual(state.calls[0].args,state.calls[1].args);assert.equal(state.uploads.length,0);
});
test('get decrypts only the chosen capsule and refuses cross-capsule files',async()=>{
  const {s,state}=harness();const attempt=await s.prepareCapsuleWrite({id:C,expectedVersion:-1,title:'Асе',childId:null,letter:'Привет',files:[file()],keyHex:KEY});
  state.result={...meta(),files:[file()],content_cipher:attempt.content_cipher,key_hex:KEY,last_operation:attempt.operation_id};
  assert.equal((await s.getCapsule(scope,permit,C)).letter,'Привет');
  state.result.files[0].storage_path=`${F}/${B}/${A}.bin`;await assert.rejects(s.getCapsule(scope,permit,C));
});
test('a mismatched save receipt remains pending and empty letters require media',async()=>{
  const {s,state}=harness();await assert.rejects(s.prepareCapsuleWrite({id:C,expectedVersion:-1,title:'Name',childId:null,letter:' ',files:[],keyHex:KEY}),e=>e.kind==='invalid');
  const attempt=s.archiveCapsuleWrite(meta(),true);state.result={id:B,operation_id:attempt.operation_id,version:1};
  await assert.rejects(s.commitCapsuleWrite(scope,permit,attempt),e=>e.kind==='pending');
});
test('file download rechecks the vault and rejects a damaged envelope without a signed URL',async()=>{
  const {s,state}=harness();state.result={key_hex:KEY};assert.equal((await s.downloadCapsuleFile(scope,permit,file())).length,31);
  assert.equal(state.calls[0].args.p_action,'key');assert.ok(state.fetches[0].url.includes('/object/authenticated/family-capsules/'));
  state.responseBytes=new Uint8Array(30);await assert.rejects(s.downloadCapsuleFile(scope,permit,file()));
});
test('password recovery uses a non-persisting isolated login, never replaces the app session',async()=>{
  const {s,state}=harness();await s.resetCapsulePassword(scope,'account-password','new-vault-password');
  assert.equal(state.isolated[0].auth.persistSession,false);assert.equal(state.isolated[0].auth.autoRefreshToken,false);
  assert.equal(state.calls[0].headers.Authorization,'Bearer fresh-password-fixture');assert.equal(state.calls[0].args.p_action,'reset');
  assert.equal(state.signouts,1);assert.equal(state.user,U);
});
test('failed recovery cannot send a reset RPC',async()=>{
  const {s,state}=harness();state.verifiedUser=B;
  await assert.rejects(s.resetCapsulePassword(scope,'wrong-password','new-vault-password'),e=>e.kind==='invalid');
  assert.equal(state.calls.length,0);assert.equal(state.signouts,1);
});
test('capsule pagination uses 30 items plus a sentinel and retains exact microseconds in the scoped cursor',async()=>{
  const {s,state}=harness();state.result=Array.from({length:31},(_,n)=>({...meta(),id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,updated_at:'2026-10-12T12:34:56.123456+00:00'}));
  const page=await s.getCapsulePage(scope,permit,false);assert.equal(page.items.length,30);assert.equal(page.nextCursor.updatedAt,'2026-10-12T12:34:56.123456+00:00');
  state.result=[];await s.getCapsulePage(scope,permit,false,page.nextCursor);
  assert.equal(state.calls[1].name,'list_family_capsules');assert.equal(state.calls[1].args.p_before_id,page.items.at(-1).id);
  assert.equal(state.calls[1].args.p_before_updated_at,page.nextCursor.updatedAt);
});
test('a capsule cursor cannot move into a different account, family, trash or malformed timestamp',async()=>{
  const {s,state}=harness();const cursor={...scope,archived:false,id:C,updatedAt:'2026-10-12T12:34:56Z'};
  for(const patch of [{userId:B},{familyId:B},{archived:true},{updatedAt:'infinity'},{id:'bad'}])await assert.rejects(s.getCapsulePage(scope,permit,false,{...cursor,...patch}),e=>e.kind==='invalid');
  assert.equal(state.calls.length,0);
});
test('capsule page rejects duplicates, a different section and an oversized response',async()=>{
  const {s,state}=harness();for(const response of [[meta(),meta()],[{...meta(),archived:true}],Array.from({length:32},()=>meta())]){
    state.result=response;await assert.rejects(s.getCapsulePage(scope,permit,false));
  }
});
