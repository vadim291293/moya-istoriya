import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalReply, makeChatMessages, previewChat, processChat, requestChat } from '../function/chat.mjs';
import { relevantNews, parseFeed } from '../function/core.mjs';

test('reported questions about the computer and automatic delivery bypass the model',()=>{
 const questions=[
  'Нет, скажи если я комп выключу ты будешь работать?',
  'Я тебе на supabase сделал ты должен со мной общаться даже если я офну комп',
  'А как ты мне будешь давать новости?',
  'Я отключил инет',
  'Да как ты не можешь если я щас выключил комп и с тобой с тф общаюсь',
  'Новости ты мне должен сам присылать, ты каждые 15 минут чекаешь мир новостей',
  'Ты присылаешь новости сам?',
 ];
 for(const question of questions) {
  const answer=operationalReply(question,{enabled:true});
  assert.ok(answer,question);assert.match(answer,/сервере Supabase/);
  assert.match(answer,/не останавливает/);assert.match(answer,/15 минут/);
 }
 assert.match(operationalReply('Я отключил инет',{enabled:true}),/после подключения телефона/);
 assert.match(operationalReply('Ты помнишь прошлый разговор?',{enabled:true}),/четыре пары сообщений/);
});
test('paused news are never described as enabled',()=>{
 const answer=operationalReply('Если выключу компьютер, будут новости?',{enabled:false});
 assert.match(answer,/сейчас остановлены/);assert.doesNotMatch(answer,/Уведомления включены/);
 assert.equal(operationalReply('Какая последняя новость про OpenAI?',{enabled:true}),null);
 assert.equal(operationalReply('Напиши промпт для Runway',{enabled:true}),null);
});
test('preview and real Telegram delivery use the same deterministic answer without Groq',async()=>{
 const text='Если я комп выключу ты будешь работать?';
 const preview=await previewChat({}, {enabled:true},{},()=>{throw new Error('model must not run');},text);
 assert.equal(preview.tokens,0);
 const row={update_id:9,state:'pending',text,attempts:0};let sent=0;
 const db={async rpc(name){assert.equal(name,'news_begin_chat_run');return true;},
  async read(path){assert.ok(path.startsWith('news_chat_inbox?state=in.'));return [row];},async update(){}};
 const result=await processChat(db,{enabled:true,telegram_chat_id:'123'},{TELEGRAM_BOT_TOKEN:'test'},async(url,options)=>{
  assert.match(url,/sendMessage$/);const body=JSON.parse(options.body);
  assert.equal(body.text,preview.answer);sent++;return Response.json({ok:true,result:{message_id:8}});
 });
 assert.equal(result.answered,1);assert.equal(sent,1);
});
test('previous false self-description does not poison future model context',()=>{
 const messages=makeChatMessages('Объясни DSP',[
  {text:'Если я выключу компьютер, ты будешь работать?',response:'Нет, я усну'},
  {text:'Что такое DSP?',response:'Платформа закупки рекламы'},
 ],[],{enabled:true,chat_enabled:true});
 const data=JSON.parse(messages[1].content);
 assert.equal(data.history.length,1);assert.equal(data.bot_runtime.news_enabled,true);
 assert.match(messages[0].content,/сервере Supabase/);assert.match(messages[0].content,/15 минут/);
 assert.doesNotMatch(messages[1].content,/я усну/);
});
test('media topic filters discard unrelated articles and keep actual AI video and Musk news',()=>{
 assert.equal(relevantNews({source_id:'musk_ai',title:'Batteries are now cheaper than gas turbines'}),false);
 assert.equal(relevantNews({source_id:'video_reviews',title:'Mathematicians examine OpenAI release'}),false);
 assert.equal(relevantNews({source_id:'video_reviews',title:'New AI video generation model from Runway'}),true);
 assert.equal(relevantNews({source_id:'musk_ai',title:'Elon Musk announces new Grok model'}),true);
 const xml='<rss><channel><item><title>Battery prices fall</title><link>https://news.google.com/a</link></item><item><title>Elon Musk announces Grok model</title><link>https://news.google.com/b</link></item></channel></rss>';
 assert.equal(parseFeed(xml,{id:'musk_ai',allowed_host:'news.google.com'}).length,1);
});
test('news answers keep a real source and never an empty Markdown link',async()=>{
 const url='https://openai.com/news/release';
 const messages=makeChatMessages('Последняя новость OpenAI',[],[{source_id:'openai',title:'New release',url}],{enabled:true});
 const result=await requestChat(messages,{model:'test'},{GROQ_API_KEY:'test'},async()=>Response.json({
  choices:[{message:{content:'Новая публикация. [Читать статью](https://wrong.test/news)'}}],usage:{total_tokens:10}}));
 assert.ok(result.answer.includes(url));assert.ok(!result.answer.includes('wrong.test'));
 assert.doesNotMatch(result.answer,/\]\(\s*\)/);
});
