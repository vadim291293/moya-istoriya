import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListing,enrichArticle } from '../function/adapters.mjs';
import { plain,byteLength,digest,parseFeed } from '../function/core.mjs';
import { makeChatMessages,ownedUpdate,enqueueChat,requestChat,processChat } from '../function/chat.mjs';
import { createHandler } from '../function/worker.mjs';

test('media feeds accept only approved publisher hosts',()=>{
 const source={id:'video_reviews',allowed_host:'news.google.com',config:{allowed_publishers:['theverge.com']}};
 const item=(publisher,id)=>`<item><title>New AI video model</title><link>https://news.google.com/rss/articles/${id}</link><source url="${publisher}">Publisher</source></item>`;
 const xml=`<rss><channel>${item('https://www.theverge.com','one')}${item('https://theverge.com.evil.test','two')}${item('https://unknown.test','three')}</channel></rss>`;
 assert.equal(parseFeed(xml,source).length,1);
 assert.match(parseFeed(xml,source)[0].url,/one$/);
});

test('HTML listings find releases, ignore navigation and reject other hosts',()=>{
 const source={id:'runway',allowed_host:'runwayml.com',config:{extra_hosts:['runway.com']},feed_url:'https://runwayml.com/research'};
 const html='<a href="/research/introducing-gen-5"></a><a href="https://runway.com/research/new-model">Read Paper</a><a href="/research/publications">Publications</a><a href="https://evil.test/research/malware">New model</a>';
 const items=parseListing(html,source);
 assert.equal(items.length,2);
 assert.equal(items[0].title,'introducing gen 5');
 const article=enrichArticle('<h1>New Video Model</h1><meta name="description" content="New controllable video generation"><script type="application/ld+json">{"datePublished":"2026-10-09T10:00:00Z"}</script>',items[0]);
 assert.equal(article.title,'New Video Model');
 assert.equal(article.published_at,'2026-10-09T10:00:00.000Z');
 assert.equal(plain('&lt;a href="test"&gt;Article&lt;/a&gt;'),'Article');
});
test('only the bound private-chat owner can enqueue messages',async()=>{
 const cfg={telegram_chat_id:'123',chat_enabled:true};
 const update={update_id:11,message:{chat:{id:123,type:'private'},from:{id:123,is_bot:false},text:'Привет'}};
 assert.equal(ownedUpdate(update,cfg),true);
 assert.equal(ownedUpdate({...update,message:{...update.message,from:{id:999}}},cfg),false);
 assert.equal(ownedUpdate({...update,message:{...update.message,chat:{id:123,type:'group'}}},cfg),false);
 let inserts=0;
 const db={async insert(path,rows,prefer){inserts++;assert.match(prefer,/ignore-duplicates/);return inserts===1?rows:[];}};
 assert.equal(await enqueueChat(db,cfg,update),true);
 assert.equal(await enqueueChat(db,cfg,update),false);
});
test('large chat history and articles remain within the shared token allowance',()=>{
 const history=Array.from({length:4},()=>({text:'Ж'.repeat(4000),response:'Ж'.repeat(4000)}));
 const news=Array.from({length:8},()=>({title:'Ж'.repeat(300),excerpt:'Ж'.repeat(4000),url:'https://openai.com/news/test'}));
 const messages=makeChatMessages('Ж'.repeat(4000),history,news);
 const reserve=messages.reduce((sum,message)=>sum+byteLength(message.content),0)+900+256;
 assert.ok(reserve<=7000);
});
test('chat cannot invent links to paid or unrelated sites',async()=>{
 const messages=makeChatMessages('Видео',[],[]);
 const result=await requestChat(messages,{model:'test'},{GROQ_API_KEY:'test'},async()=>Response.json({
   choices:[{message:{content:'Попробуй https://runwayml.com/ и https://malicious.test/pay'}}],usage:{total_tokens:50}}));
 assert.ok(result.answer.includes('https://runwayml.com/'));
 assert.ok(!result.answer.includes('malicious.test'));
});
test('a webhook token cannot invoke administrator actions',async()=>{
 const token='b'.repeat(64),hash=await digest(token);
 let providers=0;
 const handler=createHandler(()=>({SUPABASE_URL:'https://backend.test',SUPABASE_SECRET_KEYS:'{"default":"sb_secret_test"}'}),async(url)=>{
  if(url.includes('news_settings')) return Response.json([{webhook_token_hash:hash,scheduler_token_hash:'other',telegram_chat_id:'123',chat_enabled:true}]);
  providers++;throw new Error('not allowed');
 });
 const response=await handler(new Request('https://bot.test/telegram',{method:'POST',headers:{'x-telegram-bot-api-secret-token':token},body:'{"action":"test_delivery"}'}));
 assert.equal(response.status,200);
 assert.equal(providers,0);
});
test('pause command works without a model call and replies once',async()=>{
 let enabled=true,sent=0;
 const row={update_id:1,state:'pending',text:'/pause',attempts:0};
 const db={async rpc(){return true;},async read(path){return path.startsWith('news_chat_inbox?state=in.')?[row]:[];},
  async update(path,data){if(path==='news_settings?id=eq.true' && 'enabled' in data) enabled=data.enabled;}};
 const result=await processChat(db,{telegram_chat_id:'123',enabled:true},{TELEGRAM_BOT_TOKEN:'test'},async(url)=>{
  assert.ok(url.includes('/sendMessage'));sent++;return Response.json({ok:true,result:{message_id:9}});
 });
 assert.equal(enabled,false);assert.equal(sent,1);assert.equal(result.answered,1);
});
