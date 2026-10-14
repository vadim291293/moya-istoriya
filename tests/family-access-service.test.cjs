const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTypescript } = require('./load-typescript.cjs');
const U='11111111-1111-4111-8111-111111111111', F='22222222-2222-4222-8222-222222222222';
const M='33333333-3333-4333-8333-333333333333', I='44444444-4444-4444-8444-444444444444';
const T='a'.repeat(64);
const invitation=()=>({id:I,expires_at:'2099-01-01T00:00:00Z',revoked_at:null,accepted_at:null});
function harness() {
  const state={user:U,calls:[],result:null,error:null,throw:false,after:null};
  const client={auth:{getSession:async()=>({data:{session:state.user ? {user:{id:state.user},access_token:'synthetic:'+state.user} : null},error:null})},
    rpc:(name,args)=>{
      const request={name,args,headers:{}};
      const builder={setHeader:(k,v)=>{request.headers[k]=v;return builder;},then:(resolve,reject)=>Promise.resolve().then(()=>{
        state.calls.push(request);state.after?.();if(state.throw)throw new Error('synthetic network failure');
        return {data:state.result,error:state.error};
      }).then(resolve,reject)};return builder;
    }};
  const service=loadTypescript('src/lib/family-access-service.ts',{'./supabase':{supabase:client},'expo-crypto':{randomUUID:()=>I,getRandomBytes:()=>new Uint8Array(32).fill(10)}});
  return {state,service};
}
test('invitation accepts only a complete code or exact app invitation URL',()=>{
  const {service:s}=harness();assert.equal(s.invitationCode(T.toUpperCase()),T);
  assert.equal(s.invitationCode('moyaistoriya://family/join?code='+T),T);
  for(const v of ['',T.slice(1),'https://example.invalid/?code='+T,'moyaistoriya://other/join?code='+T,null])assert.throws(()=>s.invitationCode(v));
});
test('new invitation uses 32 random bytes and validated IDs',()=>{
  const {service:s}=harness();const a=s.newInvitation(U,F);assert.equal(a.token,'0a'.repeat(32));assert.equal(a.id,I);
  assert.throws(()=>s.newInvitation('bad',F));
});
test('invitation creation reuses supplied id/token, pins authorization and verifies returned id',async()=>{
  const {state,service:s}=harness();state.result=invitation();const a={userId:U,familyId:F,id:I,token:T};
  await s.createInvitation(a);await s.createInvitation(a);
  assert.deepEqual(state.calls[0].args,state.calls[1].args);assert.equal(state.calls[0].headers.Authorization,'Bearer synthetic:'+U);
  state.result={...invitation(),id:M};await assert.rejects(s.createInvitation(a),e=>e.kind==='pending');
});
test('RPC is never sent under another account, including sign-out before execution',async()=>{
  for(const other of [null,F]) {const {state,service:s}=harness();state.user=other;await assert.rejects(s.acceptInvitation(U,T),e=>e.kind==='scope');assert.equal(state.calls.length,0);}
});
test('account changes during RPC reject its result without a second request',async()=>{
  const {state,service:s}=harness();state.result=F;state.after=()=>{state.user=F;};
  await assert.rejects(s.acceptInvitation(U,T),e=>e.kind==='scope');assert.equal(state.calls.length,1);
});
test('unknown write outcome is pending, never a blind automatic retry',async()=>{
  const {state,service:s}=harness();state.throw=true;
  await assert.rejects(s.acceptInvitation(U,T),e=>e.kind==='pending');assert.equal(state.calls.length,1);
});
for(const [error,kind] of [[{code:'42501'},'forbidden'],[{code:'P0001',message:'INVITATION_UNAVAILABLE'},'invalid'],[{code:'P0001',message:'MEMORY_LIFECYCLE_CONFLICT'},'conflict'],[{code:'PGRST202'},'read']]) {
  test('known RPC error maps safely to '+kind+' ('+error.code+')',async()=>{
    const {state,service:s}=harness();state.error=error;await assert.rejects(s.acceptInvitation(U,T),e=>e.kind===kind);
  });
}
test('member revocation uses membership UUID, never user UUID',async()=>{
  const {state,service:s}=harness();state.result=I;await s.removeFamilyMember(U,F,I);
  assert.equal(state.calls[0].name,'remove_family_membership');assert.equal(state.calls[0].args.p_membership_id,I);
  assert.equal(state.calls[0].args.p_user_id,undefined);
});
test('member listing validates all rows and does not request profiles or emails',async()=>{
  const {state,service:s}=harness();state.result={members:[{id:I,user_id:U,role:'owner',name:null}],invitations:[invitation()]};
  assert.equal((await s.getFamilyAccess(U,F)).members[0].user_id,U);assert.equal(state.calls[0].name,'list_family_access');
  state.result={members:[{id:I,user_id:U,role:'member'}],invitations:[]};await assert.rejects(s.getFamilyAccess(U,F));
});
test('lifecycle retry preserves operation UUID and rejects stale-replay state without re-deleting',async()=>{
  const {state,service:s}=harness();const a={userId:U,familyId:F,memoryId:M,expectedVersion:0,archived:true,operationId:I};
  state.result={id:M,archived:true,version:1};await s.setMemoryArchived(a);await s.setMemoryArchived(a);
  assert.deepEqual(state.calls[0].args,state.calls[1].args);
  state.result={id:M,archived:false,version:2,replayed:true};await assert.rejects(s.setMemoryArchived(a),e=>e.kind==='conflict');assert.equal(state.calls.length,3);
});
test('malformed lifecycle journals never send an RPC',async()=>{
  const {state,service:s}=harness();const a={userId:U,familyId:F,memoryId:M,expectedVersion:0,archived:true,operationId:I};
  for(const patch of [{operationId:'bad'},{expectedVersion:-1},{expectedVersion:1.5},{archived:'true'}])await assert.rejects(s.setMemoryArchived({...a,...patch}));
  assert.equal(state.calls.length,0);
});
test('trash validates records and uses a bounded 30-item page with the 31st as sentinel',async()=>{
  const {state,service:s}=harness();const row={id:M,title:null,event_date:'2024-01-01',deleted_at:'2026-10-01T00:00:00Z',state_version:1,media_count:2};
  state.result=Array.from({length:31},()=>row);const page=await s.getFamilyTrash(U,F,{id:I,deleted_at:row.deleted_at});
  assert.equal(page.items.length,30);assert.equal(page.hasMore,true);assert.equal(state.calls[0].args.p_before_id,I);
  await assert.rejects(s.getFamilyTrash(U,F,{id:I,deleted_at:'not a timestamp'}));assert.equal(state.calls.length,1);
  state.result=[{...row,state_version:-1}];await assert.rejects(s.getFamilyTrash(U,F));
});
