const test=require('node:test');
const assert=require('node:assert/strict');
const {screenHarness}=require('./ui-harness.cjs');
const {loadTypescript}=require('./load-typescript.cjs');
const U='11111111-1111-4111-8111-111111111111', F='22222222-2222-4222-8222-222222222222';
const M='33333333-3333-4333-8333-333333333333', I='44444444-4444-4444-8444-444444444444';
const B='55555555-5555-4555-8555-555555555555', C='66666666-6666-4666-8666-666666666666', T='a'.repeat(64);
const flush=()=>new Promise(r=>setImmediate(r));
const copy=v=>JSON.parse(JSON.stringify(v));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const editable=()=>({id:M,familyId:F,authorId:U,hasMedia:true,details:{title:'Фото',body:null,eventDate:'2024-01-01',childIds:[C]}});
const access=()=>({members:[{id:I,user_id:U,name:'Владелец',role:'owner'},{id:M,user_id:B,name:'Родственник',role:'member'}],invitations:[]});
const realEdit=loadTypescript('src/lib/memory-editing-service.ts',{'./supabase':{supabase:{}}});
const realAccess=loadTypescript('src/lib/family-access-service.ts',{'./supabase':{supabase:{}},'expo-crypto':{randomUUID:()=>I,getRandomBytes:()=>new Uint8Array(32).fill(10)}});
function harness(file,exportName='default',extra={}) {
  const storage=new Map();const writes=[];
  const state={focused:true,alive:true,auth:{session:{user:{id:U}},isPasswordRecovery:false,
    family:{status:'ready',family:{id:F,name:'Семья',role:'owner'},children:[{id:C,name:'Ася'}]},refreshFamily:async()=>{}},
    edits:[],lifecycle:[],invitations:[],joins:[],removals:[],routes:[],editResult:async()=>{},lifeResult:async()=>{},inviteResult:async()=>({id:I,expires_at:'2099-01-01T00:00:00Z',accepted_at:null,revoked_at:null}),joinResult:async()=>F};
  const edit={...realEdit,loadEditableMemory:async()=>editable(),saveMemoryEdit:async a=>{assert.ok([...storage.values()].some(v=>JSON.parse(v).memoryId===M));state.edits.push(copy(a));return state.editResult(a);}};
  const svc={...realAccess,getMemoryLifecycle:async()=>({id:M,archived:false,version:0}),
    setMemoryArchived:async a=>{assert.ok([...storage.values()].some(v=>JSON.parse(v).operationId===a.operationId));state.lifecycle.push(copy(a));return state.lifeResult(a);},
    getFamilyAccess:async()=>access(),createInvitation:async a=>{assert.ok([...storage.values()].some(v=>JSON.parse(v).token===a.token));state.invitations.push(copy(a));return state.inviteResult(a);},
    acceptInvitation:async (u,t)=>{state.joins.push([u,t]);return state.joinResult(u,t);},removeFamilyMember:async (...a)=>state.removals.push(a),
    getFamilyTrash:async()=>({items:[{id:M,title:'Фото',event_date:'2024-01-01',deleted_at:'2026-10-01T00:00:00Z',state_version:1,media_count:2}],hasMore:false})};
  const globals={localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{writes.push([k,v]);storage.set(k,v);},removeItem:k=>storage.delete(k)}};
  const screen=screenHarness(file,{
    'expo-router':{useRouter:()=>({push:p=>state.routes.push(p),replace:p=>state.routes.push(p),back:()=>state.routes.push('back')}),useLocalSearchParams:()=>({id:M}),useIsFocused:()=>state.focused},
    'expo-router/react-navigation':{usePreventRemove(){}},'expo-crypto':{randomUUID:()=>I},
    '../lib/auth-context':{useAuth:()=>state.auth},'../../lib/auth-context':{useAuth:()=>state.auth},
    '../../components/family-form-ui':{FamilyFormScreen:'FamilyFormScreen',FormButton:'FormButton',familyFormStyles:{}},
    '../../lib/memory-editing-service':edit,'../../lib/family-access-service':svc,...extra,
  },exportName,globals);
  const button=label=>screen.find(n=>n.type==='FormButton'&&n.props.label===label).props;
  const render=()=>screen.render(exportName==='JoinForm' ? {} : undefined);
  return {state,screen,storage,writes,button,render,svc};
}
test('editor journals before save, blocks duplicates and keeps exact original/desired snapshots',async()=>{
  const h=harness('src/app/memory/[id].tsx');h.render();await flush();h.render();
  h.screen.field('Заголовок воспоминания').onChangeText('Прогулка');const pending=deferred();h.state.editResult=()=>pending.promise;
  const held=h.button('Сохранить изменения').onPress;held();held();await flush();assert.equal(h.state.edits.length,1);
  assert.equal(h.state.edits[0].expected.title,'Фото');assert.equal(h.state.edits[0].desired.title,'Прогулка');
  pending.resolve();await flush();assert.deepEqual(h.state.routes,['back']);assert.equal(h.storage.size,0);h.screen.unmount();
});
test('unknown edit result freezes old fields and retries the identical persisted attempt',async()=>{
  const h=harness('src/app/memory/[id].tsx');h.render();await flush();h.render();const field=h.screen.field('Заголовок воспоминания');
  field.onChangeText('Прогулка');h.state.editResult=async()=>{throw new realEdit.MemoryEditError('synthetic pending','pending');};
  h.button('Сохранить изменения').onPress();await flush();field.onChangeText('НЕ ОТПРАВЛЯТЬ');h.render();
  assert.equal(h.screen.field('Заголовок воспоминания').value,'Прогулка');assert.equal(h.screen.field('Заголовок воспоминания').editable,false);
  h.state.editResult=async()=>{};h.button('Проверить и повторить правку').onPress();await flush();
  assert.deepEqual(h.state.edits[0],h.state.edits[1]);assert.equal(h.storage.size,0);h.screen.unmount();
});
test('a persisted edit resumes after remount even if the active row can no longer be read',async()=>{
  const h=harness('src/app/memory/[id].tsx', 'default', {'../../lib/memory-editing-service':{...realEdit,loadEditableMemory:async()=>{throw new realEdit.MemoryEditError('archived','unavailable');},saveMemoryEdit:async a=>h.state.edits.push(copy(a))}});
  const a=realEdit.prepareMemoryEdit({userId:U,memory:editable(),details:{...editable().details,title:'Правка'}});
  h.storage.set(`moya-istoriya:operation:v1:edit:${U}:${F}:${M}`,JSON.stringify(a));h.render();await flush();h.render();
  assert.equal(h.button('Проверить и повторить правку').disabled,false);h.button('Проверить и повторить правку').onPress();await flush();assert.deepEqual(h.state.edits,[copy(a)]);h.screen.unmount();
});
test('editor conflict cannot silently overwrite: journal clears and a fresh read is required',async()=>{
  const h=harness('src/app/memory/[id].tsx');h.render();await flush();h.render();
  h.state.editResult=async()=>{throw new realEdit.MemoryEditError('conflict','conflict');};h.button('Сохранить изменения').onPress();await flush();h.render();
  assert.equal(h.storage.size,0);assert.equal(h.button('Сохранить изменения').disabled,true);assert.equal(h.button('Загрузить актуальную версию').disabled,false);h.screen.unmount();
});
test('archive requires confirmation; an unknown outcome retains operation id and expected version',async()=>{
  const h=harness('src/app/memory/[id].tsx');h.render();await flush();h.render();h.button('Перенести в корзину').onPress();assert.equal(h.state.lifecycle.length,0);h.render();
  h.state.lifeResult=async()=>{throw new realAccess.FamilyOperationError('pending','pending');};h.button('Подтвердить перенос в корзину').onPress();await flush();h.render();
  h.state.lifeResult=async()=>{};h.button('Проверить и повторить действие').onPress();await flush();assert.deepEqual(h.state.lifecycle[0],h.state.lifecycle[1]);assert.equal(h.state.lifecycle[0].expectedVersion,0);h.screen.unmount();
});
for(const change of ['account','family','blur','recovery','unmount']) {
  test('held editor save cannot send after '+change,async()=>{
    const h=harness('src/app/memory/[id].tsx');h.render();await flush();h.render();const save=h.button('Сохранить изменения').onPress;
    if(change==='account')h.state.auth={...h.state.auth,session:{user:{id:B}}};
    if(change==='family')h.state.auth={...h.state.auth,family:{...h.state.auth.family,family:{id:B,role:'owner'}}};
    if(change==='blur')h.state.focused=false;if(change==='recovery')h.state.auth.isPasswordRecovery=true;
    if(change==='unmount')h.screen.unmount();else h.render();save();await flush();assert.equal(h.state.edits.length,0);h.screen.unmount();
  });
}
test('late editor completion after unmount does not navigate or write UI state',async()=>{
  const h=harness('src/app/memory/[id].tsx');h.render();await flush();h.render();const pending=deferred();h.state.editResult=()=>pending.promise;
  h.button('Сохранить изменения').onPress();await flush();h.screen.unmount();const writes=h.screen.stateWrites;pending.resolve();await flush();
  assert.equal(h.screen.stateWrites,writes);assert.equal(h.state.routes.length,0);
});
test('corrupt operation journal is preserved and prevents a fresh mutation',async()=>{
  const h=harness('src/app/memory/[id].tsx');const key=`moya-istoriya:operation:v1:edit:${U}:${F}:${M}`;h.storage.set(key,'{broken');
  h.render();await flush();h.render();h.button('Сохранить изменения').onPress();await flush();assert.equal(h.state.edits.length,0);assert.equal(h.storage.get(key),'{broken');h.screen.unmount();
});
test('invitation unknown response reuses the original token and id rather than making another invitation',async()=>{
  const h=harness('src/app/family/members.tsx');h.render();await flush();h.render();h.state.inviteResult=async()=>{throw new Error('synthetic lost response');};
  h.button('Создать приглашение').onPress();await flush();h.render();h.state.inviteResult=async()=>({id:I,expires_at:'2099-01-01T00:00:00Z',revoked_at:null,accepted_at:null});
  h.button('Проверить прежнее приглашение').onPress();await flush();assert.deepEqual(h.state.invitations[0],h.state.invitations[1]);h.screen.unmount();
});
test('ordinary member cannot see or invoke owner invitation actions',async()=>{
  const h=harness('src/app/family/members.tsx');h.state.auth.family.family.role='member';h.render();await flush();h.render();
  assert.throws(()=>h.button('Создать приглашение'));assert.throws(()=>h.button('Отозвать доступ'));h.screen.unmount();
});
test('revoking membership needs confirmation and sends the selected membership ID',async()=>{
  const h=harness('src/app/family/members.tsx');h.render();await flush();h.render();h.button('Отозвать доступ').onPress();assert.equal(h.state.removals.length,0);h.render();
  h.button('Подтвердить отзыв доступа').onPress();await flush();assert.deepEqual(h.state.removals,[[U,F,M]]);h.screen.unmount();
});
test('trash restoration requires confirmation, preserves all original files, and retries same receipt',async()=>{
  const h=harness('src/app/family/trash.tsx');h.render();await flush();h.render();h.button('Восстановить').onPress();assert.equal(h.state.lifecycle.length,0);h.render();
  h.state.lifeResult=async()=>{throw new realAccess.FamilyOperationError('pending','pending');};h.button('Подтвердить восстановление').onPress();await flush();h.render();
  h.state.lifeResult=async()=>{};h.button('Подтвердить восстановление').onPress();await flush();assert.deepEqual(h.state.lifecycle[0],h.state.lifecycle[1]);assert.equal(h.state.lifecycle[0].archived,false);h.screen.unmount();
});
test('guest invitation retains code for login but sends no accept RPC',async()=>{
  const h=harness('src/app/family/join.tsx','JoinForm');h.state.auth.session=null;h.render();h.screen.field('Код или ссылка приглашения').onChangeText(T);
  h.button('Войти для принятия приглашения').onPress();assert.deepEqual(h.state.routes,['/login']);assert.equal(h.storage.get('moya-istoriya:pending-invitation:v1'),T);assert.equal(h.state.joins.length,0);h.screen.unmount();
});
test('unknown acceptance freezes the submitted code and retries only that invitation',async()=>{
  const h=harness('src/app/family/join.tsx','JoinForm');h.render();const field=h.screen.field('Код или ссылка приглашения');field.onChangeText(T);
  h.state.joinResult=async()=>{throw new realAccess.FamilyOperationError('pending','pending');};h.button('Присоединиться к семье').onPress();await flush();field.onChangeText('b'.repeat(64));h.render();
  assert.equal(h.screen.field('Код или ссылка приглашения').value,T);assert.equal(h.screen.field('Код или ссылка приглашения').editable,false);
  h.state.joinResult=async()=>F;h.button('Проверить принятие приглашения').onPress();await flush();assert.deepEqual(h.state.joins,[[U,T],[U,T]]);assert.equal(h.storage.size,0);h.screen.unmount();
});
test('invitation screen never accepts during password recovery',async()=>{
  const h=harness('src/app/family/join.tsx','JoinForm');h.state.auth.isPasswordRecovery=true;h.render();assert.throws(()=>h.button('Присоединиться к семье'));assert.equal(h.state.joins.length,0);h.screen.unmount();
});
for(const [file,first,confirm,collection] of [
  ['src/app/family/members.tsx','Отозвать доступ','Подтвердить отзыв доступа','removals'],
  ['src/app/family/trash.tsx','Восстановить','Подтвердить восстановление','lifecycle'],
  ['src/app/memory/[id].tsx','Перенести в корзину','Подтвердить перенос в корзину','lifecycle'],
]) {
  test('held confirmation is harmless after cancellation: '+file,async()=>{
    const h=harness(file);h.render();await flush();h.render();h.button(first).onPress();h.render();const held=h.button(confirm).onPress;
    h.button('Отмена').onPress();held();await flush();assert.equal(h.state[collection].length,0);h.screen.unmount();
  });
}
test('explicitly rejected invitation clears pending token so owner can make a new invitation',async()=>{
  const h=harness('src/app/family/members.tsx');h.render();await flush();h.render();h.state.inviteResult=async()=>{throw new realAccess.FamilyOperationError('limit','invalid');};
  h.button('Создать приглашение').onPress();await flush();h.render();assert.equal(h.storage.size,0);assert.equal(h.button('Создать приглашение').disabled,false);h.screen.unmount();
});
test('late invitation read after unmount does not update the old screen',async()=>{
  const wait=deferred();let reads=0;
  const h=harness('src/app/family/members.tsx','default',{'../../lib/family-access-service':{...realAccess,
    getFamilyAccess:()=>++reads===1 ? Promise.resolve(access()) : wait.promise,
    createInvitation:async()=>({id:I,expires_at:'2099-01-01T00:00:00Z',revoked_at:null,accepted_at:null})}});
  h.render();await flush();h.render();h.button('Создать приглашение').onPress();await flush();h.screen.unmount();const writes=h.screen.stateWrites;
  wait.resolve(access());await flush();assert.equal(h.screen.stateWrites,writes);
});
test('a restored acceptance journal has priority over a different newly opened invitation',async()=>{
  const h=harness('src/app/family/join.tsx','JoinForm');h.storage.set(`moya-istoriya:operation:v1:join:${U}::`,JSON.stringify({userId:U,token:T}));
  h.screen.render({incoming:'b'.repeat(64)});h.button('Проверить принятие приглашения').onPress();await flush();assert.deepEqual(h.state.joins,[[U,T]]);h.screen.unmount();
});
test('trash refreshes after returning from the editor so restored rows do not stay visible',async()=>{
  let reads=0;const h=harness('src/app/family/trash.tsx','default',{'../../lib/family-access-service':{...realAccess,getFamilyTrash:async()=>{reads++;return {items:[],hasMore:false};}}});
  h.render();await flush();assert.equal(reads,1);h.state.focused=false;h.render();h.state.focused=true;h.render();await flush();assert.equal(reads,2);h.screen.unmount();
});
