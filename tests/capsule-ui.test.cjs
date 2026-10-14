const test=require('node:test');
const assert=require('node:assert/strict');
const {screenHarness}=require('./ui-harness.cjs');
const U='11111111-1111-4111-8111-111111111111', F='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333', A='44444444-4444-4444-8444-444444444444';
const B='55555555-5555-4555-8555-555555555555';
const permit={token:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00Z'};
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class CapsuleError extends Error {constructor(message,kind='read'){super(message);this.kind=kind;}}
const meta=()=>({id:C,child_id:null,title:'Секретное послание',version:0,archived:false,updated_at:'2026-10-12T00:00:00Z'});
const file=()=>({id:A,storage_path:`${F}/${C}/${A}.bin`,media_type:'image',mime_type:'image/jpeg',file_size:3});
function harness() {
  const state={focused:true,configured:true,statusCalls:0,unlocks:0,locks:0,setups:0,keys:0,commits:[],uploads:[],disposals:0,routes:[],events:[],timers:[],
    auth:{session:{user:{id:U}},isPasswordRecovery:false,family:{status:'ready',family:{id:F,name:'Семья',role:'owner'},children:[]}},
    rows:[meta()],item:{...meta(),letter:'Привет, взрослая Ася',files:[file()],keyHex:'a'.repeat(64),lastOperation:A},
    commit:async()=>{},get:null,key:null,pick:null,download:null,temporary:null,biometric:{available:false,enabled:false,label:'Отпечаток пальца',reason:null},
    bioEnables:[],bioReads:0,bioDisables:0,bioRead:null,bioEnable:null,unlockResult:null};
  const svc={CapsuleError,
    capsuleConfigured:async()=>{state.statusCalls++;return state.configured;},
    setupCapsuleVault:async()=>{state.setups++;},resetCapsulePassword:async()=>{},
    unlockCapsuleVault:async()=>{state.unlocks++;return state.unlockResult?state.unlockResult():{...permit};},lockCapsuleVault:async()=>{state.locks++;},
    getCapsulePage:async(_s,_p,archived,cursor)=>state.page?state.page(archived,cursor):({items:state.rows.filter(r=>r.archived===archived),nextCursor:null}),capsuleKey:async()=>{state.keys++;return state.key?state.key():'a'.repeat(64);},
    getCapsule:async()=>state.get?state.get():state.item,
    uploadCapsuleFile:async(_s,_p,_id,asset,_k,active)=>{assert.ok(active());state.uploads.push(asset);return file();},
    prepareCapsuleWrite:async input=>({action:'save',id:input.id,operation_id:A,expected_version:input.expectedVersion,title:input.title,content_cipher:'synthetic-cipher',files:input.files}),
    archiveCapsuleWrite:(c,archived)=>({action:'archive',id:c.id,operation_id:A,expected_version:c.version,archived}),
    commitCapsuleWrite:async(_s,_p,attempt)=>{state.commits.push(JSON.parse(JSON.stringify(attempt)));return state.commit(attempt);},
    downloadCapsuleFile:async()=>state.download?state.download():new Uint8Array([1,2,3]),
  };
  const screen=screenHarness('src/app/family/capsules.tsx',{
    'expo-router':{useRouter:()=>({back:()=>state.routes.push('back')}),useNavigation:()=>({dispatch:action=>state.routes.push(action)}),useIsFocused:()=>state.focused},
    'expo-router/react-navigation':{usePreventRemove:(enabled,handler)=>{state.removal={enabled,handler};}},
    'react-native':{...Object.fromEntries(['View','Text','TextInput','Pressable','ActivityIndicator','FlatList'].map(n=>[n,n])),StyleSheet:{create:v=>v},
      AppState:{currentState:'active',addEventListener:(_n,cb)=>{state.events.push(cb);return {remove(){}};}}},
    '../lib/auth-context':{useAuth:()=>state.auth},
    '../../components/family-form-ui':{FamilyFormScreen:'FamilyFormScreen',FormButton:'FormButton',familyFormStyles:{}},
    '../../components/photo-viewer':{PhotoViewer:'PhotoViewer'},'../../components/video-viewer':{VideoViewer:'VideoViewer'},
    '../../components/audio-viewer':{AudioViewer:'AudioViewer'},'../../components/voice-recorder':{VoiceRecorder:'VoiceRecorder'},
    '../../lib/capsule-service':svc,'../../lib/capsule-crypto':{decryptCapsuleBytes:async bytes=>bytes},
    '../../lib/capsule-temp':{capsuleTemporaryFile:async()=>state.temporary?state.temporary():({uri:'file:///owned-capsule-temp.jpg',dispose:()=>state.disposals++})},
    '../../lib/capsule-biometry':{getCapsuleBiometry:async()=>state.biometric,
      enableCapsuleBiometry:async(_scope,password,active)=>{assert.ok(active());state.bioEnables.push(password);if(state.bioEnable)await state.bioEnable();},
      readCapsuleBiometry:async(_scope,active)=>{assert.ok(active());state.bioReads++;return state.bioRead?state.bioRead(): 'vault-password';},
      disableCapsuleBiometry:async()=>{state.bioDisables++;}},
    'expo-crypto':{randomUUID:()=>C},'expo-image-picker':{launchImageLibraryAsync:async()=>state.pick?state.pick():({canceled:true,assets:[]})},
  },'default',{setTimeout:cb=>{state.timers.push(cb);return state.timers.length;},clearTimeout(){},
    localStorage:{getItem(){throw new Error('Private vault must not access localStorage');},setItem(){throw new Error('Private vault must not write localStorage');}}});
  const button=label=>screen.find(n=>n.type==='FormButton'&&n.props.label===label).props;
  const render=()=>screen.render();
  const enter=async()=>{render();await flush();render();screen.field('Пароль раздела капсул').onChangeText('vault-password');render();button(state.configured?'Открыть капсулы':'Создать защищённый раздел').onPress();await flush();render();};
  const select=async()=>{screen.button('Открыть капсулу Секретное послание').onPress();await flush();render();};
  const makeDraft=()=>{button('Создать послание').onPress();render();screen.field('Название капсулы').onChangeText('Асе');screen.field('Письмо ребёнку').onChangeText('Будь счастлива');render();};
  return {state,screen,svc,button,render,enter,select,makeDraft};
}

test('saved capsule is fetched again after logout and a fresh screen for the same account',async()=>{
  const remote=[];const h=harness();h.state.rows=remote;await h.enter();h.makeDraft();
  h.state.commit=async attempt=>{remote.push({...meta(),title:attempt.title,id:attempt.id});};
  h.button('Сохранить капсулу').onPress();await flush();h.render();
  h.screen.button('Открыть капсулу Асе');
  h.state.auth={...h.state.auth,session:null,family:{status:'idle'}};h.render();h.screen.unmount();
  assert.equal(remote.length,1);
  const again=harness();again.state.rows=remote;again.state.item={...again.state.item,...remote[0],letter:'Будь счастлива',files:[]};
  await again.enter();assert.equal(again.state.setups,0);again.screen.button('Открыть капсулу Асе').onPress();await flush();again.render();
  assert.equal(again.screen.field('Письмо ребёнку').value,'Будь счастлива');assert.equal(again.state.commits.length,0);again.screen.unmount();
});

test('a failed list read is not shown as an empty vault and creation waits for a successful read',async()=>{
  const h=harness();h.state.rows=[];h.state.page=async()=>{throw new CapsuleError('synthetic offline');};await h.enter();
  assert.equal(h.button('Создать послание').disabled,true);
  h.button('Создать послание').onPress();h.render();assert.throws(()=>h.screen.field('Письмо ребёнку'));
  h.screen.find(n=>n.type==='Text'&&String(n.props.children).includes('Это не означает, что капсулы исчезли'));
  assert.throws(()=>h.screen.find(n=>n.type==='Text'&&String(n.props.children).includes('Пока нет сохранённых посланий')));
  h.state.page=async()=>({items:[meta()],nextCursor:null});h.button('Обновить список капсул').onPress();await flush();h.render();
  h.screen.button('Открыть капсулу Секретное послание');assert.equal(h.button('Создать послание').disabled,false);h.screen.unmount();
});

test('confirmed save remains confirmed when the following list refresh fails',async()=>{
  const h=harness();await h.enter();h.makeDraft();
  h.state.page=async()=>{throw new CapsuleError('synthetic list failure');};
  h.button('Сохранить капсулу').onPress();await flush();h.render();
  assert.equal(h.state.commits.length,1);assert.throws(()=>h.screen.field('Письмо ребёнку'));
  h.screen.find(n=>n.type==='Text'&&String(n.props.children).includes('Капсула сохранена на сервере'));
  h.screen.find(n=>n.type==='Text'&&String(n.props.children).includes('Это не означает, что капсулы исчезли'));h.screen.unmount();
});

test('draft can stay and save instead of being silently discarded by the list or header back',async()=>{
  const h=harness();await h.enter();h.makeDraft();h.button('Вернуться к списку без сохранения').onPress();h.render();
  h.button('Остаться и сохранить').onPress();h.render();assert.equal(h.screen.field('Письмо ребёнку').value,'Будь счастлива');
  h.screen.find(n=>n.type==='FamilyFormScreen').props.onBack();h.render();assert.equal(h.state.routes.length,0);
  h.button('Остаться и сохранить').onPress();h.render();h.button('Сохранить капсулу').onPress();await flush();h.render();
  assert.equal(h.state.commits.length,1);h.screen.unmount();
});

test('hardware back requires a discard confirmation and does not block logout',async()=>{
  const h=harness();await h.enter();h.makeDraft();assert.equal(h.state.removal.enabled,true);
  const action={type:'GO_BACK'};h.state.removal.handler({data:{action}});h.render();assert.equal(h.state.routes.length,0);
  h.button('Выйти без сохранения').onPress();h.render();assert.deepEqual(h.state.routes,[action]);assert.equal(h.state.commits.length,0);h.screen.unmount();
  const logout=harness();await logout.enter();logout.makeDraft();logout.state.auth={...logout.state.auth,session:null,family:{status:'idle'}};logout.render();
  assert.equal(logout.state.removal.enabled,false);assert.throws(()=>logout.screen.field('Письмо ребёнку'));logout.screen.unmount();
});

test('a retained discard confirmation after background cannot navigate or discard a restored draft',async()=>{
  const h=harness();await h.enter();h.makeDraft();h.screen.find(n=>n.type==='FamilyFormScreen').props.onBack();h.render();
  const confirm=h.button('Выйти без сохранения').onPress;h.state.events[0]('background');h.state.events[0]('active');confirm();h.render();
  assert.equal(h.state.routes.length,0);h.screen.field('Пароль раздела капсул').onChangeText('vault-password');h.render();
  h.button('Открыть капсулы').onPress();await flush();h.render();assert.equal(h.screen.field('Письмо ребёнку').value,'Будь счастлива');h.screen.unmount();
});
test('member deep link has no vault fields or RPC calls',async()=>{
  const h=harness();h.state.auth.family.family.role='member';h.render();await flush();h.render();
  assert.equal(h.state.statusCalls,0);assert.throws(()=>h.screen.field('Пароль раздела капсул'));assert.throws(()=>h.button('Создать послание'));h.screen.unmount();
});
test('vault has no readable letters or list before password entry; setup confirms passwords',async()=>{
  const h=harness();h.state.configured=false;h.render();await flush();h.render();
  assert.throws(()=>h.screen.button('Открыть капсулу Секретное послание'));
  h.screen.field('Пароль раздела капсул').onChangeText('password');h.screen.field('Повторить пароль капсул').onChangeText('different');h.render();
  h.button('Создать защищённый раздел').onPress();await flush();assert.equal(h.state.setups,0);assert.equal(h.state.unlocks,0);
  h.screen.field('Повторить пароль капсул').onChangeText('password');h.render();h.button('Создать защищённый раздел').onPress();await flush();h.render();
  assert.equal(h.state.setups,1);assert.equal(h.state.unlocks,1);h.button('Создать послание');h.screen.unmount();
});
test('failure to obtain the key closes the vault instead of enabling an unusable draft',async()=>{
  const h=harness();h.state.key=async()=>{throw new Error('synthetic offline');};await h.enter();
  assert.throws(()=>h.button('Создать послание'));h.button('Открыть капсулы');assert.equal(h.state.locks,1);h.screen.unmount();
});
test('duplicate save presses send one attempt and unknown outcome freezes retained fields',async()=>{
  const h=harness();await h.enter();h.makeDraft();const held=h.screen.field('Письмо ребёнку').onChangeText;
  const wait=deferred();h.state.commit=()=>wait.promise;const save=h.button('Сохранить капсулу').onPress;save();save();await flush();
  assert.equal(h.state.commits.length,1);wait.reject(new CapsuleError('synthetic pending','pending'));await flush();held('НЕ ЗАМЕНЯТЬ');h.render();
  assert.equal(h.screen.field('Письмо ребёнку').value,'Будь счастлива');assert.equal(h.screen.field('Письмо ребёнку').editable,false);
  h.state.commit=async()=>{};h.button('Проверить и повторить сохранение').onPress();await flush();assert.deepEqual(h.state.commits[0],h.state.commits[1]);h.screen.unmount();
});
test('pending save can be confirmed from the exact operation receipt without another mutation',async()=>{
  const h=harness();await h.enter();h.makeDraft();h.state.commit=async()=>{throw new CapsuleError('unknown','pending');};
  h.button('Сохранить капсулу').onPress();await flush();h.render();h.state.item.lastOperation=A;
  h.button('Проверить состояние на сервере').onPress();await flush();h.render();
  assert.equal(h.state.commits.length,1);h.button('Создать послание');h.screen.unmount();
});
test('trash requires confirmation, archives metadata only and can restore the same capsule',async()=>{
  const h=harness();await h.enter();await h.select();h.button('Переместить капсулу в корзину').onPress();h.render();
  assert.equal(h.state.commits.length,0);h.button('Подтвердить перемещение').onPress();await flush();h.render();
  assert.equal(h.state.commits[0].action,'archive');assert.equal(h.state.commits[0].archived,true);assert.equal(h.state.uploads.length,0);
  h.state.rows=[{...meta(),archived:true,version:1}];h.state.item={...h.state.item,archived:true,version:1};
  h.button('Обновить список капсул').onPress();await flush();h.render();h.button('Корзина капсул').onPress();await flush();h.render();await h.select();
  h.button('Вернуть из корзины').onPress();await flush();assert.equal(h.state.commits[1].archived,false);assert.equal(h.state.commits[1].expected_version,1);h.screen.unmount();
});
for(const change of ['background','blur','account','family','member','recovery','unmount','expiry']) test('closing on '+change+' ignores retained save handlers and hides plaintext',async()=>{
  const h=harness();await h.enter();h.makeDraft();const save=h.button('Сохранить капсулу').onPress;
  if(change==='background')h.state.events[0]('background');
  if(change==='expiry')h.state.timers.at(-1)();
  if(change==='blur')h.state.focused=false;
  if(change==='account')h.state.auth={...h.state.auth,session:{user:{id:B}}};
  if(change==='family')h.state.auth={...h.state.auth,family:{...h.state.auth.family,family:{id:B,role:'owner'}}};
  if(change==='member')h.state.auth.family.family.role='member';
  if(change==='recovery')h.state.auth.isPasswordRecovery=true;
  if(change==='unmount')h.screen.unmount();else h.render();
  const writes=h.screen.stateWrites;save();await flush();assert.equal(h.state.commits.length,0);
  if(change==='unmount')assert.equal(h.screen.stateWrites,writes);else assert.throws(()=>h.screen.field('Письмо ребёнку'));
  h.screen.unmount();
});
test('closing a decrypted photo removes the owned temp file and background closes the vault',async()=>{
  const h=harness();await h.enter();await h.select();h.button('Открыть фото 1').onPress();await flush();h.render();
  const photo=h.screen.find(n=>n.type==='PhotoViewer');assert.equal(photo.props.photos[0].signed_url,'file:///owned-capsule-temp.jpg');
  photo.props.onClose();h.render();assert.equal(h.state.disposals,1);
  h.button('Открыть фото 1').onPress();await flush();h.render();h.state.events[0]('background');h.render();
  assert.equal(h.state.disposals,2);assert.throws(()=>h.screen.find(n=>n.type==='PhotoViewer'));h.screen.unmount();
});
test('late plaintext temp creation after unmount disposes the file without setting viewer state',async()=>{
  const h=harness();await h.enter();await h.select();const wait=deferred();h.state.temporary=()=>wait.promise;
  h.button('Открыть фото 1').onPress();await flush();h.screen.unmount();const writes=h.screen.stateWrites;
  wait.resolve({uri:'file:///late.jpg',dispose:()=>h.state.disposals++});await flush();assert.equal(h.state.disposals,1);assert.equal(h.screen.stateWrites,writes);
});
test('late get response after background cannot restore a readable letter',async()=>{
  const h=harness();await h.enter();const wait=deferred();h.state.get=()=>wait.promise;
  h.screen.button('Открыть капсулу Секретное послание').onPress();await flush();h.state.events[0]('background');
  wait.resolve(h.state.item);await flush();h.render();assert.throws(()=>h.screen.field('Письмо ребёнку'));h.screen.unmount();
});
test('native picker may background the app, but returning requires the password before restoring the RAM-only draft',async()=>{
  const h=harness();await h.enter();h.makeDraft();const wait=deferred();h.state.pick=()=>wait.promise;
  h.button('Добавить фото или видео').onPress();await flush();h.state.events[0]('background');h.state.events[0]('active');
  wait.resolve({canceled:false,assets:[{uri:'file:///photo.jpg',type:'image',mimeType:'image/jpeg'}]});await flush();h.render();
  assert.equal(h.state.uploads.length,0);assert.throws(()=>h.screen.field('Письмо ребёнку'));
  h.screen.field('Пароль раздела капсул').onChangeText('vault-password');h.render();h.button('Открыть капсулы').onPress();await flush();h.render();
  assert.equal(h.state.uploads.length,1);assert.equal(h.screen.field('Письмо ребёнку').value,'Будь счастлива');h.screen.unmount();
});
test('background draft recovery requires the password and restores text without persistent plaintext storage',async()=>{
  const h=harness();await h.enter();h.makeDraft();h.state.events[0]('inactive');h.state.events[0]('background');h.state.events[0]('active');h.render();
  assert.throws(()=>h.screen.field('Письмо ребёнку'));h.screen.field('Пароль раздела капсул').onChangeText('vault-password');h.render();
  h.button('Открыть капсулы').onPress();await flush();h.render();assert.equal(h.screen.field('Письмо ребёнку').value,'Будь счастлива');h.screen.unmount();
});
test('a pending save survives background in RAM and retries its exact operation after re-unlock',async()=>{
  const h=harness();await h.enter();h.makeDraft();h.state.commit=async()=>{throw new CapsuleError('unknown','pending');};
  h.button('Сохранить капсулу').onPress();await flush();h.render();h.state.events[0]('background');h.state.events[0]('active');h.render();
  h.screen.field('Пароль раздела капсул').onChangeText('vault-password');h.render();h.button('Открыть капсулы').onPress();await flush();h.render();
  assert.equal(h.screen.field('Письмо ребёнку').editable,false);h.state.commit=async()=>{};h.button('Проверить и повторить сохранение').onPress();await flush();
  assert.deepEqual(h.state.commits[0],h.state.commits[1]);h.screen.unmount();
});
test('capsule password and confirmation can be shown/hidden and rehide on background/recovery',async()=>{
  const h=harness();h.state.configured=false;h.render();await flush();h.render();
  assert.equal(h.screen.field('Пароль раздела капсул').secureTextEntry,true);h.screen.button('Показать пароль капсулы').onPress();h.render();
  assert.equal(h.screen.field('Пароль раздела капсул').secureTextEntry,false);assert.equal(h.screen.field('Повторить пароль капсул').secureTextEntry,false);
  h.state.events[0]('background');h.state.events[0]('active');h.render();assert.equal(h.screen.field('Пароль раздела капсул').secureTextEntry,true);h.screen.unmount();
  const r=harness();r.render();await flush();r.render();r.button('Забыли пароль капсулы?').onPress();r.render();r.screen.button('Показать пароль аккаунта').onPress();r.render();
  assert.equal(r.screen.field('Пароль аккаунта для восстановления капсулы').secureTextEntry,false);r.screen.button('Скрыть пароль аккаунта').onPress();r.render();
  assert.equal(r.screen.field('Пароль аккаунта для восстановления капсулы').secureTextEntry,true);r.screen.unmount();
});
test('biometric enrollment is opt-in and only follows the successful server password unlock',async()=>{
  const h=harness();h.state.biometric.available=true;await h.enter();assert.equal(h.state.bioEnables.length,0);h.button('Закрыть капсулы').onPress();h.render();
  h.screen.field('Пароль раздела капсул').onChangeText('vault-password');h.button('Настроить вход по биометрии').onPress();h.render();
  h.state.unlockResult=async()=>{throw new CapsuleError('wrong','invalid');};h.button('Включить биометрию').onPress();await flush();h.render();assert.equal(h.state.bioEnables.length,0);
  h.state.unlockResult=null;h.button('Включить биометрию').onPress();await flush();h.render();assert.deepEqual(h.state.bioEnables,['vault-password']);h.screen.unmount();
});
test('biometric prompt never starts automatically and rapid duplicate taps start only one native read',async()=>{
  const h=harness();h.state.biometric={...h.state.biometric,available:true,enabled:true};h.render();await flush();h.render();assert.equal(h.state.bioReads,0);
  assert.throws(()=>h.screen.field('Пароль раздела капсул'));
  const wait=deferred();h.state.bioRead=()=>wait.promise;const open=h.button('Войти по отпечатку').onPress;open();open();await flush();assert.equal(h.state.bioReads,1);
  wait.resolve('vault-password');await flush();h.render();h.button('Создать послание');assert.equal(h.state.unlocks,1);h.screen.unmount();
});
for(const change of ['background','account','blur','unmount'])test('late biometric success after '+change+' cannot unlock the vault',async()=>{
  const h=harness();h.state.biometric={...h.state.biometric,available:true,enabled:true};h.render();await flush();h.render();
  const wait=deferred();h.state.bioRead=()=>wait.promise;h.button('Войти по отпечатку').onPress();await flush();
  if(change==='background')h.state.events[0]('background');if(change==='account')h.state.auth={...h.state.auth,session:{user:{id:B}}};
  if(change==='blur')h.state.focused=false;if(change==='unmount')h.screen.unmount();else h.render();
  const writes=h.screen.stateWrites;wait.resolve('vault-password');await flush();assert.equal(h.state.unlocks,0);
  if(change==='unmount')assert.equal(h.screen.stateWrites,writes);h.screen.unmount();
});
test('expected OS inactive dialog keeps the vault closed, then can authenticate after active without allowing background',async()=>{
  const h=harness();h.state.biometric={...h.state.biometric,available:true,enabled:true};h.render();await flush();h.render();const wait=deferred();h.state.bioRead=()=>wait.promise;
  h.button('Войти по отпечатку').onPress();await flush();h.state.events[0]('inactive');h.render();assert.throws(()=>h.button('Создать послание'));
  wait.resolve('vault-password');await flush();assert.equal(h.state.unlocks,0);h.state.events[0]('active');await flush();h.render();
  h.button('Создать послание');assert.equal(h.state.unlocks,1);h.screen.unmount();
});
test('retained password/open and visibility callbacks from before locking cannot reopen the vault',async()=>{
  const h=harness();h.render();await flush();h.render();h.screen.field('Пароль раздела капсул').onChangeText('vault-password');h.render();
  const unlock=h.button('Открыть капсулы').onPress,show=h.screen.button('Показать пароль капсулы').onPress;
  h.state.events[0]('background');h.state.events[0]('active');h.render();unlock();show();await flush();h.render();
  assert.equal(h.state.unlocks,0);assert.equal(h.screen.field('Пароль раздела капсул').secureTextEntry,true);h.screen.unmount();
});
test('capsule list is virtualized; duplicate load taps do not double a page and refresh resets the cursor',async()=>{
  const h=harness();const next={userId:U,familyId:F,archived:false,id:C,updatedAt:meta().updated_at};let calls=0;
  h.state.page=async(_trash,cursor)=>{calls++;return cursor?{items:[meta(),{...meta(),id:B,title:'Старая капсула'}],nextCursor:null}:{items:[meta()],nextCursor:next};};
  await h.enter();const list=h.screen.find(n=>n.type==='FlatList');assert.equal(list.props.windowSize,5);
  const wait=deferred();h.state.page=()=>{calls++;return wait.promise;};const more=h.button('Показать ещё капсулы').onPress;more();more();await flush();assert.equal(calls,2);
  wait.resolve({items:[meta(),{...meta(),id:B,title:'Старая капсула'}],nextCursor:null});await flush();h.render();
  assert.equal(h.screen.find(n=>n.type==='FlatList').props.data.length,2);assert.throws(()=>h.button('Показать ещё капсулы'));
  h.state.page=async()=>({items:[meta()],nextCursor:next});h.button('Обновить список капсул').onPress();await flush();h.render();h.button('Показать ещё капсулы');h.screen.unmount();
});
test('late page response after locking cannot put metadata back on the password gate',async()=>{
  const h=harness();await h.enter();const wait=deferred();h.state.page=()=>wait.promise;
  h.button('Обновить список капсул').onPress();await flush();h.state.events[0]('background');h.state.events[0]('active');
  wait.resolve({items:[meta()],nextCursor:null});await flush();h.render();assert.throws(()=>h.screen.find(n=>n.type==='FlatList'));h.screen.unmount();
});
test('a stale biometric password is disabled once and never opens content; cancellation preserves the password fallback',async()=>{
  const h=harness();h.state.biometric={...h.state.biometric,available:true,enabled:true};h.render();await flush();h.render();
  h.state.unlockResult=async()=>{throw Object.assign(new CapsuleError('wrong cached password','invalid'),{reason:'bad_password'});};
  h.button('Войти по отпечатку').onPress();await flush();h.render();assert.equal(h.state.bioDisables,1);assert.equal(h.state.keys,0);
  assert.throws(()=>h.button('Войти по отпечатку'));h.button('Открыть капсулы');h.screen.unmount();
  const c=harness();c.state.biometric={...c.state.biometric,available:true,enabled:true};c.render();await flush();c.render();c.state.bioRead=async()=>{throw new Error('cancel');};
  c.button('Войти по отпечатку').onPress();await flush();c.render();assert.equal(c.state.unlocks,0);c.button('Ввести пароль').onPress();c.render();c.button('Открыть капсулы');c.screen.unmount();
});
test('a retained AppState callback after unmount writes no UI state',async()=>{
  const h=harness();await h.enter();h.screen.unmount();const writes=h.screen.stateWrites;h.state.events[0]('background');
  assert.equal(h.screen.stateWrites,writes);
});
test('password is an independent choice: it neither reads nor enrolls biometrics and the next open shows two choices again',async()=>{
  const h=harness();h.state.biometric={...h.state.biometric,available:true,enabled:true};h.render();await flush();h.render();
  h.button('Ввести пароль').onPress();h.render();h.screen.field('Пароль раздела капсул').onChangeText('vault-password');h.render();
  h.button('Открыть капсулы').onPress();await flush();h.render();h.button('Создать послание');
  assert.equal(h.state.bioReads,0);assert.equal(h.state.bioEnables.length,0);assert.equal(h.state.unlocks,1);
  h.button('Закрыть капсулы').onPress();h.render();h.button('Войти по отпечатку');h.button('Ввести пароль');assert.throws(()=>h.screen.field('Пароль раздела капсул'));h.screen.unmount();
});
