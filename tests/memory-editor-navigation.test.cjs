const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {screenHarness}=require('./ui-harness.cjs');
const flush=()=>new Promise(r=>setImmediate(r));
const media=(id,type='image')=>({id,media_type:type,signed_url:'https://private.example.invalid/'+id});
const memory=(id,author='owner')=>({id,author_id:author,title:id,event_date:'2024-01-01',child_ids:[],media:[media(id+'-photo'),media(id+'-video','video')]});
test('gallery editor resolves the selected photo memory after swiping across memories and rechecks permission',()=>{
  const a=memory('a'),b=memory('b');const edits=[];let allowed=true;
  const screen=screenHarness('src/components/memory-gallery.tsx',{'expo-router':{useIsFocused:()=>true},'./photo-viewer':{PhotoViewer:'PhotoViewer'},'./video-viewer':{VideoViewer:'VideoViewer'}},'MemoryGallery');
  const props={memories:[a,b],captionFor:()=>undefined,onEditMemory:m=>edits.push(m.id),canEditMemory:()=>allowed};screen.render(props);
  screen.find(n=>n.type?.name==='GalleryTile'&&n.props.item.media.id==='a-photo').props.onPress();screen.render();
  const viewer=screen.find(n=>n.type==='PhotoViewer').props;
  assert.equal(viewer.photos.find(p=>p.id==='b-photo').viewerMemoryId,'b');assert.equal(viewer.photos.find(p=>p.id==='b-photo').viewerCanEdit,true);
  viewer.onEdit('b');assert.deepEqual(edits,['b']);viewer.onEdit('a');assert.deepEqual(edits,['b']);
  screen.render(props);screen.find(n=>n.type?.name==='GalleryTile'&&n.props.item.media.id==='a-photo').props.onPress();screen.render();
  const held=screen.find(n=>n.type==='PhotoViewer').props.onEdit;allowed=false;held('b');assert.deepEqual(edits,['b']);screen.unmount();
});
test('photo edit button sends the current photo memory ID and rejects retained previous-photo handlers',()=>{
  const edits=[];const screen=screenHarness('src/components/photo-viewer.tsx',{},'PhotoViewer');
  const photos=['a','b'].map(id=>({...media(id),viewerMemoryId:'memory-'+id,viewerCanEdit:true}));
  const props={photos,initialId:'a',title:'Фото',caption:'Дата',onClose(){},onEdit:id=>edits.push(id)};
  screen.render(props);const old=screen.button('Изменить воспоминание').onPress;
  screen.button('Открыть фото 2').onPress();screen.render();old();assert.equal(edits.length,0);
  screen.button('Изменить воспоминание').onPress();assert.deepEqual(edits,['memory-b']);screen.unmount();
});
test('feed routes edit only for the current memory, current scope and allowed author',async()=>{
  let screen;const routes=[];const row=memory('entry','author');
  screen=screenHarness('src/components/family-memory-feed.tsx',{
    'expo-router':{useRouter:()=>({push:p=>routes.push(p)}),useFocusEffect:f=>screen.react.useEffect(f,[f])},
    '../lib/memory-service':{getFamilyMemories:async()=>({items:[row],hasMore:false,nextCursor:null}),MemoryWriteError:class extends Error{},MEMORY_PAGE_SIZE:10},
    './memory-list':{MemoryList:'MemoryList'},'./memory-gallery':{MemoryGallery:'MemoryGallery'},'./memory-video-list':{MemoryVideoList:'MemoryVideoList'}
  },'FamilyMemoryFeed',{setInterval:()=>0,clearInterval(){}});
  const props={familyId:'family',children:[],initialView:'gallery',editorUserId:'author'};screen.render(props);await flush();screen.render();
  const list=screen.find(n=>n.type==='MemoryGallery').props;list.onEditMemory(row);assert.equal(routes[0].pathname,'/memory/[id]');assert.equal(routes[0].params.id,row.id);
  screen.render({...props,editorUserId:'other'});list.onEditMemory(row);assert.equal(routes.length,1);
  screen.unmount();list.onEditMemory(row);assert.equal(routes.length,1);
});
test('private new routes are guarded; invitation entry alone is public and existing callback retained',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/app/_layout.tsx'),'utf8');
  const family=source.slice(source.indexOf("guard={stage === 'family'}"),source.indexOf("guard={stage === 'picker'}"));
  for(const route of ['memory/[id]','family/members','family/trash'])assert.ok(family.includes(`name="${route}"`));
  assert.ok(source.includes('name="family/join"'));assert.ok(!family.includes('name="family/join"'));assert.ok(source.includes('name="auth/reset-password"'));
});
