const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTypescript}=require('./load-typescript.cjs');
const U='11111111-1111-4111-8111-111111111111', F='22222222-2222-4222-8222-222222222222', B='33333333-3333-4333-8333-333333333333';
const scope={userId:U,familyId:F};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness() {
  const state={platform:'android',environment:'standalone',strong:true,hardware:true,enrolled:true,canStore:true,storage:new Map(),calls:[],read:null,write:null,active:true};
  const options={};
  const SecureStore={WHEN_UNLOCKED_THIS_DEVICE_ONLY:6,isAvailableAsync:async()=>true,canUseBiometricAuthentication:()=>state.canStore,
    getItemAsync:async(key,opts)=>{state.calls.push(['read',key,opts]);if(key.startsWith('capsule.secret.')&&state.read)return state.read(key,opts);return state.storage.get(key)??null;},
    setItemAsync:async(key,value,opts)=>{state.calls.push(['write',key,opts]);if(key.startsWith('capsule.secret.')&&state.write)await state.write(key,value,opts);state.storage.set(key,value);options[key]=opts;},
    deleteItemAsync:async(key,opts)=>{state.calls.push(['delete',key,opts]);state.storage.delete(key);}};
  const s=loadTypescript('src/lib/capsule-biometry.native.ts',{
    'react-native':{Platform:{get OS(){return state.platform;}}},'expo-constants':{__esModule:true,default:{get executionEnvironment(){return state.environment;}}},
    'expo-secure-store':SecureStore,'expo-local-authentication':{
      SecurityLevel:{BIOMETRIC_STRONG:3},AuthenticationType:{FINGERPRINT:1},hasHardwareAsync:async()=>state.hardware,isEnrolledAsync:async()=>state.enrolled,
      getEnrolledLevelAsync:async()=>state.strong?3:2,supportedAuthenticationTypesAsync:async()=>[1],
      authenticateAsync(){throw new Error('A UI-only biometric Boolean cannot release the password');},
    },
  },{TextEncoder});
  return {state,s,options};
}
test('biometric enrollment uses OS-authenticated device-only storage; status never reads the password',async()=>{
  const {s,state,options}=harness();await s.enableCapsuleBiometry(scope,'vault-password',()=>state.active);
  const key=`capsule.secret.${U}.${F}`,opts=options[key];assert.equal(opts.requireAuthentication,true);assert.equal(opts.keychainAccessible,6);
  state.calls=[];assert.equal((await s.getCapsuleBiometry(scope)).enabled,true);
  assert.ok(!state.calls.some(c=>c[1]===key));
  assert.equal(await s.readCapsuleBiometry(scope,()=>true),'vault-password');
  assert.equal(state.calls.at(-1)[2].requireAuthentication,true);
});
for(const reason of ['weak','not-enrolled','hardware','secure-store','ios-go'])test('biometry fails closed for '+reason,async()=>{
  const {s,state}=harness();if(reason==='weak')state.strong=false;if(reason==='not-enrolled')state.enrolled=false;if(reason==='hardware')state.hardware=false;
  if(reason==='secure-store')state.canStore=false;if(reason==='ios-go'){state.platform='ios';state.environment='storeClient';}
  assert.equal((await s.getCapsuleBiometry(scope)).available,false);await assert.rejects(s.enableCapsuleBiometry(scope,'vault-password',()=>true));
  assert.equal(state.storage.size,0);
});
test('biometry is account/family scoped and cancellation does not silently authenticate',async()=>{
  const {s,state}=harness();await s.enableCapsuleBiometry(scope,'vault-password',()=>true);
  assert.equal((await s.getCapsuleBiometry({...scope,userId:B})).enabled,false);
  state.read=async()=>{throw new Error('synthetic user cancel');};await assert.rejects(s.readCapsuleBiometry(scope,()=>true));
  assert.equal((await s.getCapsuleBiometry(scope)).enabled,true,'cancel must not silently remove valid opt-in');
});
test('an invalidated biometric key disables opt-in without affecting server data',async()=>{
  const {s,state}=harness();await s.enableCapsuleBiometry(scope,'vault-password',()=>true);state.read=async()=>null;
  assert.equal(await s.readCapsuleBiometry(scope,()=>true),null);assert.equal((await s.getCapsuleBiometry(scope)).enabled,false);
});
test('a foreign/corrupted credential is never released, even if OS authentication succeeded',async()=>{
  const {s,state}=harness();await s.enableCapsuleBiometry(scope,'vault-password',()=>true);
  state.read=async()=>JSON.stringify({version:1,userId:B,familyId:F,password:'foreign-password'});
  await assert.rejects(s.readCapsuleBiometry(scope,()=>true));assert.equal((await s.getCapsuleBiometry(scope)).enabled,false);
});
test('late native read after background returns no credential',async()=>{
  const {s,state}=harness();await s.enableCapsuleBiometry(scope,'vault-password',()=>true);const wait=deferred();state.read=()=>wait.promise;
  const result=s.readCapsuleBiometry(scope,()=>state.active);await new Promise(r=>setImmediate(r));state.active=false;
  wait.resolve(JSON.stringify({version:1,...scope,password:'vault-password'}));await assert.rejects(result);
});
test('logout synchronously invalidates an in-flight write and removes its late secret/marker',async()=>{
  const {s,state}=harness();const wait=deferred();state.write=()=>wait.promise;
  const enabling=s.enableCapsuleBiometry(scope,'vault-password',()=>true);await new Promise(r=>setImmediate(r));
  const cleared=s.clearCapsuleBiometryUser(U);wait.resolve();await assert.rejects(enabling);await cleared;
  assert.equal(state.storage.size,0);
});
test('disabling biometrics removes scoped credentials and cannot read with unauthenticated options',async()=>{
  const {s,state}=harness();await s.enableCapsuleBiometry(scope,'vault-password',()=>true);await s.disableCapsuleBiometry(scope);
  assert.equal(await s.readCapsuleBiometry(scope,()=>true),null);
  assert.ok(state.calls.filter(c=>c[0]==='read'&&c[1].startsWith('capsule.secret.')).every(c=>c[2].requireAuthentication===true));
});
test('web never stores or releases a biometric password',async()=>{
  const s=loadTypescript('src/lib/capsule-biometry.ts',{}, {localStorage:{setItem(){throw new Error('No browser secret');}}});
  assert.equal((await s.getCapsuleBiometry(scope)).available,false);assert.equal(await s.readCapsuleBiometry(scope,()=>true),null);
  await assert.rejects(s.enableCapsuleBiometry(scope,'vault-password',()=>true));
});
